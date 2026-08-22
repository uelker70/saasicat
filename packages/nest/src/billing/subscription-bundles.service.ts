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
    BundleRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionBundleView,
} from '@saasicat/types';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/tokens.js';
import { BILLING_ERROR_CODES, CATALOG_ERROR_CODES } from '@saasicat/types';
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
    async listForSubscription(subscriptionId: string): Promise<SubscriptionBundleView[]> {
        const records = await this.repo.listBySubscription(subscriptionId);
        // Resolve label/key/price from the booked BundleVersion so the UI
        // displays booked bundles without a catalog join (otherwise UUID fallback, because
        // the catalog can exclude filtered/superseded versions).
        return Promise.all(
            records.map(async (r) => {
                const bv = await this.bundles.findVersionById(r.bundleVersionId);
                return {
                    ...r,
                    bundleKey: bv?.bundleKey ?? null,
                    label: bv?.label ?? null,
                    monthlyNet: bv?.monthlyNet ?? null,
                };
            }),
        );
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
        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;
        const minimumTermEndsAt =
            minimumTermMonths > 0 ? addMonths(startedAt, minimumTermMonths) : null;

        return this.repo.add({
            subscriptionId: input.subscriptionId,
            bundleVersionId: input.bundleVersionId,
            startedAt,
            minimumTermEndsAt,
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
            currentPeriodEnd: input.currentPeriodEnd ?? null,
            minimumTermEndsAt: existing.minimumTermEndsAt,
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
}): Date {
    const periodEnd = input.currentPeriodEnd ?? input.canceledAt;
    const minTermEnd = input.minimumTermEndsAt ?? input.canceledAt;
    return periodEnd.getTime() >= minTermEnd.getTime() ? periodEnd : minTermEnd;
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
