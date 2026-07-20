// PlanCatalogImportSink — narrow adapter port for the one-shot import
// `saas.yaml → DB` (SPEC_V2 §11.1 M6 Pack 2c).
//
// Instead of defining separate repositories (Plan, PlanVersion,
// FeatureCatalogEntry), we use **one** sink port with upsert methods here.
// The consumer's app adapter implements it directly against its
// Prisma tables.
//
// Idempotency is the sink's responsibility: each `upsert*` method checks
// whether the row exists (primary-key match) and skips it without error. The
// service only counts the returned created/skipped flags.

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';

export interface UpsertResult {
    created: boolean;
    /** If `created=false`, a short reason is here (e.g. "exists"). */
    skipReason?: string;
}

export interface UpsertPlanInput {
    projectKey: string;
    planKey: string;
    label: string;
    description?: string | null;
    sortOrder?: number;
}

export interface UpsertPlanVersionInput {
    /** planKey, not the plan UUID — the sink resolves internally. */
    planKey: string;
    version: number;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed: boolean;
    /** For the importer: always published=true (`publishedAt = NOW`). */
    publish: boolean;
    changeNote: string;
}

export interface UpsertFeatureCatalogEntryInput {
    projectKey: string;
    featureKey: FeatureKey;
    label?: string;
    icon?: string;
    tier?: string;
    plannedOnly?: boolean;
    core?: boolean;
}

/**
 * Adapter port for the plan catalog importer. Apps implement it
 * against their Prisma client (or another persistence stack).
 */
export interface PlanCatalogImportSink {
    upsertPlan(input: UpsertPlanInput): Promise<UpsertResult>;
    upsertPlanVersion(input: UpsertPlanVersionInput): Promise<UpsertResult>;
    upsertFeatureCatalogEntry(input: UpsertFeatureCatalogEntryInput): Promise<UpsertResult>;
}

export interface PlanCatalogImportReport {
    plansCreated: number;
    plansSkipped: number;
    planVersionsCreated: number;
    planVersionsSkipped: number;
    featureEntriesCreated: number;
    featureEntriesSkipped: number;
    /** Warnings (non-fatal, e.g. "feature without label"). */
    warnings: string[];
}

// =============================================================================
// PlanCatalogReadSink — read counterpart to the importer (SPEC_V2 §11.1 M6 Pack 2c).
// Called by DB-PlanCatalogModule.forRoot at boot to assemble the
// PlanCatalog from the DB.
// =============================================================================

import type { FeatureCatalogEntryRow } from './catalog-entry.types.js';
import type { PlanRow } from './plan-stem.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';

export interface PlanCatalogReadSnapshot {
    /** Plan stems (deletedAt IS NULL). */
    plans: PlanRow[];
    /**
     * Live PlanVersions: per `planId` (= planKey) the currently published
     * version (publishedAt IS NOT NULL AND supersededAt IS NULL).
     * Apps with plans without a live version take over the plan, but without
     * pricing/quotas — the importer probably emitted a warning.
     */
    livePlanVersions: PlanVersionRow[];
    /** Feature catalog entries (deletedAt IS NULL). */
    featureEntries: FeatureCatalogEntryRow[];
}

/**
 * Adapter port for the DB-based PlanCatalog assembly. Apps
 * implement it against their Prisma tables.
 */
export interface PlanCatalogReadSink {
    loadSnapshot(projectKey: string): Promise<PlanCatalogReadSnapshot>;
}
