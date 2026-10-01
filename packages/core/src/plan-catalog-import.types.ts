// PlanCatalogImportSink — narrow adapter port for the one-shot import
// `saas.yaml → DB`.
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
// PlanCatalogReadSink — read counterpart to the importer. The database
// catalogue source asks it each time an operation needs the plans, with the
// moment it asks for.
// =============================================================================

import type { FeatureCatalogEntryRow } from './catalog-entry.types.js';
import type { PlanRow } from './plan-stem.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';

export interface PlanCatalogReadSnapshot {
    /** Plan stems (deletedAt IS NULL). */
    plans: PlanRow[];
    /**
     * Per `planId` (= planKey) the version on sale at the moment the snapshot
     * was asked for — the rule of `PlanRepository.findActivePlanVersion`, so
     * the catalogue names the version a booking made at that moment binds.
     * A plan with nothing on sale is taken over without pricing or quotas.
     */
    versionsOnSale: PlanVersionRow[];
    /** Feature catalog entries (deletedAt IS NULL). */
    featureEntries: FeatureCatalogEntryRow[];
}

/**
 * Adapter port for the DB-based PlanCatalog assembly. Apps
 * implement it against their Prisma tables.
 */
export interface PlanCatalogReadSink {
    /** The catalogue as it stands at `asOf`. */
    loadSnapshot(asOf: Date): Promise<PlanCatalogReadSnapshot>;
}
