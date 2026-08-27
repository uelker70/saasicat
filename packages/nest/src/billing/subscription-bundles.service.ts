// SubscriptionBundlesService — domain layer over the
// `subscription_bundles` junction.
//
// Responsibilities:
//   1. `addBundleToSubscription`: checks bundle existence + publication
//      status + plan compatibility (`bundle.compatibility.planIds`) + idempotency
//      (no duplicate active bookings of the same BundleVersion); sets the
//      minimum-term default (12 months, configurable via token).
//   2. `cancelBundleFromSubscription`: computes
//      `canceledEffectiveAt = max(currentPeriodEnd, minimumTermEndsAt)`
//      — the booking thus stays active until the later of the two limits.
//
// Deliberately free of the Subscription repo: the caller (tenant self-service
// controller, onboarding service, admin endpoint) provides the domain
// data (`currentPlanKey`, `currentPeriodEnd`) itself. This keeps the
// service trivially isolatable in tests and without a tenant lookup.

import {
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    BillingCycle,
    BundleRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionBundleView,
} from '@saasicat/core';

import { bundleCycleFitsPlan, bundleFirstPeriodEnd } from './bundle-period.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { BILLING_ERROR_CODES, CATALOG_ERROR_CODES } from '@saasicat/core';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import {
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
} from './subscription-bundles.tokens.js';

export interface SubscriptionBundleConfig {
    /** Default minimum term in months on `add`. Default = 12. */
    defaultMinimumTermMonths?: number;
}

export interface AddBundleToSubscriptionInput {
    subscriptionId: string;
    bundleVersionId: string;
    /** PlanKey of the current subscription for the plan-compatibility check. */
    currentPlanKey: string;
    /** Default = now (service time). */
    startedAt?: Date;
    /**
     * Override for the minimum term (months). Default = config or
     * 12. `0` explicitly means "no minimum term"
     * (`minimumTermEndsAt = null`).
     */
    minimumTermMonths?: number;
    /**
     * When the parent subscription ends, or null while it runs on.
     *
     * A bundle cannot commit past the subscription that pays for it. With a
     * cancellation outstanding, a twelve-month default term on a subscription
     * ending in three weeks binds a customer to something that has three weeks
     * left to give — and once the parent ends, entitlement resolution grants
     * nothing through it.
     *
     * Required rather than optional: a caller that omits it commits the
     * customer for longer than the contract can deliver, and the omission is
     * invisible.
     */
    parentEndsAt: Date | null;
    /**
     * The plan's rhythm, its current period end, and the day it is billed on.
     *
     * A bundle runs in step with the plan that pays for it: its periods end on
     * the plan's day, and its first one is short. Aligned here, at booking,
     * rather than trimmed when the plan ends — a trim means somebody was
     * committed to more than they received, and then owed the difference.
     *
     * The plan's cycle is also the ceiling for the bundle's: a bundle may run
     * in a shorter rhythm, never a longer one.
     */
    planCycle: BillingCycle;
    planPeriodEnd: Date | null;
    planAnchorDay: number | null;
    /** The bundle's own rhythm. Defaults to the plan's. */
    billingCycle?: BillingCycle;
}

export interface CancelBundleFromSubscriptionInput {
    subscriptionBundleId: string;
    /** Default = now. */
    canceledAt?: Date;
    /**
     * Period end of the subscription from which the cancellation could take effect.
     * Effective date = `max(currentPeriodEnd, minimumTermEndsAt)`.
     * If not set, `canceledAt` is interpreted as the period end
     * (= immediate effect, provided the minimum term has already expired).
     */
    currentPeriodEnd?: Date;
    /**
     * When the parent subscription ends, or null while it runs on.
     *
     * A bundle cannot be held past the plan that pays for it, and the term was
     * written at booking — before any cancellation declared since. Reading the
     * boundary here is what makes that harmless: no clamp at insert time can
     * see a cancellation that had not happened yet.
     */
    parentEndsAt: Date | null;
}

