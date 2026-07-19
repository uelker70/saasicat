// DTOs für `TenantSubscriptionBundlesController` (SPEC_V2 §11.1 M6 Pack 2e,
// P11.7.3). Class-validator-Validierung an der HTTP-Grenze.

import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export class AddSubscriptionBundleDto {
    @IsUUID()
    bundleVersionId!: string;

    /**
     * Optional — Override für die Mindestlaufzeit (Monate). `0` = keine
     * Mindestlaufzeit. Default kommt aus dem `SubscriptionBundleConfig`
     * (Plattform = 12 Monate).
     */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(120)
    minimumTermMonths?: number;
}

/**
 * Body von `POST /billing/subscription-bundles/preview` (#37). Genau eines
 * von `bundleVersionId` (Add-Preview) oder `subscriptionBundleId`
 * (Cancel-Preview) — der Controller erzwingt das.
 */
export class PreviewSubscriptionBundleDto {
    /** Add-Preview: BundleVersion, die gebucht werden soll. */
    @IsOptional()
    @IsUUID()
    bundleVersionId?: string;

    /** Cancel-Preview: bestehende Bundle-Buchung. */
    @IsOptional()
    @IsUUID()
    subscriptionBundleId?: string;

    /** Nur Add-Preview — Override analog `AddSubscriptionBundleDto`. */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(120)
    minimumTermMonths?: number;
}

export class CancelSubscriptionBundleDto {
    /**
     * Optional — Default = `new Date()` server-side. Format: ISO-8601
     * (`YYYY-MM-DD` oder voller Timestamp). Wird vom Tenant-Self-Service
     * üblicherweise nicht gesetzt.
     */
    @IsOptional()
    @Matches(ISO_DATE_PATTERN, {
        message: 'canceledAt muss ISO-Datum sein (YYYY-MM-DD)',
    })
    canceledAt?: string;
}
