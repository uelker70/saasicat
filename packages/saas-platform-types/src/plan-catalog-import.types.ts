// PlanCatalogImportSink — schmaler Adapter-Port für den One-Shot-Import
// `saas.yaml → DB` (SPEC_V2 §11.1 M6 Pack 2c).
//
// Statt separater Repositories (Plan, PlanVersion, FeatureCatalogEntry)
// zu definieren, nutzen wir hier **einen** Sink-Port mit upsert-Methoden.
// Der App-Adapter (vereinsfux, AutohausPro) implementiert ihn gegen seine
// Prisma-Tabellen direkt.
//
// Idempotenz ist Sache des Sinks: jede `upsert*`-Methode prüft, ob die
// Row existiert (Primary-Key-Match) und überspringt sie ohne Fehler. Der
// Service zählt nur die zurückgegebenen Created/Skipped-Flags.

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';

export interface UpsertResult {
    created: boolean;
    /** Wenn `created=false`, ist hier ein kurzer Grund (z. B. "exists"). */
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
    /** planKey, nicht Plan-UUID — der Sink resolvet intern. */
    planKey: string;
    version: number;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed: boolean;
    /** Beim Importer: immer published=true (`publishedAt = NOW`). */
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
 * Adapter-Port für den Plan-Catalog-Importer. Apps implementieren ihn
 * gegen ihren Prisma-Client (oder anderen Persistenz-Stack).
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
    /** Warnings (nicht-fatal, z. B. "feature ohne label"). */
    warnings: string[];
}

// =============================================================================
// PlanCatalogReadSink — Read-Pendant zum Importer (SPEC_V2 §11.1 M6 Pack 2c).
// Wird vom DB-PlanCatalogModule.forRoot beim Boot aufgerufen, um den
// PlanCatalog aus DB zusammenzubauen.
// =============================================================================

import type { FeatureCatalogEntryRow } from './catalog-entry.types.js';
import type { PlanRow } from './plan-stem.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';

export interface PlanCatalogReadSnapshot {
    /** Plan-Stämme (deletedAt IS NULL). */
    plans: PlanRow[];
    /**
     * Live PlanVersions: pro `planId` (= planKey) die aktuell published
     * Version (publishedAt IS NOT NULL AND supersededAt IS NULL).
     * Apps mit Plans ohne live-Version übernehmen den Plan, aber ohne
     * Pricing/Quotas — Importer hatte vermutlich einen Warning gegeben.
     */
    livePlanVersions: PlanVersionRow[];
    /** Feature-Catalog-Einträge (deletedAt IS NULL). */
    featureEntries: FeatureCatalogEntryRow[];
}

/**
 * Adapter-Port für den DB-basierten PlanCatalog-Aufbau. Apps
 * implementieren ihn gegen ihre Prisma-Tabellen.
 */
export interface PlanCatalogReadSink {
    loadSnapshot(projectKey: string): Promise<PlanCatalogReadSnapshot>;
}
