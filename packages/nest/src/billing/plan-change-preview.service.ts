import {
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    BillingCycle,
    PlanCatalog,
    PlanDef,
    PlanRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    UsageSnapshotPort,
} from '@saasicat/core';
import { BILLING_ERROR_CODES } from '@saasicat/core';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import {
    planDefOfVersion,
    findPlan,
    getPlanPriceNet,
    isPlanNotSoldInCycle,
    listPriceNet,
    planNotSoldInCycle,
} from './plan-helpers.js';
import { periodEndAfter } from './billing-period.js';
import { bundleCycleFitsPlan } from './bundle-period.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/subscription-contract.tokens.js';
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
import { computeNewPeriodCharge, computeProration, type ProrationDto } from './proration.js';

// PlanChangePreviewService — platform variant (data-driven).
//
// Compared to an app's own hardwiring (fixed users/vehicles/storageGb):
//   - LimitsCheck iterates over the union of quota keys from the current
//     entitlement, target plan and usage snapshot.
//   - Prices come from the version the subscription is bound to where the
//     plan stays, and from the version of another plan live now, read as a
//     row, where it moves — the version a scheduled change then records.
//     The PlanCatalog stands in where no repository reads versions.
//   - Plan rank is derived from the catalog order; non-marketed plans
//     (ENTERPRISE) get rank `Number.POSITIVE_INFINITY`.

export type PlanChangeType = 'UPGRADE' | 'DOWNGRADE' | 'CYCLE_CHANGE' | 'NOOP';

/** Where the target plan sits against the running one in the catalog order. */
export type PlanDirection = 'UP' | 'DOWN' | 'SAME';

/**
 * Whether the target billing period is longer, shorter or the same.
 *
 * Its own answer, deliberately. `changeType` collapses "a better plan" and "a
 * shorter commitment" into one word, and the two have opposite consequences: a
 * higher plan may start today, a shorter period may not — it would end a term
 * the customer is still inside. Asked as one question, moving from a yearly
 * STARTER to a monthly PRO reads as `UPGRADE`, applies immediately, and ends
 * the yearly commitment early. That is the case this split exists for.
 */
export type CycleDirection = 'LONGER' | 'SHORTER' | 'SAME';

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
    /**
     * English display text, and the last rung of the ladder rather than the
     * first: `resolveErrorMessage` prefers the reader's catalogue and reaches
     * this only for a code nobody has translated. It stays on the wire because
     * a blocker that renders as an empty line leaves someone with a disabled
     * button and no reason.
     */
    message: string;
    /**
     * The values the sentence needs, beside it rather than inside it.
     *
     * Without these a client holding the code still cannot rebuild the
     * sentence — it would have to parse English prose for the numbers. Every
     * template in the shipped catalogues names only what appears here, and
     * `preview-issues-are-translatable.test.js` holds that.
     */
    params?: Record<string, string | number>;
}

export interface PlanChangePreviewDto {
    changeType: PlanChangeType;
    /**
     * The two answers `changeType` collapses into one.
     *
     * A page needs them apart to explain a deferred upgrade: the plan went up,
     * the period got shorter, and it is the second that decided the date.
     */
    planDirection: PlanDirection;
    cycleDirection: CycleDirection;
    current: { plan: PlanSnapshotDto; billingCycle: string };
    /**
     * `planVersionId` is the version the target is priced at, and the one the
     * change binds: the version kept where the plan stays, the version live
     * now where it moves to another plan (`SC-CHG-022`). Null where no
     * repository reads plan versions and the catalogue is all there is.
     */
    target: { plan: PlanSnapshotDto; billingCycle: string; planVersionId: string | null };
    /** For upgrade/NOOP: immediately (null). Otherwise period end. */
    effectiveAt: Date | null;
    isImmediate: boolean;
    /**
     * Projected new trial end after the change (app trial logic, e.g.
     * carry-over of the remaining time). `null` if no TrialProjectionPort is
     * configured, the subscription is not in a trial, or nothing changes.
     * The wizard uses this to show "regular from the end of the trial".
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
    /**
     * End of what was committed to, which can outlast the period.
     *
     * They coincide until a notice period pushes one past the other. A change
     * scheduled to the period end alone would then materialise inside the
     * commitment this rule exists to protect — the customer keeps the plan they
     * are bound to for eleven months and loses it in the twelfth.
     */
    minimumTermUntil: Date | null;
    /** TRIAL end, if status === 'TRIAL'. */
    trialEndsAt: Date | null;
    /**
     * The cancellation, because it decides what a change may still do.
     *
     * A cancellation was measured against the term of the cycle it was declared
     * under, so that cycle cannot move while it is outstanding. The route
     * refuses such a change; without the same answer here, a reader is walked
     * through the whole wizard — the acknowledgement included — and meets the
     * refusal only when they press confirm.
     */
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    /** Subscription status (TRIAL/ACTIVE/...). */
    status: string;
    /** Current cycle of the subscription (for cycle-change classification). */
    currentBillingCycle: string;
    /** Current plan of the subscription. */
    currentPlan: string;
    /** Subscription start, if present (for the periodEndAfter fallback). */
    startedAt: Date | null;
}

