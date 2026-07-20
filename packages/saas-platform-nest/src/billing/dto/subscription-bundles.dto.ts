// DTOs for `TenantSubscriptionBundlesController` (SPEC_V2 §11.1 M6 Pack 2e,
// P11.7.3). class-validator validation at the HTTP boundary.

import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export class AddSubscriptionBundleDto {
    @IsUUID()
    bundleVersionId!: string;

    /**
     * Optional — override for the minimum term (months). `0` = no
     * minimum term. Default comes from the `SubscriptionBundleConfig`
     * (platform = 12 months).
     */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(120)
    minimumTermMonths?: number;
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
}

export class CancelSubscriptionBundleDto {
    /**
     * Optional — default = `new Date()` server-side. Format: ISO-8601
     * (`YYYY-MM-DD` or full timestamp). Usually not set by the tenant
     * self-service.
     */
    @IsOptional()
    @Matches(ISO_DATE_PATTERN, {
        message: 'canceledAt muss ISO-Datum sein (YYYY-MM-DD)',
    })
    canceledAt?: string;
}
