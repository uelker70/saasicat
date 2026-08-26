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
} from '@saasicat/core';
import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
} from '@saasicat/core';

import {
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/catalog.tokens.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import {
    bundleCycleFitsPlan,
    bundleFirstPeriodEnd,
    bundleFirstPeriodStart,
    resolvePlanAnchorDay,
} from './bundle-period.js';
import { computeProration, type ProrationDto } from './proration.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import {
    addMonths,
    clampToParent,
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
    /**
     * When the parent subscription ends, or null while it runs on.
     *
     * The dialog states the date the booking will be committed to, and the
     * mutation caps that date at the parent's end. A preview that does not cap
     * it describes a different contract from the one that is written.
     */
    parentEndsAt: Date | null;
    /**
     * The day of the month the plan is billed on, where it is known.
     *
     * The bundle's periods land on this day, so the preview needs the same
     * value the booking uses. Reading it from the plan's period end instead
     * would hand on a date a short month has already clamped, and the quoted
     * first period would then differ from the one written.
     */
    planAnchorDay?: number | null;
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
    /**
     * End of the first billing period, on the plan's billing day.
     *
     * Shorter than a full cycle in the usual case, and charged pro rata for
     * exactly that stretch (`proration`). Null where the plan has no period to
     * align to — a trial, or a subscription not yet started.
     */
    firstPeriodEnd: Date | null;
    /**
     * The day the bundle ends because the plan does, or null while the plan
     * runs on.
     *
     * Ending with the plan is not a cancellation: no notice is needed, and the
     * period the bundle is in when it happens is not credited. The alignment
     * exists so that day is a period boundary — this field is what remains
     * when the plan is already ending on a day the bundle has been paid past.
     */
    endsWithPlanAt: Date | null;
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
        input: {
            bundleVersionId: string;
            minimumTermMonths?: number;
            /** The bundle's own rhythm. Defaults to the plan's, as the booking does. */
            billingCycle?: BillingCycle;
        },
        now = new Date(),
    ): Promise<SubscriptionBundleAddPreviewDto> {
        const bundleVersion = await this.bundles.findVersionById(input.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${input.bundleVersionId}' not found`,
                params: { bundleVersionId: input.bundleVersionId },
            });
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];

        // The bundle's rhythm, not the plan's — the same default the booking
        // takes, and the same refusal. Quoting the plan's rhythm for a bundle
        // asked for in another one prices a contract nobody is about to sign.
        const planCycle = ctx.billingCycle as BillingCycle;
        const billingCycle = input.billingCycle ?? planCycle;
        if (!bundleCycleFitsPlan(billingCycle, planCycle)) {
            blockers.push({
                code: BILLING_ERROR_CODES.BUNDLE_CYCLE_EXCEEDS_PLAN,
                message:
                    `A ${billingCycle.toLowerCase()} bundle cannot run beside a ` +
                    `${planCycle.toLowerCase()} plan: it would still be committed on ` +
                    'every day the plan could end.',
            });
        }

        this.collectBookabilityBlockers(bundleVersion, ctx.currentPlanKey, blockers);

        const activeBundleVersions = await this.loadActiveBundleVersions(ctx.subscriptionId);
        if (activeBundleVersions.some((bv) => bv.id === bundleVersion.id)) {
            blockers.push({
                code: 'BUNDLE_ALREADY_SUBSCRIBED',
                message: 'This bundle is already actively booked.',
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
                    `${redundantFeatures.length} feature${redundantFeatures.length === 1 ? ' is' : 's are'} ` +
                    'already included in the plan or another booked bundle — ' +
                    'the bundle would be paid for twice.',
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
                    `The bundle requires [${missingRequires.join(', ')}] — present neither in the plan ` +
                    'nor in the active bundles.',
            });
        }

        const priceNet = resolveBundlePriceNet(bundleVersion, ctx.currentPlanKey, billingCycle);
        if (priceNet === null) {
            // Published bundles always resolve SOME price — that is checked when
            // they are published. What cannot be checked there is the
            // combination: which plan a tenant is on, and in which rhythm. A
            // bundle priced only monthly, offered to a tenant on a yearly plan,
            // resolves nothing here, and booking it would hand over features
            // with no price attached.
            blockers.push({
                code: BILLING_ERROR_CODES.BUNDLE_NOT_PRICED_FOR_THIS_PLAN,
                message:
                    `This bundle has no ${billingCycle.toLowerCase()} price for the ` +
                    `${ctx.currentPlanKey} plan, so it cannot be booked from here.`,
            });
        }
        // Resolved by the one function the booking route uses, so the two cannot
        // reach different days and quote a period the booking would not store.
        const planAnchorDay = resolvePlanAnchorDay({
            billingAnchorDay: ctx.planAnchorDay,
            currentPeriodStart: ctx.currentPeriodStart,
            startedAt: ctx.startedAt,
        });
        // The plan's actual boundary, or none. Projecting one from `startedAt`
        // quoted a first period for a subscription that has no paid window —
        // a trial, or one awaiting sales — while the booking passes the same
        // null through and stores no window at all. The preview would then have
        // named a commitment nobody wrote, on a date the eventual paid window
        // need not land on.
        const planPeriodEnd = ctx.currentPeriodEnd;
        // The bundle runs on the plan's day, in the bundle's own rhythm. What it
        // is charged against is its own period, not the plan's: a monthly
        // bundle beside a yearly plan is billed for its month, and prorating it
        // against the plan's year charged a fraction of a year at a monthly
        // price.
        const firstPeriodEnd = bundleFirstPeriodEnd({
            startedAt: now,
            cycle: billingCycle,
            planPeriodEnd,
            planAnchorDay,
        });
        const proration =
            ctx.status !== 'TRIAL' && priceNet !== null && firstPeriodEnd !== null
                ? computeProration({
                      periodStart: bundleFirstPeriodStart(
                          firstPeriodEnd,
                          billingCycle,
                          planAnchorDay,
                      ),
                      periodEnd: firstPeriodEnd,
                      now,
                      currentPriceNet: 0,
                      targetPriceNet: priceNet,
                  })
                : null;

        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;

        return {
            action: 'add',
            bundle: toSnapshot(bundleVersion),
            billingCycle,
            proration,
            nextPeriodPriceNet: priceNet,
            minimumTermMonths,
            // The same cap the mutation applies, for the same reason and by the
            // same rule: a zero-month term stays uncommitted.
            minimumTermEndsAt: clampToParent(
                minimumTermMonths > 0 ? addMonths(now, minimumTermMonths) : null,
                ctx.parentEndsAt,
            ),
            firstPeriodEnd,
            endsWithPlanAt: ctx.parentEndsAt,
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
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
                message: `SubscriptionBundle '${input.subscriptionBundleId}' not found`,
                params: { subscriptionBundleId: input.subscriptionBundleId },
            });
        }
        const bundleVersion = await this.bundles.findVersionById(existing.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${existing.bundleVersionId}' not found`,
                params: { bundleVersionId: existing.bundleVersionId },
            });
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];
        if (existing.canceledAt !== null) {
            blockers.push({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED,
                message: 'This bundle booking is already cancelled.',
            });
        }

        // The booking's own period, with the plan's as the fallback for a row
        // written before bundles had one. Quoting the plan's boundary for a
        // monthly bundle beside a yearly plan named a date up to a year past
        // the one the cancellation would actually land on.
        const bookingPeriodEnd = existing.currentPeriodEnd ?? ctx.currentPeriodEnd;
        const effectiveAt = resolveBundleCancelEffectiveAt({
            parentEndsAt: ctx.parentEndsAt,
            canceledAt: now,
            currentPeriodEnd: bookingPeriodEnd,
            minimumTermEndsAt: existing.minimumTermEndsAt,
        });
        const periodEnd = bookingPeriodEnd ?? now;
        if (
            existing.minimumTermEndsAt &&
            existing.minimumTermEndsAt.getTime() > periodEnd.getTime()
        ) {
            warnings.push({
                code: 'MINIMUM_TERM_BINDS',
                message:
                    'The minimum term extends beyond the end of the period — the ' +
                    'cancellation only takes effect when the minimum term ends.',
            });
        }

        // The rhythm this booking actually runs in, which need not be the plan's
        // — a monthly bundle beside a yearly plan saves a month per period, not
        // a year. Older rows predate the column and fall back to the plan's,
        // which is what they were booked in.
        const bookedCycle = existing.billingCycle ?? ctx.billingCycle;
        return {
            action: 'cancel',
            subscriptionBundleId: existing.id,
            bundle: toSnapshot(bundleVersion),
            billingCycle: bookedCycle,
            effectiveAt,
            nextPeriodSavingsNet: resolveBundlePriceNet(
                bundleVersion,
                ctx.currentPlanKey,
                bookedCycle,
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
                message: 'This bundle version is not published and cannot be booked.',
            });
        }
        if (bundleVersion.supersededAt !== null) {
            blockers.push({
                code: 'BUNDLE_VERSION_SUPERSEDED',
                message: 'This bundle version has been superseded by a newer one.',
            });
        }
        const planIds = bundleVersion.compatibility?.planIds ?? [];
        if (planIds.length > 0 && !planIds.includes(currentPlanKey)) {
            blockers.push({
                code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
                message:
                    `The bundle is not compatible with plan '${currentPlanKey}'. ` +
                    `Allowed: [${planIds.join(', ')}].`,
            });
        }
        if (this.blockedBundles?.bundleKeys?.includes(bundleVersion.bundleKey)) {
            blockers.push({
                code: 'BUNDLE_NOT_SELF_SERVICE',
                message:
                    `Bundle '${bundleVersion.bundleKey}' is only activated via a special contract. ` +
                    'Please contact the contract manager.',
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

function toSnapshot(bundleVersion: BundleVersionRow): BundlePreviewSnapshot {
    return {
        bundleKey: bundleVersion.bundleKey,
        label: bundleVersion.label,
        bundleVersionId: bundleVersion.id,
        features: [...(bundleVersion.features ?? [])],
        quotas: { ...(bundleVersion.quotas ?? {}) },
    };
}