@Injectable()
export class SubscriptionBundlesService {
    private readonly defaultMinTermMonths: number;

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly repo: SubscriptionBundleRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_CONFIG_TOKEN)
        config: SubscriptionBundleConfig = {},
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_BUNDLES_TOKEN)
        private readonly blockedBundles: SelfServiceBlockedBundles | null = null,
    ) {
        this.defaultMinTermMonths = config.defaultMinimumTermMonths ?? 12;
    }

    /** All bundle bookings of a subscription (for the "My Bundles" page). */
    /**
     * The tenant's bookings, with the price each one is actually billed at.
     *
     * `planKey` is required because a price is not a property of a bundle
     * alone: a `BundlePricingOverride` can set a different one per plan, and
     * the rhythm decides which of the two figures applies. Returning the base
     * monthly price regardless — which this did until 2026-08-27 — puts a
     * number on the tenant's screen that nobody is charged, and on a yearly
     * booking it was out by whatever the yearly price is.
     */
    async listForSubscription(
        subscriptionId: string,
        planKey: string,
        planCycle: string,
    ): Promise<SubscriptionBundleView[]> {
        const records = await this.repo.listBySubscription(subscriptionId);
        // Resolve label/key/price from the booked BundleVersion so the UI
        // displays booked bundles without a catalog join (otherwise UUID fallback, because
        // the catalog can exclude filtered/superseded versions).
        return Promise.all(
            records.map(async (r) => {
                const bv = await this.bundles.findVersionById(r.bundleVersionId);
                // A booking made before the column existed took the plan's
                // rhythm, because that was the only thing it could take.
                const cycle = r.billingCycle ?? planCycle;
                return {
                    ...r,
                    bundleKey: bv?.bundleKey ?? null,
                    label: bv?.label ?? null,
                    priceNet: bv ? resolveBundlePriceNet(bv, planKey, cycle) : null,
                };
            }),
        );
    }

    /**
     * List prices for the given bundle versions, in both rhythms, resolved for
     * one plan.
     *
     * The public catalogue cannot answer this: it has no tenant and therefore
     * no plan, so it serves the base prices and a bundle priced only through an
     * override reads as having no price at all. A tenant UI that treated those
     * fields as final hid such a bundle behind "not available in this rhythm"
     * while the booking would have gone through.
     */
    async resolvePricesFor(
        planKey: string,
        bundleVersionIds: string[],
    ): Promise<Record<string, { monthlyNet: number | null; yearlyNet: number | null }>> {
        const entries = await Promise.all(
            bundleVersionIds.map(async (id) => {
                const bv = await this.bundles.findVersionById(id);
                if (!bv) return null;
                return [
                    id,
                    {
                        monthlyNet: resolveBundlePriceNet(bv, planKey, 'MONTHLY'),
                        yearlyNet: resolveBundlePriceNet(bv, planKey, 'YEARLY'),
                    },
                ] as const;
            }),
        );
        return Object.fromEntries(entries.filter((entry) => entry !== null));
    }

    async addBundleToSubscription(
        input: AddBundleToSubscriptionInput,
    ): Promise<SubscriptionBundleRecord> {
        const bundleVersion = await this.bundles.findVersionById(input.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${input.bundleVersionId}' not found`,
                params: { bundleVersionId: input.bundleVersionId },
            });
        }
        if (bundleVersion.publishedAt === null) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_PUBLISHED,
                message: `BundleVersion '${input.bundleVersionId}' is not published and cannot be booked.`,
                params: { bundleVersionId: input.bundleVersionId },
            });
        }
        if (bundleVersion.supersededAt !== null) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_SUPERSEDED,
                message: `BundleVersion '${input.bundleVersionId}' has been superseded by a newer version.`,
                params: { bundleVersionId: input.bundleVersionId },
            });
        }

        // Self-service policy (#37): block sales-only bundles.
        if (this.blockedBundles?.bundleKeys?.includes(bundleVersion.bundleKey)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.BUNDLE_NOT_SELF_SERVICE,
                message:
                    `Bundle '${bundleVersion.bundleKey}' is only activated via a special contract. ` +
                    'Please contact the contract manager.',
                params: { bundleKey: bundleVersion.bundleKey },
            });
        }

        // Plan compatibility: empty planIds array = all plans allowed.
        const planIds = bundleVersion.compatibility?.planIds ?? [];
        if (planIds.length > 0 && !planIds.includes(input.currentPlanKey)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.BUNDLE_INCOMPATIBLE_WITH_PLAN,
                message:
                    `BundleVersion '${input.bundleVersionId}' is not compatible with plan ` +
                    `'${input.currentPlanKey}'. Allowed: [${planIds.join(', ')}].`,
                params: {
                    bundleVersionId: input.bundleVersionId,
                    planKey: input.currentPlanKey,
                    allowedPlanKeys: planIds,
                },
            });
        }

        // Idempotency: already an active booking of this BundleVersion?
        const active = await this.repo.listActiveBySubscription(input.subscriptionId);
        if (active.some((b) => b.bundleVersionId === input.bundleVersionId)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.BUNDLE_ALREADY_SUBSCRIBED,
                message: `Subscription '${input.subscriptionId}' has already actively booked this bundle.`,
                params: { subscriptionId: input.subscriptionId },
            });
        }

        const startedAt = input.startedAt ?? new Date();
        const billingCycle = input.billingCycle ?? input.planCycle;
        // Refused here as well as in the preview, and for the same reason the
        // publish gate refuses a priceless version: a booking with no price
        // hands the features over for nothing. The preview alone would be
        // enforcement in the client — a caller that posts straight to this
        // route never sees the blocker.
        if (resolveBundlePriceNet(bundleVersion, input.currentPlanKey, billingCycle) === null) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.BUNDLE_NOT_PRICED_FOR_THIS_PLAN,
                message:
                    `This bundle has no ${billingCycle.toLowerCase()} price for the ` +
                    `${input.currentPlanKey} plan, so it cannot be booked.`,
                params: { billingCycle, planKey: input.currentPlanKey },
            });
        }
        if (!bundleCycleFitsPlan(billingCycle, input.planCycle)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.BUNDLE_CYCLE_EXCEEDS_PLAN,
                message:
                    `A ${billingCycle.toLowerCase()} bundle cannot be booked on a ` +
                    `${input.planCycle.toLowerCase()} plan: its term would outlast the plan that ` +
                    'pays for it.',
                params: { billingCycle, planCycle: input.planCycle },
            });
        }
        const currentPeriodEnd = bundleFirstPeriodEnd({
            startedAt,
            cycle: billingCycle,
            planPeriodEnd: input.planPeriodEnd,
            planAnchorDay: input.planAnchorDay,
        });
        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;
        // Clamped to the parent's end rather than refused there. A customer who
        // has cancelled for the end of the month may still want a bundle for
        // this month, and the bundle price is per period rather than per term —
        // so a shorter commitment cannot overcharge them, it only stops binding
        // them beyond what they can use.
        const minimumTermEndsAt = clampToParent(
            minimumTermMonths > 0 ? addMonths(startedAt, minimumTermMonths) : null,
            input.parentEndsAt,
        );

        return this.repo.add({
            subscriptionId: input.subscriptionId,
            bundleVersionId: input.bundleVersionId,
            startedAt,
            minimumTermEndsAt,
            billingCycle,
            // Both ends together or neither. A start without an end is a window
            // that cannot be reasoned about: it is not running (nothing says
            // when it stops) and it is not absent (something is written), and
            // every reader would have to pick one. A booking made while its plan
            // had no period has no period of its own either, and says so.
            currentPeriodStart: currentPeriodEnd === null ? null : startedAt,
            currentPeriodEnd,
        });
    }

    async cancelBundleFromSubscription(
        input: CancelBundleFromSubscriptionInput,
    ): Promise<SubscriptionBundleRecord> {
        const existing = await this.repo.findById(input.subscriptionBundleId);
        if (!existing) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
                message: `SubscriptionBundle '${input.subscriptionBundleId}' not found`,
                params: { subscriptionBundleId: input.subscriptionBundleId },
            });
        }
        if (existing.canceledAt !== null) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED,
                message: `SubscriptionBundle '${input.subscriptionBundleId}' is already cancelled.`,
                params: { subscriptionBundleId: input.subscriptionBundleId },
            });
        }

        const canceledAt = input.canceledAt ?? new Date();
        const canceledEffectiveAt = resolveBundleCancelEffectiveAt({
            canceledAt,
            // The booking's own period, not the plan's. A monthly bundle beside
            // a yearly plan ends its month long before the plan ends its year,
            // and reading the plan's boundary kept such a booking committed —
            // and billed — until the annual renewal. The plan's boundary is the
            // fallback for a booking made before bundles had periods, which is
            // what those were billed against.
            currentPeriodEnd: existing.currentPeriodEnd ?? input.currentPeriodEnd ?? null,
            minimumTermEndsAt: existing.minimumTermEndsAt,
            parentEndsAt: input.parentEndsAt,
        });

        return this.repo.cancel(input.subscriptionBundleId, {
            canceledAt,
            canceledEffectiveAt,
        });
    }

    /**
     * "Undo cancellation" — only as long as the cancellation is not yet effective
     * (the bundle runs until `canceledEffectiveAt`). After that, re-booking is the way.
     */
    async reactivateBundle(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const existing = await this.repo.findById(subscriptionBundleId);
        if (!existing) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
                message: `SubscriptionBundle '${subscriptionBundleId}' not found`,
                params: { subscriptionBundleId },
            });
        }
        if (existing.canceledAt === null) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_CANCELLED,
                message: `SubscriptionBundle '${subscriptionBundleId}' is not cancelled.`,
                params: { subscriptionBundleId },
            });
        }
        if (existing.canceledEffectiveAt !== null && existing.canceledEffectiveAt <= new Date()) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE,
                message: 'Cancellation already in effect — book the bundle again.',
            });
        }
        return this.repo.reactivate(subscriptionBundleId);
    }
}

