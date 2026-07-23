import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    PlanCatalog,
    SubscriptionUsagePort,
    UsageSnapshotPort,
} from '@saasicat/types';
import { EntitlementService } from '../entitlement/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/tokens.js';
import { PLAN_CATALOG_TOKEN } from './plan-catalog.module.js';
import { findPlan, getPlanPriceNet } from './plan-helpers.js';
import { periodEndAfter } from './billing-period.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    TRIAL_PROJECTION_PORT_TOKEN,
    USAGE_SNAPSHOT_PORT_TOKEN,
    type TrialProjectionPort,
} from './tenant-billing.tokens.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import { computeProration, type ProrationDto } from './proration.js';

// PlanChangePreviewService — platform variant (data-driven).
//
// Compared to an app's own hardwiring (fixed users/vehicles/storageGb):
//   - LimitsCheck iterates over the union of quota keys from the current
//     entitlement, target plan and usage snapshot.
//   - Prices (currentPriceNet, targetPriceNet) come from the PlanCatalog,
//     not from DB PlanVersion snapshots — the catalog is the list-price SSoT.
//   - Plan rank is derived from the catalog order; non-marketed plans
//     (ENTERPRISE) get rank `Number.POSITIVE_INFINITY`.

export type PlanChangeType = 'UPGRADE' | 'DOWNGRADE' | 'CYCLE_CHANGE' | 'NOOP';

export interface PlanSnapshotDto {
    id: string;
    name: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    quotas: Record<string, number>;
    features: string[];
}

export interface LimitsCheckRow {
    used: number;
    currentMax: number;
    targetMax: number;
    exceeded: boolean;
}

export interface PlanChangePreviewIssue {
    code: string;
    message: string;
}

export interface PlanChangePreviewDto {
    changeType: PlanChangeType;
    current: { plan: PlanSnapshotDto; billingCycle: string };
    target: { plan: PlanSnapshotDto; billingCycle: string };
    /** For upgrade/NOOP: immediately (null). Otherwise period end. */
    effectiveAt: Date | null;
    isImmediate: boolean;
    /**
     * Projected new trial end after the change (app trial logic, e.g.
     * carry-over of the remaining time). `null` if no TrialProjectionPort is
     * configured, the subscription is not in a trial, or nothing changes.
     * The wizard uses this to show "regulär ab Ende der Testphase".
     */
    projectedTrialEndsAt: Date | null;
    proration: ProrationDto | null;
    /** Map quotaKey → LimitsCheckRow across all quota dimensions from the current limit, target plan and usage. */
    limitsCheck: Record<string, LimitsCheckRow>;
    featuresLost: string[];
    featuresGained: string[];
    /** Hard prevention reasons — e.g. usage > target limit. */
    blockers: PlanChangePreviewIssue[];
    /** Non-blocking hints — e.g. feature loss. */
    warnings: PlanChangePreviewIssue[];
}

export interface PlanChangeContext {
    /** Current period start time from the subscription, if present. */
    currentPeriodStart: Date | null;
    /** Current period end from the subscription, if present. */
    currentPeriodEnd: Date | null;
    /** TRIAL end, if status === 'TRIAL'. */
    trialEndsAt: Date | null;
    /** Subscription status (TRIAL/ACTIVE/...). */
    status: string;
    /** Current cycle of the subscription (for cycle-change classification). */
    currentBillingCycle: string;
    /** Current plan of the subscription. */
    currentPlan: string;
    /** Subscription start, if present (for the periodEndAfter fallback). */
    startedAt: Date | null;
}

