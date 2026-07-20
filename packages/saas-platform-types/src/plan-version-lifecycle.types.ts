// Lifecycle DTOs for PlanVersion (SPEC_V2 §11.1 M6 Pack 2a).
// `PlanVersionRow` itself lives in `plan-version-row.types.ts` —
// only the mutation inputs + service result live here.
//
// Structurally identical pattern to `CreateBundleVersionDraftData` /
// `BundleVersionMutationResult` (see bundle-business-type.types.ts).

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';
import type { StrictModeWarning } from './bundle-business-type.types.js';

/**
 * Fields of a new PlanVersion in draft status (`publishedAt = null`).
 * Created by the SuperAdmin, later published via `publishPlanVersion()`.
 * Only **one** draft version per `planId` is allowed
 * (partial unique index in the migration).
 */
export interface CreatePlanVersionDraftData {
    /**
     * **planKey** (e.g. "STARTER"), not the plan UUID. The service
     * resolves the plan UUID from the controller path param to
     * planKey beforehand, because `PlanVersion.planId` is a string in
     * the schema (soft binding; see SPEC_V2 §11.1 M6).
     */
    planId: string;
    /** Predecessor version the diff is computed against (null for v1). */
    baseVersionId?: string | null;
    features: FeatureKey[];
    /** Bundle selection (bundleKeys). Default empty. See `PlanVersionRow.bundles`. */
    bundles?: string[];
    quotas: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed?: boolean;
    /** Required on publish (contract protection P3, SPEC_V2 §7). */
    changeNote?: string;
    /** Optional in the draft (required on publish). ISO date string. */
    validFrom?: string | null;
    /** Optional; null = valid indefinitely. ISO date string. */
    validUntil?: string | null;
    createdByUserId?: string | null;
}

/**
 * Fields of a draft PlanVersion that may still be changed.
 * After `publishedAt` the version becomes immutable (contract protection P1/P4).
 */
export interface UpdatePlanVersionDraftData {
    features?: FeatureKey[];
    /** Bundle selection (bundleKeys). See `PlanVersionRow.bundles`. */
    bundles?: string[];
    quotas?: Record<QuotaKey, number>;
    monthlyNet?: string;
    yearlyNet?: string;
    marketed?: boolean;
    changeNote?: string;
    validFrom?: string | null;
    validUntil?: string | null;
}

/**
 * Input for `publishPlanVersion()`. The service computes `nonRegressive` and
 * `publishedChanges` from the diff to the predecessor version (see SPEC_V2
 * §7); the caller only provides confirmation + user tag.
 *
 * `validFrom` is **required** on publish (SPEC_V2 §4.2). If the draft
 * already has a `validFrom`, it is optional here. Auto-succession sets
 * `validUntil` of the predecessor version.
 */
export interface PublishPlanVersionData {
    publishedByUserId: string | null;
    /**
     * If true and the diff classifies the version as regressive,
     * it is published anyway (bulk-publish MFA confirmation,
     * SPEC_V2 §7).
     */
    forceRegressive?: boolean;
    /**
     * Allows publishing despite a price of 0.00. Default false: a 0.00 publish
     * is blocked to prevent accidentally going live with seed placeholders.
     * Only for deliberately free special contracts (e.g. ENTERPRISE).
     */
    allowZeroPrice?: boolean;
    /**
     * Required on publish if the draft has no `validFrom`. Must lie
     * strictly after the `validFrom` of the predecessor version.
     */
    validFrom?: string | null;
    /**
     * Optional; null = valid indefinitely (fits the last version
     * of a plan). Automatically overwritten by the service when a
     * successor version is created.
     */
    validUntil?: string | null;
}

/**
 * Service result for mutating PlanVersion operations
 * (createDraft, updateDraft, publish): returns the persisted row plus
 * a list of strict-mode warnings. In `warn-only` mode → banner in the UI;
 * in `blocking` mode the service throws HTTP 422 instead with
 * the same warning list.
 */
export interface PlanVersionMutationResult {
    planVersion: PlanVersionRow;
    warnings: StrictModeWarning[];
}