/**
 * Effective date of a bundle cancellation:
 * `max(currentPeriodEnd, minimumTermEndsAt)` — missing values fall back to
 * `canceledAt` (= immediate effect). Shared between the
 * cancellation mutation and the preview (#37).
 */
export function resolveBundleCancelEffectiveAt(input: {
    canceledAt: Date;
    currentPeriodEnd: Date | null;
    minimumTermEndsAt: Date | null;
    /** When the parent subscription ends, or null while it runs on. */
    parentEndsAt: Date | null;
}): Date {
    const periodEnd = input.currentPeriodEnd ?? input.canceledAt;
    const minTermEnd = input.minimumTermEndsAt ?? input.canceledAt;
    const later = periodEnd.getTime() >= minTermEnd.getTime() ? periodEnd : minTermEnd;
    // Read here rather than pinned at booking, and that is the point: a
    // cancellation declared AFTER the bundle was booked cannot change a term
    // already written, but it can be read now. Otherwise a booking made a
    // moment before the plan was cancelled holds the customer to a term the
    // plan will outlive — and no clamp at insert time can see a cancellation
    // that had not happened yet.
    if (input.parentEndsAt === null) return later;
    return later.getTime() <= input.parentEndsAt.getTime() ? later : input.parentEndsAt;
}

/**
 * Adds `months` to `date` and keeps the UTC day. Edge case
 * 31.01 + 1 month → 28/29.02 (JS Date does this automatically by
 * setMonth normalizing the day).
 */
export function addMonths(date: Date, months: number): Date {
    const out = new Date(date.getTime());
    out.setUTCMonth(out.getUTCMonth() + months);
    return out;
}

/**
 * The earlier of a bundle's own minimum term and the end of the subscription it
 * hangs off — a cap on a commitment, not a commitment of its own.
 *
 * A null own term is `minimumTermMonths: 0`, which the caller asked for and
 * which means there is no commitment to cap. Returning the parent's end there
 * would invent one: the booking could then not be cancelled until the parent
 * ended, which is the opposite of what a zero-month term is for, and possibly
 * a whole further period away.
 */
export function clampToParent(ownTermEndsAt: Date | null, parentEndsAt: Date | null): Date | null {
    if (ownTermEndsAt === null || parentEndsAt === null) return ownTermEndsAt;
    return ownTermEndsAt < parentEndsAt ? ownTermEndsAt : parentEndsAt;
}
