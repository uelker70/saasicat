// SubscriptionBundlePreviewService (#37) — preview for mid-cycle
// bundle add/cancel in the tenant self-service, analogous to PlanChangePreviewService.
//
// Add preview returns:
//   - Proration: prorated amount until period end (shared helper
//     `computeProration`, currentPriceNet = 0 — only something is added)
//   - Follow-up period price in the current billing cycle
//   - Redundancy hint (sakarel AK-13 double-payment trap): features
//     already included in the plan or another active bundle
//   - Dependency check against `requires` (#35): missing requires-features
//     are reported and block
//   - Self-service policy: sales-only bundles (SelfServiceBlockedBundles)
//
// Cancel preview returns the effective date
// (`max(currentPeriodEnd, minimumTermEndsAt)`, shared with the mutation via
// `resolveBundleCancelEffectiveAt`) and the savings from the next period on.
// Deliberately no prorated credit: cancellations take effect at the earliest
// at period end, the booking stays active until then.
//
// SubscriptionContract continuation (decision, #37): mid-cycle add/
// cancel does NOT persist a new contract state on the platform. The
// entitlement aggregation reads the `subscription_bundles` junction at
// runtime. Consumers that use the V3 contract freeze
// (`ContractFreezePort`) must re-freeze after a successful add/cancel
// (`freezeOnPlanChange` with an unchanged plan = amendment as new
// contract state) — otherwise the EntitlementService would read back the old
// frozen snapshot. Deliberately a consumer hook instead of
// platform automation: the freeze needs app context (prices, VAT,
// bundle sources via ContractFreezeSourcePort).

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    BundleRepository,
    BundleVersionRow,
    CatalogEntryRepository,
    PlanRepository,
    SubscriptionBundleRepository,
} from '@saasicat/types';
import { buildFeatureRequiresIndex, collectUnsatisfiedRequires } from '@saasicat/types';

import {
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/tokens.js';
import { periodEndAfter } from './billing-period.js';
import { computeProration, type ProrationDto } from './proration.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import {
    addMonths,
    resolveBundleCancelEffectiveAt,
    type SubscriptionBundleConfig,
} from './subscription-bundles.service.js';
import {
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
} from './subscription-bundles.tokens.js';

export interface SubscriptionBundlePreviewIssue {
    code: string;
    message: string;
}

/** Subscription context — the controller reads it from the SubscriptionUsagePort. */
export interface SubscriptionBundlePreviewContext {
    subscriptionId: string;
    /** PlanKey of the current subscription (plan compatibility + redundancy source). */
    currentPlanKey: string;
    /** 'MONTHLY' | 'YEARLY' (port convention). */
    billingCycle: string;
    /** Subscription status (TRIAL/ACTIVE/...). No proration during TRIAL. */
    status: string;
    startedAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
}

export interface BundlePreviewSnapshot {
    bundleKey: string;
    label: string;
    bundleVersionId: string;
    features: string[];
    quotas: Record<string, number>;
}

/** AK-13: feature is already paid for elsewhere — double-payment hint. */
export interface RedundantFeatureHint {
    featureKey: string;
    coveredBy: 'PLAN' | 'BUNDLE';
    /** planKey or bundleKey of the covering source. */
    coveredByKey: string;
}

export interface SubscriptionBundleAddPreviewDto {
    action: 'add';
    bundle: BundlePreviewSnapshot;
    billingCycle: string;
    /**
     * Prorated amount until period end. `null` during TRIAL (no paid
     * period yet) or without a list price for the cycle.
     */
    proration: ProrationDto | null;
    /** List price per follow-up period in the current cycle; null = no price maintained. */
    nextPeriodPriceNet: number | null;
    minimumTermMonths: number;
    /** Projected minimum-term end from `now`; null = no minimum term. */
    minimumTermEndsAt: Date | null;
    redundantFeatures: RedundantFeatureHint[];
    /**
     * requires-features (#35) that neither the plan nor active bundles nor the
     * bundle itself cover. Non-empty ⇒ blocker
     * BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED.
     */
    missingRequires: string[];
    blockers: SubscriptionBundlePreviewIssue[];
    warnings: SubscriptionBundlePreviewIssue[];
}

