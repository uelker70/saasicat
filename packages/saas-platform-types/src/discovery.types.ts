// DiscoverySnapshot — Wire-Format des Code-Discovery-Endpoints
// (`GET /admin/discovery`).
//
// Beschreibt den **Code-Stand** zur Boot-Zeit: welche Capabilities,
// Features und Quotas hat das laufende Backend annotiert? Bundles
// werden bewusst NICHT vom Code aggregiert — sie werden ausschließlich
// vom SuperAdmin im UI geplant (DB-Tabelle `bundles`, siehe SPEC_V2
// §3 + §11.1 M3).
//
// Wird vom DiscoveryScanner in saas-platform-nest aufgebaut und vom
// SuperAdmin-UI in saas-platform-ui-vue konsumiert.
//
// Im Gegensatz zu CapabilityCatalogEntryRow/FeatureCatalogEntryRow
// (siehe catalog-entry.types.ts) ist das hier reiner Code-Snapshot —
// kein Review-Status, kein Marketing, keine DB-Persistenz.

import type { CapabilityKind } from './catalog-entry.types.js';

/**
 * Code-Status einer Capability im Decorator (`@ImplementsCapability`):
 *
 * - `active`       — normal nutzbar (Default)
 * - `experimental` — WIP-Capability; im UI mit Warnung sichtbar
 * - `deprecated`   — soll abgelöst werden (`replacementKey` empfohlen)
 * - `internal`     — taucht im SuperAdmin-UI nicht auf, aber im Snapshot-Hash
 */
export type DiscoveryCodeStatus = 'active' | 'experimental' | 'deprecated' | 'internal';

/**
 * Ein einzelner Capability-Eintrag im DiscoverySnapshot — entspricht dem
 * Wire-Format, das `/admin/discovery` ausliefert.
 */
export interface DiscoveredCapability {
    capabilityKey: string;
    label: string | null;
    feature: string | null;
    status: DiscoveryCodeStatus;
    kind: CapabilityKind;
    owner: string | null;
    replacementKey: string | null;
    removalPlannedAt: string | null;
    reason: string | null;
    /**
     * Feature-Keys, die das Feature dieser Capability zur Laufzeit
     * voraussetzt (#35). `null` = keine Abhängigkeiten — Default, damit
     * Snapshots aus älteren Plattform-Versionen unverändert lesbar bleiben.
     */
    requires: string[] | null;
    /**
     * Alte Feature-Keys, die das Feature dieser Capability ablöst (#39,
     * Hard-Pfad: der alte Code ist bereits gelöscht). `null` = keine.
     */
    replaces: string[] | null;
    /**
     * Wo die Capability deklariert ist — `ClassName.methodName` für
     * Methoden, `ClassName` für Klassen-Level. Hilft beim Forensik /
     * Discovery-Diff.
     */
    declaredAt: string;
}

/** Aggregat aus mehreren Capabilities mit `feature: 'X'`. */
export interface DiscoveredFeature {
    featureKey: string;
    /** Capability-Keys, die dieses Feature über `feature: 'X'` deklarieren. */
    capabilityKeys: string[];
    /**
     * Union der Capability-`requires` abzüglich des eigenen featureKey (#35).
     * `null` = keine Abhängigkeiten (abwärtskompatibel zu alten Snapshots).
     */
    requires: string[] | null;
    /** Union der Capability-`replaces` (#39). `null` = keine. */
    replaces: string[] | null;
}

/**
 * Quota-Policy:
 * - `monthlyReset` — Counter wird zum Monatsbeginn auf 0 gesetzt
 * - `continuous`   — Counter wächst monoton (z. B. Storage-Verbrauch)
 * - `hardCap`      — bei Überschreitung HTTP 429 / fachlicher Block
 */
export type DiscoveredQuotaPolicy = 'monthlyReset' | 'continuous' | 'hardCap';

/** Eine im Code via `@DefinesQuota` deklarierte Quota. */
export interface DiscoveredQuota {
    quotaKey: string;
    label: string;
    unit: string;
    policy: DiscoveredQuotaPolicy;
    feature: string | null;
    /** Alte QuotaKeys, die diese Quota ablöst (#39). `null` = keine. */
    replaces: string[] | null;
    /** Wo die Quota deklariert ist — `ClassName`. */
    declaredAt: string;
    /** Capability-Keys, die diese Quota via `@EnforceQuota(quotaKey)` referenzieren. */
    enforcedBy: string[];
}

/**
 * Vollständiger Discovery-Snapshot — wird zur Boot-Zeit gebaut, vom
 * AdminController als JSON ausgeliefert, vom Strict-Mode-Check (SPEC_V2 §8)
 * gegen den DB-Catalog geprüft.
 */
export interface DiscoverySnapshot {
    schemaVersion: 1;
    /** ISO-Timestamp des Boot-Zeit-Scans. */
    scannedAt: string;
    app: {
        /** projectKey, gleiches Konzept wie in den Catalog-Tabellen. */
        key: string;
        /** Backend-Version, z. B. aus package.json. */
        version: string;
    };
    capabilities: DiscoveredCapability[];
    features: DiscoveredFeature[];
    quotas: DiscoveredQuota[];
    /**
     * Kanonischer SHA256-Hash über sortierte/normalisierte Snapshot-Daten.
     * Stabil über Boot-Restarts, dient als ETag für `/admin/discovery`.
     */
    hash: string;
}
