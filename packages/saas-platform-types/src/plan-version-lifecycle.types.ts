// Lifecycle-DTOs für PlanVersion (SPEC_V2 §11.1 M6 Pack 2a).
// `PlanVersionRow` selbst lebt in `plan-version-row.types.ts` —
// hier nur die Mutation-Eingaben + Service-Result.
//
// Pattern strukturell identisch zu `CreateBundleVersionDraftData` /
// `BundleVersionMutationResult` (siehe bundle-business-type.types.ts).

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';
import type { StrictModeWarning } from './bundle-business-type.types.js';

/**
 * Felder einer neuen PlanVersion im Draft-Status (`publishedAt = null`).
 * Wird vom SuperAdmin angelegt, später per `publishPlanVersion()`
 * veröffentlicht. Nur **eine** Draft-Version pro `planId` erlaubt
 * (Partial-Unique-Index in der Migration).
 */
export interface CreatePlanVersionDraftData {
    /**
     * **planKey** (z. B. "STARTER"), nicht die Plan-UUID. Der Service
     * resolvert die Plan-UUID des Controller-Path-Param vorher zu
     * planKey, weil `PlanVersion.planId` im Schema ein String ist
     * (weiche Bindung; siehe SPEC_V2 §11.1 M6).
     */
    planId: string;
    /** Vorgänger-Version, gegen die der Diff berechnet wird (null bei v1). */
    baseVersionId?: string | null;
    features: FeatureKey[];
    /** Bundle-Auswahl (bundleKeys). Default leer. Siehe `PlanVersionRow.bundles`. */
    bundles?: string[];
    quotas: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed?: boolean;
    /** Pflicht beim Publish (Vertragsschutz P3, SPEC_V2 §7). */
    changeNote?: string;
    /** Optional im Draft (Pflicht beim Publish). ISO-Date-String. */
    validFrom?: string | null;
    /** Optional; null = unbegrenzt gültig. ISO-Date-String. */
    validUntil?: string | null;
    createdByUserId?: string | null;
}

/**
 * Felder einer Draft-PlanVersion, die noch geändert werden dürfen.
 * Nach `publishedAt` wird die Version immutable (Vertragsschutz P1/P4).
 */
export interface UpdatePlanVersionDraftData {
    features?: FeatureKey[];
    /** Bundle-Auswahl (bundleKeys). Siehe `PlanVersionRow.bundles`. */
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
 * Eingabe für `publishPlanVersion()`. `nonRegressive` und `publishedChanges`
 * berechnet der Service aus dem Diff zur Vorgänger-Version (siehe SPEC_V2
 * §7); der Aufrufer liefert nur Bestätigung + User-Tag.
 *
 * `validFrom` ist beim Publish **Pflicht** (SPEC_V2 §4.2). Wenn der Draft
 * bereits eine `validFrom` hat, ist hier optional. Auto-Sukzession setzt
 * `validUntil` der Vorgänger-Version.
 */
export interface PublishPlanVersionData {
    publishedByUserId: string | null;
    /**
     * Wenn true und der Diff klassifiziert die Version als regressiv,
     * wird trotzdem published (Bulk-Publish-MFA-Bestätigung,
     * SPEC_V2 §7).
     */
    forceRegressive?: boolean;
    /**
     * Erlaubt Publish trotz Preis 0,00. Standard false: ein 0,00-Publish
     * wird geblockt, um versehentliches Live-Stellen von Seed-Platzhaltern zu
     * verhindern. Nur für bewusst kostenlose Sonderverträge (z.B. ENTERPRISE).
     */
    allowZeroPrice?: boolean;
    /**
     * Pflicht beim Publish, falls der Draft kein `validFrom` hat. Muss
     * strikt nach `validFrom` der Vorgänger-Version liegen.
     */
    validFrom?: string | null;
    /**
     * Optional; null = unbegrenzt gültig (passt für die letzte Version
     * eines Plans). Wird bei Anlage einer Nachfolge-Version automatisch
     * vom Service überschrieben.
     */
    validUntil?: string | null;
}

/**
 * Service-Result für mutierende PlanVersion-Operationen
 * (createDraft, updateDraft, publish): liefert die persistierte Row plus
 * eine Liste Strict-Mode-Warnings. In `warn-only`-Modus → Banner im UI;
 * in `blocking`-Modus wirft der Service stattdessen HTTP 422 mit
 * derselben Warning-Liste.
 */
export interface PlanVersionMutationResult {
    planVersion: PlanVersionRow;
    warnings: StrictModeWarning[];
}
