// PlanVersionRow — Wire-Format der Versions-Tabellen-Rows: was der
// Backend-Endpoint `/api/v1/admin/plan-versions` auf der HTTP-Ebene shippt.
//
// Unterschied zu `PlanVersion` (subscription.types.ts): Geld-Beträge
// kommen als **String** (Prisma-Decimal serialisiert als String, nicht
// als JS-Number — sonst Verlust).
// Die Plan-Versions-UI parst die Strings via `Number(s)` für Anzeige und
// Diff-Rechnung.
//
// Hintergrund: Vor Phase 2 lebten diese Typen im API-Client eines
// Konsumenten. Mit dem Lift-and-Shift der Plan-Versions-UI in die
// Plattform werden sie hier zur Single-Source-of-Truth — Apps mit
// engerem Typ-Bedarf (z. B. `SubscriptionPlanId`-Union statt `PlanId`-
// String) narrowen lokal.

import type { FeatureKey, PlanId, QuotaKey } from './plan-catalog.types.js';
import type { VersionChange, VersionedEntityBase } from './subscription.types.js';

/**
 * PlanVersion — versionierte Plan-Definition (`BASIC v3`, `STANDARD v7`, …).
 *
 * Quotas: Die Plattform-Konvention ist `quotas: { users: 10, vehicles: 50, … }`.
 * Legacy-Backends shippen flache Felder (`maxUsers`, `maxVehicles`,
 * `maxStorageGb`); diese sind als optional angegeben und werden von der
 * Lift-and-Shift-Catalog-Builder-Layer toleriert. Index-Signatur erlaubt
 * weitere App-spezifische Felder.
 */
export interface PlanVersionRow extends VersionedEntityBase {
    planId: PlanId;
    features: FeatureKey[];
    /**
     * Im Editor zusammengestellte Bundle-Auswahl (bundleKeys,
     * SCREAMING_SNAKE_CASE). Ein Bundle in dieser Liste impliziert, dass
     * alle seine Features auch in `features` enthalten sind — Bundles sind
     * Vermarktungs-Gruppierungen von Features. Persistiert, damit der
     * Editor die ursprüngliche Bundle-Auswahl rekonstruieren und der
     * Public-Catalog den Plan als Bundle ausweisen kann. Optional, weil
     * Konsumenten-Backends die Spalte additiv nachziehen — fehlt sie, ist
     * die Auswahl leer und der Editor leitet voll-aktive Bundles aus
     * `features` ab.
     */
    bundles?: string[];
    quotas?: Record<QuotaKey, number>;
    monthlyNet: string;
    yearlyNet: string;
    marketed: boolean;
    // validFrom / validUntil sind Teil von VersionedEntityBase (SPEC_V2 §4.2).

    /**
     * Vom SuperAdmin explizit gesetztes Enddatum für eine live PlanVersion.
     * Null = kein Enddatum, läuft unbefristet bis zur Ablösung durch eine
     * Nachfolge-Version (Auto-Sukzession setzt dann `supersededAt`).
     *
     * Im Gegensatz zu `validUntil` (Auto-Sukzession, vom Service gepflegt)
     * ist `endsAt` user-initiiert: `POST /admin/catalog/plan-versions/:id/terminate`
     * setzt das Feld. Wenn `endsAt < NOW()` ist die Version nicht mehr live
     * für neue Buchungen — Bestand-Subscriptions (P1) bleiben gebunden.
     *
     * Optional, weil Konsumenten-Backends die Spalte additiv nachziehen —
     * fehlt sie, ist es kein Enddatum.
     */
    endsAt?: string | null;

    /** @deprecated Aus `quotas['users']` lesen, sobald verfügbar. */
    maxUsers?: number;
    /** @deprecated Legacy-Feld; aus `quotas['vehicles']` lesen. */
    maxVehicles?: number;
    /** @deprecated Aus `quotas['storageGb']` lesen. */
    maxStorageGb?: number;
}

// Re-export für Konsumenten, die nur `plan-version-row.types` importieren.
export type { VersionChange, VersionedEntityBase };
