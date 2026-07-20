// Discovery-Decorator-Optionen (NestJS-spezifisch).
//
// Die DiscoverySnapshot-Wire-Format-Typen leben in
// `@saasicat/types` (siehe discovery.types.ts dort), damit
// auch das Vue-UI-Paket sie ohne NestJS-Dependency nutzen kann. Hier nur
// die Optionen-Interfaces, die der Anwender im Decorator-Aufruf übergibt.

import type {
    CapabilityKind,
    DiscoveredQuotaPolicy,
    DiscoveryCodeStatus,
} from '@saasicat/types';

// Re-Exports für interne Verwendung im Scanner.
export type {
    CapabilityKind,
    DiscoveredCapability,
    DiscoveredFeature,
    DiscoveredQuota,
    DiscoveredQuotaPolicy,
    DiscoveryCodeStatus,
    DiscoverySnapshot,
} from '@saasicat/types';

// =============================================================================
// Decorator-Options (was der Anwender im Code annotiert)
// =============================================================================

/**
 * Optionen für `@ImplementsCapability(key, options)`. `key` selbst kommt als
 * separates Argument; alles andere ist optional, damit Boilerplate niedrig
 * bleibt.
 */
export interface ImplementsCapabilityOptions {
    /** Menschenlesbares Label (für Discovery-UI). */
    label?: string;
    /**
     * Aggregations-Hülle: Feature-Key, dem diese Capability gehört.
     * Bundles werden ausschließlich im SuperAdmin-UI geplant und sind
     * **bewusst nicht** Teil des Code-Decorators (SPEC_V2 §3.1).
     */
    feature?: string;
    /**
     * Code-Status. Default ist `active` (sichtbar im Discovery, kann in Plans
     * referenziert werden). `deprecated` empfiehlt Replacement; `experimental`
     * markiert WIP-Capabilities, die der SuperAdmin in der UI mit Warnung
     * sieht; `internal` taucht in der UI nicht auf, aber im Snapshot-Hash.
     */
    status?: DiscoveryCodeStatus;
    /**
     * Implementierungs-Art. Wird vom Scanner nicht selbst erkannt — der
     * Anwender deklariert sie explizit (Endpoint, Service, Job, Event).
     */
    kind?: CapabilityKind;
    /** Code-Owner-Tag (z. B. 'accounting', 'membership'). Audit-relevant. */
    owner?: string;
    /** Bei `status: 'deprecated'` empfohlen. */
    replacementKey?: string;
    /** Bei `status: 'deprecated'` empfohlen. ISO-Date. */
    removalPlannedAt?: string;
    /** Freitext-Begründung bei deprecation/internal. */
    reason?: string;
    /**
     * Feature-Keys, die das Feature dieser Capability zur Laufzeit
     * voraussetzt (#35) — z. B. `TRAINING_PLANNER` ⟹ `RESOURCE_MANAGEMENT`.
     * Der Scanner aggregiert pro Feature die Union aller Capability-requires
     * (abzüglich des eigenen featureKey); Strict-Mode-Check und Konfigurator
     * nutzen das, um unerfüllte Abhängigkeiten sichtbar zu machen.
     */
    requires?: string[];
    /**
     * Alte Feature-Keys, die das Feature dieser Capability ablöst (#39).
     * Hard-Pfad der Ersetzung: die Deklaration lebt am NEUEN Feature, der
     * alte Code kann im selben Commit gelöscht werden. (`replacementKey`
     * bleibt der Soft-Pfad am noch existierenden, deprecated Alt-Code.)
     */
    replaces?: string[];
}

/** Optionen für `@RequiresCapability(...keys)` — derzeit keine Optionen, nur die Key-Liste. */
export type RequiresCapabilityKeys = readonly string[];

/**
 * Optionen für `@DefinesQuota(options)`. `key` ist der QuotaKey, gegen den
 * `@EnforceQuota(...)` zur Laufzeit prüft.
 */
export interface DefinesQuotaOptions {
    key: string;
    label: string;
    /** Einheit für UI (z. B. 'invoices', 'GB', 'requests'). */
    unit: string;
    policy: DiscoveredQuotaPolicy;
    /** Aggregations-Hülle: an welches Feature die Quota gebunden ist. */
    feature?: string;
    /** Alte QuotaKeys, die diese Quota ablöst (#39, analog Capability-`replaces`). */
    replaces?: string[];
}

/** Optionen für `@EnforceQuota(key, options)`. */
export interface EnforceQuotaOptions {
    /**
     * Increment-Schritt pro Aufruf (default 1). Negative Werte erlauben
     * Decrement (z. B. Storno einer Rechnung).
     */
    incrementBy?: number;
    /**
     * Wann die Quota geprüft wird:
     * - `before` — vor der Handler-Ausführung (default; verhindert Schreiben)
     * - `after`  — nach erfolgreicher Ausführung (für Counter, die das
     *              Ergebnis brauchen — z. B. tatsächliche Storage-Größe)
     */
    timing?: 'before' | 'after';
}
