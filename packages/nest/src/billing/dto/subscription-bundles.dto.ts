// DTOs for `TenantSubscriptionBundlesController` (
// P11.7.3). class-validator validation at the HTTP boundary.

import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsUUID,
    Matches,
    Max,
    Min,
} from 'class-validator';

import { BUNDLE_PRICE_LOOKUP_LIMIT } from '@saasicat/core';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export class AddSubscriptionBundleDto {
    @IsUUID()
    bundleVersionId!: string;

    /**
     * Optional — override for the minimum term (months). `0` = no
     * minimum term. Default comes from the `SubscriptionBundleConfig`
     * (platform = no commitment).
     */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(120)
    minimumTermMonths?: number;

    /**
     * The rhythm to bill this bundle in. Defaults to the plan's.
     *
     * A bundle may run in a shorter rhythm than its plan — monthly beside a
     * yearly plan is the interesting case — but never a longer one. A yearly
     * bundle on a monthly plan is refused rather than modelled: it has no
     * boundary to meet, and every one of the plan's twelve period ends is a
     * moment the plan could stop and leave the bundle committed with nothing to
     * grant.
     */
    @IsOptional()
    @IsIn(['MONTHLY', 'YEARLY'])
    billingCycle?: 'MONTHLY' | 'YEARLY';
}

/**
 * Body of `POST /billing/subscription-bundles/preview` (#37). Exactly one
 * of `bundleVersionId` (add preview) or `subscriptionBundleId`
 * (cancel preview) — the controller enforces this.
 */
export class PreviewSubscriptionBundleDto {
    /** Add preview: BundleVersion to be booked. */
    @IsOptional()
    @IsUUID()
    bundleVersionId?: string;

    /** Cancel preview: existing Bundle booking. */
    @IsOptional()
    @IsUUID()
    subscriptionBundleId?: string;

    /** Add preview only — override analogous to `AddSubscriptionBundleDto`. */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(120)
    minimumTermMonths?: number;

    /**
     * Add preview only — the rhythm to quote, analogous to
     * `AddSubscriptionBundleDto`. Defaults to the plan's.
     *
     * The booking has taken this since bundles gained a rhythm of their own.
     * The preview not taking it meant a tenant asking for a monthly bundle on a
     * yearly plan was quoted the yearly one and then charged the monthly one —
     * a preview describing a different contract from the one written, which is
     * the one thing a preview may never do.
     */
    @IsOptional()
    @IsIn(['MONTHLY', 'YEARLY'])
    billingCycle?: 'MONTHLY' | 'YEARLY';
}

export class CancelSubscriptionBundleDto {
    /**
     * Optional — default = `new Date()` server-side. Format: ISO-8601
     * (`YYYY-MM-DD` or full timestamp). Usually not set by the tenant
     * self-service.
     */
    @IsOptional()
    @Matches(ISO_DATE_PATTERN, {
        message: 'canceledAt must be an ISO date (YYYY-MM-DD)',
    })
    canceledAt?: string;
}

/** Which bundles the store is showing, so their prices can be resolved. */
export class BundlePriceLookupDto {
    /**
     * Capped rather than unbounded: the caller names what it is displaying, and
     * a page shows a catalogue, not a database. Each id costs a lookup.
     */
    @IsArray()
    @ArrayMaxSize(BUNDLE_PRICE_LOOKUP_LIMIT)
    @IsUUID('4', { each: true })
    bundleVersionIds!: string[];
}