/**
 * What the version a subscription is bound to says about its plan. `none` where
 * nothing can be read — no repository that reads versions, or no version bound
 * — and the catalogue is then all there is. `unreadable` where a version is
 * bound but the repository does not find it, or finds one of another plan: the
 * subscription came with its version joined, so the store's reads disagree,
 * and neither the version nor the catalogue says what the subscription pays.
 */
type BoundPlanReading =
    | { readonly kind: 'none' }
    | { readonly kind: 'read'; readonly plan: PlanDef }
    | { readonly kind: 'unreadable'; readonly planVersionId: string };

@Injectable()
export class PlanChangePreviewService {
    private readonly logger = new Logger(PlanChangePreviewService.name);

    constructor(
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
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
        // Optional — a consumer without the bundle module has no bookings to
        // check, and the rhythm rule below then has nothing to say.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository | null = null,
        // Optional — where contracts are frozen, the plan line of the one in
        // force is what the customer pays for the period they are in, and the
        // catalogue may list the plan at another price by now.
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository | null = null,
        // The version the subscription is bound to is what it pays for, and a
        // change that leaves the plan as it is keeps it. Without a repository
        // that reads versions, the catalogue's prices stand in.
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
    ) {}

    async preview(
        tenantId: string,
        targetPlan: string,
        targetCycle: string,
        now = new Date(),
    ): Promise<PlanChangePreviewDto> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: `No subscription for tenant ${tenantId}`,
                params: { tenantId },
            });
        }

        // One read for the whole preview: the target's existence, both prices
        // and the ranking that decides between upgrade and downgrade all come
        // from the same plans.
        const catalog = await this.catalogs.current();
        const targetPlanDef = findPlan(catalog, targetPlan);
        if (!targetPlanDef) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.PLAN_NOT_IN_CATALOG,
                message: `Plan "${targetPlan}" is not in the catalog`,
                params: { planKey: targetPlan },
            });
        }

        const ctx: PlanChangeContext = {
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            minimumTermUntil: sub.minimumTermUntil ?? null,
            trialEndsAt: sub.trialEndsAt,
            canceledAt: sub.canceledAt ?? null,
            canceledEffectiveAt: sub.canceledEffectiveAt ?? null,
            status: sub.status,
            currentBillingCycle: sub.billingCycle,
            currentPlan: sub.plan,
            startedAt: sub.startedAt,
        };

        // The tenant's current entitlements come from the entitlement cache, up
        // to a minute old (`SC-PLAN-026`), rather than from the reading above.
        // Handing that reading on would bypass the cache and cost the
        // subscription, contract and bundle reads on every preview; what the
        // preview charges is priced from the reading, and the contract a change
        // freezes computes its own entitlements fresh.
        const [currentLimits, usage] = await Promise.all([
            this.entitlements.computeLimits(tenantId, now),
            this.usageSnapshot.snapshot(tenantId),
        ]);

        // The version bound, read by the rules the contract freeze bills it by:
        // a price the row does not carry is a rhythm it is not sold in, never
        // a free one.
        // A binding that cannot be read is refused rather than quoted from the
        // catalogue, whose price is the newest one and not the one paid.
        const bound = await this.readBoundPlan(catalog, sub);
        if (bound.kind === 'unreadable') {
            throw boundPlanVersionUnreadable(sub.plan, bound.planVersionId);
        }
        const boundDef = bound.kind === 'read' ? bound.plan : null;
        const currentPlanDef = findPlan(catalog, currentLimits.plan);
        const currentSnap: PlanSnapshotDto = {
            id: currentLimits.plan,
            name: currentPlanDef?.name ?? currentLimits.plan,
            ...(boundDef
                ? {
                      monthlyNet: listPriceNet(boundDef, 'MONTHLY' as BillingCycle),
                      yearlyNet: listPriceNet(boundDef, 'YEARLY' as BillingCycle),
                  }
                : {
                      monthlyNet: getPlanPriceNet(
                          catalog,
                          currentLimits.plan,
                          'MONTHLY' as BillingCycle,
                      ),
                      yearlyNet: getPlanPriceNet(
                          catalog,
                          currentLimits.plan,
                          'YEARLY' as BillingCycle,
                      ),
                  }),
            quotas: currentLimits.quotas,
            features: Array.from(currentLimits.features).sort(),
        };

        // A change that leaves the plan as it is moves the rhythm and keeps the
        // version bound (`keepsBoundVersion`): it is quoted at that version's
        // price, and what the tenant may use does not change with it — not at
        // the version the catalogue sells to new customers now.
        const keptDef = boundDef && targetPlan === sub.plan ? boundDef : null;
        // Another plan is quoted at the version live now, read as a row, so the
        // version a scheduled change records is the one priced here
        // (`SC-CHG-022`). The catalogue is built from the same live versions,
        // and stands in where no repository reads them.
        const quoted = keptDef ? null : await this.readLiveVersion(catalog, targetPlan);
        const quotedDef = quoted?.plan ?? targetPlanDef;
        const targetSnap: PlanSnapshotDto = keptDef
            ? {
                  ...currentSnap,
                  id: targetPlanDef.id,
                  name: targetPlanDef.name ?? targetPlanDef.id,
              }
            : {
                  id: targetPlanDef.id,
                  name: targetPlanDef.name ?? targetPlanDef.id,
                  monthlyNet: listPriceNet(quotedDef, 'MONTHLY' as BillingCycle),
                  yearlyNet: listPriceNet(quotedDef, 'YEARLY' as BillingCycle),
                  quotas: quotedDef.quotas,
                  features: quotedDef.features.slice().sort(),
              };
        const targetVersionId = keptDef
            ? (sub.planVersion?.id ?? null)
            : (quoted?.versionId ?? null);

        const changeType = this.classify(
            catalog,
            sub.plan,
            sub.billingCycle,
            targetPlan,
            targetCycle,
        );

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

        // An immediate change may improve the service; it may not shorten the
        // commitment. Everything else waits for the term to end, which is where
        // the shorter period may legitimately begin.
        //
        // A trial commits to nothing, so there is nothing for the second half
        // to protect. Its cycle is what the subscription will be billed on
        // AFTER the trial, not a period anyone is inside, and deferring an
        // upgrade to the end of it withholds the very entitlements the customer
        // asked to try. `status` is what separates the two cases — no
        // arrangement of the dates does, because a trial has a period end like
        // any other subscription.
        const planDirection = this.planDirection(catalog, sub.plan, targetPlan);
        const cycleDirection = this.cycleDirection(sub.billingCycle, targetCycle);
        const commits = ctx.status !== 'TRIAL';
        const isImmediate = planDirection === 'UP' && (!commits || cycleDirection !== 'SHORTER');
        const effectiveAt = isImmediate ? null : this.resolveEffectiveAt(ctx, now);

        const proration =
            isImmediate && ctx.status !== 'TRIAL'
                ? this.computeProration(
                      ctx,
                      now,
                      (await this.planPricePaid(tenantId, sub.plan, sub.billingCycle, now)) ??
                          priceForCycle(currentSnap, sub.billingCycle) ??
                          0,
                      priceForCycle(targetSnap, targetCycle) ?? 0,
                      cycleDirection,
                  )
                : null;

        const blockers: PlanChangePreviewIssue[] = [];
        const warnings: PlanChangePreviewIssue[] = [];

        // Said here as well as at the write, because a blocker is what the
        // wizard reads: without it the reader picks a cycle, reads the
        // consequence, ticks the acknowledgement and meets a 409 on confirm.
        //
        // Two different refusals, and the wider one comes first. A subscription
        // that has ENDED refuses every plan change, not only a cycle change —
        // so a same-cycle upgrade was previewed as an ordinary immediate change
        // and rejected on submit.
        const landsAt = ctx.canceledEffectiveAt ?? ctx.canceledAt;
        if (landsAt !== null && landsAt <= now) {
            blockers.push({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_ENDED,
                message: 'This subscription has ended. Its plan can no longer be changed.',
            });
        } else if (landsAt !== null && cycleDirection !== 'SAME') {
            blockers.push({
                code: BILLING_ERROR_CODES.CANCELLATION_LOCKS_THE_CYCLE,
                message:
                    'This subscription is cancelled, so its billing cycle cannot change. ' +
                    'The plan can.',
            });
        }

        const blockedTargets = this.blockedPlans?.asTarget ?? [];
        const blockedSources = this.blockedPlans?.asSource ?? [];

        // A change that keeps the version is sold in the rhythm that version
        // carries, whatever the catalogue offers new customers.
        const soldAs = keptDef ?? quotedDef;
        if (isPlanNotSoldInCycle(soldAs, targetCycle as BillingCycle)) {
            blockers.push(planNotSoldInCycle(soldAs, targetCycle as BillingCycle));
        }
        if (blockedTargets.includes(targetPlan)) {
            blockers.push({
                code: BILLING_ERROR_CODES.PLAN_NOT_SELF_SERVICE,
                message: `${targetSnap.name} is only activated via a special contract. Please contact the contract manager.`,
                params: { planName: targetSnap.name, planKey: targetPlan },
            });
        }
        if (blockedSources.includes(sub.plan)) {
            blockers.push({
                code: BILLING_ERROR_CODES.PLAN_LOCKED,
                message: `Active ${currentSnap.name} special contract — please contact the contract manager to change plans.`,
                params: { planName: currentSnap.name, planKey: sub.plan },
            });
        }

        // Downgrade pre-check per quotaKey
        for (const [key, row] of Object.entries(limitsCheck)) {
            if (!row.exceeded) continue;
            const usedDisplay = isFloatQuota(key) ? row.used.toFixed(1) : row.used.toString();
            blockers.push({
                code: BILLING_ERROR_CODES.QUOTA_OVER_TARGET,
                message: `Current usage ${usedDisplay} exceeds the target limit ${row.targetMax} (${key}) in the ${targetSnap.name} plan. Please reduce usage first.`,
                params: {
                    used: usedDisplay,
                    targetMax: row.targetMax,
                    quotaKey: key,
                    planName: targetSnap.name,
                },
            });
        }

        if (featuresLost.length > 0) {
            // Two codes rather than a number in the sentence. A template
            // interpolates, it does not inflect: putting a count into a plural
            // no language has formed yields "1 features" in English and
            // "1 Funktionen" in German. Which language inflects how is known
            // only to its own entry, so the singular gets an entry of its own.
            warnings.push({
                code:
                    featuresLost.length === 1
                        ? BILLING_ERROR_CODES.FEATURE_LOST
                        : BILLING_ERROR_CODES.FEATURES_LOST,
                message: `Switching means losing access to ${featuresLost.length} feature${featuresLost.length === 1 ? '' : 's'}. Existing data is retained and never deleted — upgrading again unlocks it.`,
                params: { count: featuresLost.length },
            });
        }

        if (changeType === 'NOOP') {
            warnings.push({
                code: BILLING_ERROR_CODES.NO_CHANGE,
                message: 'Target plan and billing cycle already match the current state.',
            });
        }

        // Not a blocker: the change is allowed, it simply cannot start today.
        // Refusing it would be wrong — the customer may have a monthly plan
        // from the end of their term. What they may not have is the shorter
        // commitment starting inside the one they are still paying for, and
        // saying so before they confirm is the whole point of a preview.
        if (planDirection === 'UP' && cycleDirection === 'SHORTER') {
            warnings.push({
                code: BILLING_ERROR_CODES.CYCLE_SHORTENS_AT_TERM_END,
                message: `A ${targetCycle.toLowerCase()} ${targetSnap.name} cannot start inside the ${sub.billingCycle.toLowerCase()} term you are in. The upgrade takes effect when that term ends; to have it today, keep the ${sub.billingCycle.toLowerCase()} cycle.`,
                params: {
                    targetCycle: targetCycle.toLowerCase(),
                    currentCycle: sub.billingCycle.toLowerCase(),
                    planName: targetSnap.name,
                },
            });
        }

        // A bundle may run in a shorter rhythm than its plan, never a longer
        // one — and the rule was enforced only where a bundle is booked. A
        // yearly bundle bought beside a yearly plan survives a move to a
        // monthly one, and the booking then sits in the state the model calls
        // impossible: committed for a year beside a plan that ends twelve times
        // before its period does, each of those a moment the plan could stop
        // and leave it with nothing to grant.
        //
        // Refused rather than converted or ended. Ending it early owes the
        // customer the difference — the thing this whole alignment exists to
        // avoid — and converting it invents a price nobody agreed. Cancelling
        // the bundle first is the tenant's own act, and then the change goes
        // through.
        // Asked as of the day the change lands, not today. A tenant following
        // the advice below cancels the add-on for the same boundary the change
        // takes effect at — and the booking is still active until then, so
        // asking about today would refuse the very move the message told them
        // to make.
        const changeLandsAt = effectiveAt ?? now;
        for (const booking of await this.bookingsOutlastingCycle(sub, targetCycle, changeLandsAt)) {
            // Not `BUNDLE_CYCLE_EXCEEDS_PLAN`: that code states the same rule
            // for a booking nobody has made yet, and its catalogue sentence
            // says so. This one is about a booking the tenant already holds,
            // so it can name the day the obstacle lifts and say to cancel it
            // — advice that is wrong for someone who is only about to book.
            //
            // The two cycle words are baked into each locale's sentence rather
            // than interpolated, because the direction is determined:
            // `bundleCycleFitsPlan` refuses only a yearly bundle beside a
            // monthly plan. They stay in `params` as data, not as prose.
            blockers.push({
                code: BILLING_ERROR_CODES.BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE,
                message:
                    `A yearly bundle is booked until ${booking.until}. A monthly plan ` +
                    'cannot carry it — cancel the bundle first, or keep the yearly cycle.',
                params: {
                    billingCycle: 'yearly',
                    planCycle: targetCycle.toLowerCase(),
                    until: booking.until,
                },
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
            planDirection,
            cycleDirection,
            current: { plan: currentSnap, billingCycle: sub.billingCycle },
            target: { plan: targetSnap, billingCycle: targetCycle, planVersionId: targetVersionId },
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

    /** Catalog order decides which plan is higher; equal keys are `SAME`. */
    private planDirection(
        catalog: PlanCatalog,
        currentPlan: string,
        targetPlan: string,
    ): PlanDirection {
        if (currentPlan === targetPlan) return 'SAME';
        return this.planRank(catalog, targetPlan) > this.planRank(catalog, currentPlan)
            ? 'UP'
            : 'DOWN';
    }

    /**
     * YEARLY is the longer commitment; anything else is compared against it.
     *
     * Written as a comparison rather than a pair of equality checks so a third
     * cycle — quarterly is the one that keeps being asked for — orders itself
     * instead of falling into `SAME` and quietly becoming immediate.
     */
    private cycleDirection(currentCycle: string, targetCycle: string): CycleDirection {
        const rank = (cycle: string): number => (cycle === 'YEARLY' ? 1 : 0);
        const [from, to] = [rank(currentCycle), rank(targetCycle)];
        if (to === from) return 'SAME';
        return to > from ? 'LONGER' : 'SHORTER';
    }

    /**
     * Active bookings whose own rhythm would not fit `targetCycle`.
     *
     * Reads the booking's stored rhythm, not the plan's: a booking with none
     * follows the plan and therefore fits any plan by construction. Empty
     * without the bundle module, which is a consumer that has no bookings at
     * all rather than one whose bookings are being ignored.
     */
    private async bookingsOutlastingCycle(
        sub: { id?: string | null },
        targetCycle: string,
        now: Date,
    ): Promise<Array<{ until: string }>> {
        const subscriptionId = sub.id;
        if (!this.subscriptionBundles || !subscriptionId) return [];
        const active = await this.subscriptionBundles.listActiveBySubscription(subscriptionId, now);
        return active
            .filter(
                (booking) =>
                    booking.billingCycle != null &&
                    !bundleCycleFitsPlan(booking.billingCycle, targetCycle as BillingCycle),
            )
            .map((booking) => ({
                until: (booking.currentPeriodEnd ?? booking.minimumTermEndsAt ?? now)
                    .toISOString()
                    .slice(0, 10),
            }));
    }

    /**
     * What the subscription pays for its plan per billing cycle, net: the
     * version it is bound to, priced as the contract freeze bills it. Where no
     * repository reads versions, or the subscription is bound to none, the
     * catalogue is the only reading there is and its price stands in. Null
     * where the plan is not sold in the rhythm, or is sold under a special
     * contract whose price no catalogue holds, and where the version bound
     * cannot be read: the catalogue's price there would be the newest one
     * shown as the one paid. That case is logged rather than thrown, so the
     * account read it sits in still answers with everything else.
     */
    async planPriceNet(
        sub: Pick<SubscriptionUsageRecord, 'plan' | 'billingCycle' | 'planVersion'>,
    ): Promise<number | null> {
        const catalog = await this.catalogs.current();
        const bound = await this.readBoundPlan(catalog, sub);
        if (bound.kind === 'unreadable') {
            this.logger.warn(
                `A subscription on plan '${sub.plan}' is bound to plan version ` +
                    `'${bound.planVersionId}', which the plan repository does not read as a ` +
                    'version of that plan. Its price is shown as unknown until the binding is repaired.',
            );
            return null;
        }
        const plan = bound.kind === 'read' ? bound.plan : findPlan(catalog, sub.plan);
        return plan ? listPriceNet(plan, sub.billingCycle as BillingCycle) : null;
    }

    /**
     * The plan key is compared as the contract freeze compares it: a version
     * row carries its plan's key, whatever the schema stores.
     */
    private async readBoundPlan(
        catalog: PlanCatalog,
        sub: Pick<SubscriptionUsageRecord, 'plan' | 'planVersion'>,
    ): Promise<BoundPlanReading> {
        const planVersionId = sub.planVersion?.id;
        if (!planVersionId || !this.plans?.findVersionById) return { kind: 'none' };
        const bound = await this.plans.findVersionById(planVersionId);
        if (!bound || bound.planId !== sub.plan) return { kind: 'unreadable', planVersionId };
        return { kind: 'read', plan: planDefOfVersion(catalog, sub.plan, bound) };
    }

    /** The version of a plan live now, as a plan and with its id; null where nothing reads versions. */
    private async readLiveVersion(
        catalog: PlanCatalog,
        planKey: string,
    ): Promise<{ versionId: string; plan: PlanDef } | null> {
        if (!this.plans?.findLatestLivePlanVersion) return null;
        const live = await this.plans.findLatestLivePlanVersion(planKey);
        return live ? { versionId: live.id, plan: planDefOfVersion(catalog, planKey, live) } : null;
    }

    private classify(
        catalog: PlanCatalog,
        currentPlan: string,
        currentCycle: string,
        targetPlan: string,
        targetCycle: string,
    ): PlanChangeType {
        if (currentPlan === targetPlan && currentCycle === targetCycle) return 'NOOP';
        if (currentPlan === targetPlan) return 'CYCLE_CHANGE';
        const currentRank = this.planRank(catalog, currentPlan);
        const targetRank = this.planRank(catalog, targetPlan);
        return targetRank > currentRank ? 'UPGRADE' : 'DOWNGRADE';
    }

    /** Catalog order = rank. Non-marketed plans go to the end. */
    private planRank(catalog: PlanCatalog, planId: string): number {
        const plans = catalog.plans ?? [];
        const idx = plans.findIndex((p) => p.id === planId);
        if (idx === -1) return Number.POSITIVE_INFINITY;
        const plan = plans[idx]!;
        if (plan.marketed === false) return Number.POSITIVE_INFINITY - plans.length + idx;
        return idx;
    }

    private resolveEffectiveAt(ctx: PlanChangeContext, now: Date): Date {
        if (ctx.status === 'TRIAL' && ctx.trialEndsAt) return ctx.trialEndsAt;
        const periodEnd =
            ctx.currentPeriodEnd ??
            periodEndAfter(ctx.startedAt, ctx.currentBillingCycle as BillingCycle, now);
        // The later of the two. A commitment that outlasts the period is what a
        // notice period produces, and a change that landed at the period end
        // would take effect inside it.
        if (ctx.minimumTermUntil && ctx.minimumTermUntil > periodEnd) return ctx.minimumTermUntil;
        return periodEnd;
    }

    private computeProration(
        ctx: PlanChangeContext,
        now: Date,
        currentPriceNet: number,
        targetPriceNet: number,
        cycleDirection: CycleDirection,
    ): ProrationDto {
        // A subscription with no period yet has nothing paid to run inside:
        // the change opens its first period, in full.
        if (ctx.currentPeriodEnd === null) {
            return computeNewPeriodCharge({
                periodStart: now,
                periodEnd: now,
                now,
                currentPriceNet,
                targetPriceNet,
            });
        }
        const periodStart = ctx.currentPeriodStart ?? ctx.startedAt ?? now;
        // In the same rhythm the target runs inside the period already paid
        // (`SC-CHG-020`); a longer rhythm is a period of its own that starts
        // today (`SC-CHG-021`), and taking a difference between a year's price
        // and a month's over what is left of the month prices nothing.
        const charge = cycleDirection === 'SAME' ? computeProration : computeNewPeriodCharge;

        return charge({
            periodStart,
            periodEnd: ctx.currentPeriodEnd,
            now,
            currentPriceNet,
            targetPriceNet,
        });
    }

    /**
     * The net price of the plan line in the contract in force, when it is for
     * `plan` billed in `cycle` — what the customer pays for the period they are
     * in. Null without contracts, or where the line is for another plan or
     * rhythm: a freeze is optional and does not stop the change it follows when
     * it fails, so the contract in force can still describe the plan before.
     * The caller then prices from the catalogue.
     */
    private async planPricePaid(
        tenantId: string,
        plan: string,
        cycle: string,
        now: Date,
    ): Promise<number | null> {
        const contract = await this.contracts?.findActiveByTenantId(tenantId, now);
        const planLine = contract?.lineItems.find((line) => line.kind === 'plan');
        if (!planLine || planLine.sourceKey !== plan) return null;
        if (planLine.billingCycle !== cycle.toLowerCase()) return null;
        return planLine.priceNet;
    }
}

function priceForCycle(snap: PlanSnapshotDto, cycle: string): number | null {
    return cycle === 'YEARLY' ? snap.yearlyNet : snap.monthlyNet;
}

function isFloatQuota(key: string): boolean {
    // Storage values are GB floats; all others are integer counts.
    return key.toLowerCase().includes('storage');
}

function boundPlanVersionUnreadable(
    planKey: string,
    planVersionId: string,
): UnprocessableEntityException {
    return new UnprocessableEntityException({
        code: BILLING_ERROR_CODES.BOUND_PLAN_VERSION_UNREADABLE,
        message:
            `The plan version this subscription is bound to (${planVersionId}) cannot be read ` +
            `for plan "${planKey}", so no change can be quoted.`,
        params: { planKey, planVersionId },
    });
}