export interface SubscriptionBundleCancelPreviewDto {
    action: 'cancel';
    subscriptionBundleId: string;
    bundle: BundlePreviewSnapshot;
    billingCycle: string;
    /** Effective date = max(currentPeriodEnd, minimumTermEndsAt). */
    effectiveAt: Date;
    /** Savings per period from the effective date; null = no price maintained. */
    nextPeriodSavingsNet: number | null;
    blockers: SubscriptionBundlePreviewIssue[];
    warnings: SubscriptionBundlePreviewIssue[];
}

@Injectable()
export class SubscriptionBundlePreviewService {
    private readonly defaultMinTermMonths: number;

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        // Optional — plan features for redundancy hint + requires coverage.
        // Without an adapter only the bundle view counts (graceful).
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        // Optional — requires source (curated FeatureCatalogEntries).
        // Without an adapter the dependency check is skipped (graceful).
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_BUNDLES_TOKEN)
        private readonly blockedBundles: SelfServiceBlockedBundles | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_CONFIG_TOKEN)
        config: SubscriptionBundleConfig = {},
    ) {
        this.defaultMinTermMonths = config.defaultMinimumTermMonths ?? 12;
    }

    async previewAdd(
        ctx: SubscriptionBundlePreviewContext,
        input: { bundleVersionId: string; minimumTermMonths?: number },
        now = new Date(),
    ): Promise<SubscriptionBundleAddPreviewDto> {
        const bundleVersion = await this.bundles.findVersionById(input.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException(`BundleVersion '${input.bundleVersionId}' nicht gefunden`);
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];

        this.collectBookabilityBlockers(bundleVersion, ctx.currentPlanKey, blockers);

        const activeBundleVersions = await this.loadActiveBundleVersions(ctx.subscriptionId);
        if (activeBundleVersions.some((bv) => bv.id === bundleVersion.id)) {
            blockers.push({
                code: 'BUNDLE_ALREADY_SUBSCRIBED',
                message: 'Dieses Bundle ist bereits aktiv gebucht.',
            });
        }

        const planFeatures = new Set(await this.resolvePlanFeatures(ctx.currentPlanKey, now));
        const redundantFeatures = this.collectRedundantFeatures(
            bundleVersion,
            planFeatures,
            ctx.currentPlanKey,
            activeBundleVersions,
        );
        if (redundantFeatures.length > 0) {
            warnings.push({
                code: 'REDUNDANT_FEATURES',
                message:
                    `${redundantFeatures.length} Feature${redundantFeatures.length === 1 ? ' ist' : 's sind'} ` +
                    'bereits im Plan oder einem anderen gebuchten Bundle enthalten — ' +
                    'das Bundle würde dafür doppelt bezahlt.',
            });
        }

        const missingRequires = await this.collectMissingRequires(
            bundleVersion,
            planFeatures,
            activeBundleVersions,
        );
        if (missingRequires.length > 0) {
            blockers.push({
                code: 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
                message:
                    `Das Bundle benötigt [${missingRequires.join(', ')}] — weder im Plan ` +
                    'noch in den aktiven Bundles enthalten.',
            });
        }

        const priceNet = resolveBundlePriceNet(bundleVersion, ctx.currentPlanKey, ctx.billingCycle);
        const proration =
            ctx.status !== 'TRIAL' && priceNet !== null
                ? computeProration({
                      periodStart: ctx.currentPeriodStart ?? ctx.startedAt ?? now,
                      periodEnd:
                          ctx.currentPeriodEnd ??
                          periodEndAfter(ctx.startedAt, ctx.billingCycle as BillingCycle, now),
                      now,
                      currentPriceNet: 0,
                      targetPriceNet: priceNet,
                  })
                : null;

        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;

        return {
            action: 'add',
            bundle: toSnapshot(bundleVersion),
            billingCycle: ctx.billingCycle,
            proration,
            nextPeriodPriceNet: priceNet,
            minimumTermMonths,
            minimumTermEndsAt: minimumTermMonths > 0 ? addMonths(now, minimumTermMonths) : null,
            redundantFeatures,
            missingRequires,
            blockers,
            warnings,
        };
    }

    async previewCancel(
        ctx: SubscriptionBundlePreviewContext,
        input: { subscriptionBundleId: string },
        now = new Date(),
    ): Promise<SubscriptionBundleCancelPreviewDto> {
        const existing = await this.subscriptionBundles.findById(input.subscriptionBundleId);
        if (!existing || existing.subscriptionId !== ctx.subscriptionId) {
            throw new NotFoundException(
                `SubscriptionBundle '${input.subscriptionBundleId}' nicht gefunden`,
            );
        }
        const bundleVersion = await this.bundles.findVersionById(existing.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException(
                `BundleVersion '${existing.bundleVersionId}' nicht gefunden`,
            );
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];
        if (existing.canceledAt !== null) {
            blockers.push({
                code: 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED',
                message: 'Diese Bundle-Buchung ist bereits gekündigt.',
            });
        }

        const effectiveAt = resolveBundleCancelEffectiveAt({
            canceledAt: now,
            currentPeriodEnd: ctx.currentPeriodEnd,
            minimumTermEndsAt: existing.minimumTermEndsAt,
        });
        const periodEnd = ctx.currentPeriodEnd ?? now;
        if (existing.minimumTermEndsAt && existing.minimumTermEndsAt.getTime() > periodEnd.getTime()) {
            warnings.push({
                code: 'MINIMUM_TERM_BINDS',
                message:
                    'Die Mindestlaufzeit bindet über das Periodenende hinaus — die ' +
                    'Kündigung wirkt erst zum Mindestlaufzeit-Ende.',
            });
        }

        return {
            action: 'cancel',
            subscriptionBundleId: existing.id,
            bundle: toSnapshot(bundleVersion),
            billingCycle: ctx.billingCycle,
            effectiveAt,
            nextPeriodSavingsNet: resolveBundlePriceNet(
                bundleVersion,
                ctx.currentPlanKey,
                ctx.billingCycle,
            ),
            blockers,
            warnings,
        };
    }

    /** Bookability checks — same codes as `addBundleToSubscription` (422 path). */
    private collectBookabilityBlockers(
        bundleVersion: BundleVersionRow,
        currentPlanKey: string,
        blockers: SubscriptionBundlePreviewIssue[],
    ): void {
        if (bundleVersion.publishedAt === null) {
            blockers.push({
                code: 'BUNDLE_VERSION_NOT_PUBLISHED',
                message: 'Diese BundleVersion ist nicht veröffentlicht und nicht buchbar.',
            });
        }
        if (bundleVersion.supersededAt !== null) {
            blockers.push({
                code: 'BUNDLE_VERSION_SUPERSEDED',
                message: 'Diese BundleVersion wurde durch eine Nachfolge-Version abgelöst.',
            });
        }
        const planIds = bundleVersion.compatibility?.planIds ?? [];
        if (planIds.length > 0 && !planIds.includes(currentPlanKey)) {
            blockers.push({
                code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
                message:
                    `Das Bundle ist nicht mit Plan '${currentPlanKey}' kompatibel. ` +
                    `Erlaubt: [${planIds.join(', ')}].`,
            });
        }
        if (this.blockedBundles?.bundleKeys?.includes(bundleVersion.bundleKey)) {
            blockers.push({
                code: 'BUNDLE_NOT_SELF_SERVICE',
                message:
                    `Bundle '${bundleVersion.bundleKey}' wird nur per Sondervertrag aktiviert. ` +
                    'Bitte den Vertragsbetreuer kontaktieren.',
            });
        }
    }

    /** Versions of the active bundle bookings (for redundancy + requires coverage). */
    private async loadActiveBundleVersions(subscriptionId: string): Promise<BundleVersionRow[]> {
        const active = await this.subscriptionBundles.listActiveBySubscription(subscriptionId);
        const versions = await Promise.all(
            active.map((booking) => this.bundles.findVersionById(booking.bundleVersionId)),
        );
        return versions.filter((bv): bv is BundleVersionRow => bv !== null);
    }

    /** Features of the currently live PlanVersion state; empty without PlanRepository. */
    private async resolvePlanFeatures(planKey: string, asOf: Date): Promise<string[]> {
        if (!this.plans) return [];
        const live =
            (await this.plans.findActivePlanVersion?.(planKey, asOf)) ??
            (await this.plans.findLatestLivePlanVersion?.(planKey));
        return live?.features ?? [];
    }

    private collectRedundantFeatures(
        bundleVersion: BundleVersionRow,
        planFeatures: ReadonlySet<string>,
        currentPlanKey: string,
        activeBundleVersions: BundleVersionRow[],
    ): RedundantFeatureHint[] {
        const hints: RedundantFeatureHint[] = [];
        for (const featureKey of bundleVersion.features ?? []) {
            if (planFeatures.has(featureKey)) {
                hints.push({ featureKey, coveredBy: 'PLAN', coveredByKey: currentPlanKey });
                continue;
            }
            const coveringBundle = activeBundleVersions.find((bv) =>
                (bv.features ?? []).includes(featureKey),
            );
            if (coveringBundle) {
                hints.push({
                    featureKey,
                    coveredBy: 'BUNDLE',
                    coveredByKey: coveringBundle.bundleKey,
                });
            }
        }
        return hints;
    }

    /**
     * requires of the new bundle that neither the bundle itself nor plan ∪
     * active bundles cover (#35). Empty without CatalogEntryRepository.
     */
    private async collectMissingRequires(
        bundleVersion: BundleVersionRow,
        planFeatures: ReadonlySet<string>,
        activeBundleVersions: BundleVersionRow[],
    ): Promise<string[]> {
        if (!this.catalogEntries) return [];
        const projectKey = await this.resolveProjectKey(bundleVersion);
        if (!projectKey) return [];
        const entries = await this.catalogEntries.listFeatures({ projectKey });
        const requiresIndex = buildFeatureRequiresIndex(entries);
        const covered = new Set<string>([
            ...planFeatures,
            ...activeBundleVersions.flatMap((bv) => bv.features ?? []),
        ]);
        return collectUnsatisfiedRequires(bundleVersion.features ?? [], requiresIndex).filter(
            (key) => !covered.has(key),
        );
    }

    /** `projectKey` lives on the bundle stem, not on the version. */
    private async resolveProjectKey(bundleVersion: BundleVersionRow): Promise<string | null> {
        const stem = await this.bundles.findById(bundleVersion.bundleId);
        return stem?.projectKey ?? null;
    }
}

/**
 * List price (net) for the billing cycle including plan-specific
 * pricing override (BundlePricingOverride with `planId`, without
 * `businessTypeKey`). null = no price maintained for the cycle.
 */
export function resolveBundlePriceNet(
    bundleVersion: BundleVersionRow,
    planKey: string,
    billingCycle: string,
): number | null {
    const override = (bundleVersion.pricingOverrides ?? []).find(
        (o) => o.planId === planKey && !o.businessTypeKey,
    );
    const yearly = billingCycle === 'YEARLY';
    const raw = yearly
        ? (override?.yearlyNet !== undefined ? override.yearlyNet : bundleVersion.yearlyNet)
        : (override?.monthlyNet !== undefined ? override.monthlyNet : bundleVersion.monthlyNet);
    if (raw === null || raw === undefined) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function toSnapshot(bundleVersion: BundleVersionRow): BundlePreviewSnapshot {
    return {
        bundleKey: bundleVersion.bundleKey,
        label: bundleVersion.label,
        bundleVersionId: bundleVersion.id,
        features: [...(bundleVersion.features ?? [])],
        quotas: { ...(bundleVersion.quotas ?? {}) },
    };
}
