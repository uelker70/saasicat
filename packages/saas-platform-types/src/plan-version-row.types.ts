// PlanVersionRow — wire format of the version table rows: what the backend
// endpoint `/api/v1/admin/plan-versions` ships at the HTTP layer.
//
// Difference from `PlanVersion` (subscription.types.ts): money amounts come
// as a **string** (Prisma Decimal serialized as a string, not as a JS number
// — otherwise loss of precision).
// The plan-versions UI parses the strings via `Number(s)` for display and
// diff computation.
//
// Background: before phase 2 these types lived in a consumer's API client.
// With the lift-and-shift of the plan-versions UI into the platform they
// become the single source of truth here — apps with narrower type needs
// (e.g. `SubscriptionPlanId` union instead of `PlanId` string) narrow
// locally.

import type { FeatureKey, PlanId, QuotaKey } from './plan-catalog.types.js';
import type { VersionChange, VersionedEntityBase } from './subscription.types.js';

/**
 * PlanVersion — versioned plan definition (`BASIC v3`, `STANDARD v7`, …).
 *
 * Quotas: the platform convention is `quotas: { users: 10, vehicles: 50, … }`.
 * Legacy backends ship flat fields (`maxUsers`, `maxVehicles`,
 * `maxStorageGb`); these are marked optional and are tolerated by the
 * lift-and-shift catalog-builder layer. An index signature allows further
 * app-specific fields.
 */
export interface PlanVersionRow extends VersionedEntityBase {
    planId: PlanId;
    features: FeatureKey[];
    /**
     * Bundle selection assembled in the editor (bundleKeys,
     * SCREAMING_SNAKE_CASE). A bundle in this list implies that all of its
     * features are also contained in `features` — bundles are marketing
     * groupings of features. Persisted so the editor can reconstruct the
     * original bundle selection and the public catalog can present the plan
     * as a bundle. Optional, because consumer backends add the column
     * additively — if it is missing, the selection is empty and the editor
     * derives fully-active bundles from `features`.
     */
    bundles?: string[];
    quotas?: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed: boolean;
    // validFrom / validUntil are part of VersionedEntityBase (SPEC_V2 §4.2).

    /**
     * End date explicitly set by the SuperAdmin for a live PlanVersion.
     * Null = no end date, runs indefinitely until superseded by a successor
     * version (auto-succession then sets `supersededAt`).
     *
     * Unlike `validUntil` (auto-succession, maintained by the service),
     * `endsAt` is user-initiated: `POST /admin/catalog/plan-versions/:id/terminate`
     * sets the field. When `endsAt < NOW()` the version is no longer live for
     * new bookings — existing subscriptions (P1) stay bound.
     *
     * Optional, because consumer backends add the column additively — if it
     * is missing, there is no end date.
     */
    endsAt?: string | null;

    /** @deprecated Read from `quotas['users']` once available. */
    maxUsers?: number;
    /** @deprecated Legacy field; read from `quotas['vehicles']`. */
    maxVehicles?: number;
    /** @deprecated Read from `quotas['storageGb']`. */
    maxStorageGb?: number;
}

// Re-export for consumers that only import `plan-version-row.types`.
export type { VersionChange, VersionedEntityBase };