@Injectable()
export class PlanChangePreviewService {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        // Explicit @Inject — the tsup build has no emitDecoratorMetadata,
        // so class-type reflection doesn't work; NestJS would otherwise throw
        // an UndefinedDependencyException on this parameter.
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(USAGE_SNAPSHOT_PORT_TOKEN)
        private readonly usageSnapshot: UsageSnapshotPort,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_PLANS_TOKEN)
        private readonly blockedPlans: SelfServiceBlockedPlans | null = null,
        @Optional()
        @Inject(TRIAL_PROJECTION_PORT_TOKEN)
        private readonly trialProjection: TrialProjectionPort | null = null,
    ) {}

    async preview(
        tenantId: string,
        targetPlan: string,
        targetCycle: string,
        now = new Date(),
    ): Promise<PlanChangePreviewDto> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);
        }

        const targetPlanDef = findPlan(this.catalog, targetPlan);
        if (!targetPlanDef) {
            throw new NotFoundException(
                `Plan "${targetPlan}" nicht im Catalog (${this.catalog.projectKey})`,
            );
        }

        const ctx: PlanChangeContext = {
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            trialEndsAt: sub.trialEndsAt,
            status: sub.status,
            currentBillingCycle: sub.billingCycle,
            currentPlan: sub.plan,
            startedAt: sub.startedAt,
        };

        const [currentLimits, usage] = await Promise.all([
            this.entitlements.computeLimits(tenantId, now),
            this.usageSnapshot.snapshot(tenantId),
        ]);

        const currentPlanDef = findPlan(this.catalog, currentLimits.plan);
        const currentSnap: PlanSnapshotDto = {
            id: currentLimits.plan,
            name: currentPlanDef?.name ?? currentLimits.plan,
            monthlyNet: getPlanPriceNet(
                this.catalog,
                currentLimits.plan,
                'MONTHLY' as BillingCycle,
            ),
            yearlyNet: getPlanPriceNet(this.catalog, currentLimits.plan, 'YEARLY' as BillingCycle),
            quotas: currentLimits.quotas,
            features: Array.from(currentLimits.features).sort(),
        };

        const targetSnap: PlanSnapshotDto = {
            id: targetPlanDef.id,
            name: targetPlanDef.name ?? targetPlanDef.id,
            monthlyNet: getPlanPriceNet(this.catalog, targetPlan, 'MONTHLY' as BillingCycle),
            yearlyNet: getPlanPriceNet(this.catalog, targetPlan, 'YEARLY' as BillingCycle),
            quotas: targetPlanDef.quotas,
            features: targetPlanDef.features.slice().sort(),
        };

        const changeType = this.classify(sub.plan, sub.billingCycle, targetPlan, targetCycle);

        const limitsCheck: Record<string, LimitsCheckRow> = {};
        const quotaKeys = new Set([
            ...Object.keys(currentLimits.quotas),
            ...Object.keys(targetSnap.quotas),
            ...Object.keys(usage),
        ]);
        for (const key of quotaKeys) {
            const used = usage[key] ?? 0;
            const currentMax = currentLimits.quotas[key] ?? 0;
            const targetMax = targetSnap.quotas[key] ?? 0;
            // -1 = unlimited (catalog convention).
            const exceeded = targetMax !== -1 && used > targetMax;
            limitsCheck[key] = { used, currentMax, targetMax, exceeded };
        }

        const currentFeatureSet = currentLimits.features;
        const targetFeatureSet = new Set(targetSnap.features);
        const featuresLost = Array.from(currentFeatureSet)
            .filter((f) => !targetFeatureSet.has(f))
            .sort();
        const featuresGained = targetSnap.features.filter((f) => !currentFeatureSet.has(f));

        const isImmediate = changeType === 'UPGRADE';
        const effectiveAt = isImmediate ? null : this.resolveEffectiveAt(ctx, now);

        const proration =
            isImmediate && ctx.status !== 'TRIAL'
                ? this.computeProration(
                      ctx,
                      now,
                      currentSnap,
                      targetSnap,
                      sub.billingCycle,
                      targetCycle,
                  )
                : null;

        const blockers: PlanChangePreviewIssue[] = [];
        const warnings: PlanChangePreviewIssue[] = [];

        const blockedTargets = this.blockedPlans?.asTarget ?? [];
        const blockedSources = this.blockedPlans?.asSource ?? [];

        if (blockedTargets.includes(targetPlan)) {
            blockers.push({
                code: `${targetPlan}_NOT_SELF_SERVICE`,
                message: `${targetSnap.name} wird nur per Sondervertrag aktiviert. Bitte den Vertragsbetreuer kontaktieren.`,
            });
        }
        if (blockedSources.includes(sub.plan)) {
            blockers.push({
                code: `${sub.plan}_LOCKED`,
                message: `Aktiver ${currentSnap.name}-Sondervertrag — bitte den Vertragsbetreuer für Plan-Wechsel kontaktieren.`,
            });
        }

        // Downgrade pre-check per quotaKey
        for (const [key, row] of Object.entries(limitsCheck)) {
            if (!row.exceeded) continue;
            const usedDisplay = isFloatQuota(key) ? row.used.toFixed(1) : row.used.toString();
            blockers.push({
                code: `${key.toUpperCase()}_OVER_TARGET`,
                message: `Aktueller Verbrauch ${usedDisplay} überschreitet das Ziel-Limit ${row.targetMax} (${key}) im ${targetSnap.name}-Paket. Bitte Verbrauch reduzieren.`,
            });
        }

        if (featuresLost.length > 0) {
            warnings.push({
                code: 'FEATURES_LOST',
                message: `Mit dem Wechsel verlierst du Zugriff auf ${featuresLost.length} Feature${featuresLost.length === 1 ? '' : 's'}. Bestehende Daten bleiben erhalten und werden nicht gelöscht — du kannst sie wieder freischalten, wenn du erneut upgradest.`,
            });
        }

        if (changeType === 'NOOP') {
            warnings.push({
                code: 'NO_CHANGE',
                message:
                    'Ziel-Paket und Abrechnungszyklus stimmen mit dem aktuellen Stand überein.',
            });
        }

        // Trial projection (app-specific) — only relevant during an active trial.
        const projectedTrialEndsAt =
            this.trialProjection && sub.status === 'TRIAL'
                ? await this.trialProjection.projectTrialEndsAt({
                      currentPlan: sub.plan,
                      targetPlan,
                      currentTrialEndsAt: sub.trialEndsAt,
                      status: sub.status,
                      now,
                  })
                : null;

        return {
            changeType,
            current: { plan: currentSnap, billingCycle: sub.billingCycle },
            target: { plan: targetSnap, billingCycle: targetCycle },
            effectiveAt,
            isImmediate,
            projectedTrialEndsAt,
            proration,
            limitsCheck,
            featuresLost,
            featuresGained,
            blockers,
            warnings,
        };
    }

    /** Like `preview`, but only the blocker list — for a server-side
     * pre-check before the `changePlan` mutation (defense-in-depth). */
    async assertChangeAllowed(
        tenantId: string,
        targetPlan: string,
        targetCycle: string,
        now = new Date(),
    ): Promise<PlanChangePreviewIssue[]> {
        const dto = await this.preview(tenantId, targetPlan, targetCycle, now);
        return dto.blockers;
    }

    private classify(
        currentPlan: string,
        currentCycle: string,
        targetPlan: string,
        targetCycle: string,
    ): PlanChangeType {
        if (currentPlan === targetPlan && currentCycle === targetCycle) return 'NOOP';
        if (currentPlan === targetPlan) return 'CYCLE_CHANGE';
        const currentRank = this.planRank(currentPlan);
        const targetRank = this.planRank(targetPlan);
        return targetRank > currentRank ? 'UPGRADE' : 'DOWNGRADE';
    }

    /** Catalog order = rank. Non-marketed plans go to the end. */
    private planRank(planId: string): number {
        const plans = this.catalog.plans ?? [];
        const idx = plans.findIndex((p) => p.id === planId);
        if (idx === -1) return Number.POSITIVE_INFINITY;
        const plan = plans[idx]!;
        if (plan.marketed === false) return Number.POSITIVE_INFINITY - plans.length + idx;
        return idx;
    }

    private resolveEffectiveAt(ctx: PlanChangeContext, now: Date): Date {
        if (ctx.status === 'TRIAL' && ctx.trialEndsAt) return ctx.trialEndsAt;
        if (ctx.currentPeriodEnd) return ctx.currentPeriodEnd;
        return periodEndAfter(ctx.startedAt, ctx.currentBillingCycle as BillingCycle, now);
    }

    private computeProration(
        ctx: PlanChangeContext,
        now: Date,
        current: PlanSnapshotDto,
        target: PlanSnapshotDto,
        currentCycle: string,
        targetCycle: string,
    ): ProrationDto {
        const periodStart = ctx.currentPeriodStart ?? ctx.startedAt ?? now;
        const periodEnd =
            ctx.currentPeriodEnd ??
            periodEndAfter(ctx.startedAt, ctx.currentBillingCycle as BillingCycle, now);

        return computeProration({
            periodStart,
            periodEnd,
            now,
            currentPriceNet: priceForCycle(current, currentCycle) ?? 0,
            targetPriceNet: priceForCycle(target, targetCycle) ?? 0,
        });
    }
}

function priceForCycle(snap: PlanSnapshotDto, cycle: string): number | null {
    return cycle === 'YEARLY' ? snap.yearlyNet : snap.monthlyNet;
}

function isFloatQuota(key: string): boolean {
    // Storage values are GB floats; all others are integer counts.
    return key.toLowerCase().includes('storage');
}
