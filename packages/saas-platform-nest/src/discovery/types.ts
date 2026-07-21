// Discovery decorator options (NestJS-specific).
//
// The DiscoverySnapshot wire-format types live in
// `@saasicat/types` (see discovery.types.ts there), so that
// the Vue UI package can use them without a NestJS dependency too. Here only
// the option interfaces that the user passes in the decorator call.

import type {
    CapabilityKind,
    DiscoveredQuotaPolicy,
    DiscoveryCodeStatus,
} from '@saasicat/types';

// Re-exports for internal use in the scanner.
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
// Decorator options (what the user annotates in the code)
// =============================================================================

/**
 * Options for `@ImplementsCapability(key, options)`. `key` itself comes as a
 * separate argument; everything else is optional to keep boilerplate low.
 */
export interface ImplementsCapabilityOptions {
    /** Human-readable label (for the discovery UI). */
    label?: string;
    /**
     * Aggregation wrapper: the feature key this capability belongs to.
     * Bundles are planned exclusively in the SuperAdmin UI and are
     * **deliberately not** part of the code decorator (SPEC_V2 §3.1).
     */
    feature?: string;
    /**
     * Code status. Default is `active` (visible in discovery, can be
     * referenced in plans). `deprecated` recommends a replacement;
     * `experimental` marks WIP capabilities that the SuperAdmin sees with a
     * warning in the UI; `internal` does not appear in the UI, but does in the
     * snapshot hash.
     */
    status?: DiscoveryCodeStatus;
    /**
     * Implementation kind. Not detected by the scanner itself — the user
     * declares it explicitly (Endpoint, Service, Job, Event).
     */
    kind?: CapabilityKind;
    /** Code-owner tag (e.g. 'accounting', 'membership'). Audit-relevant. */
    owner?: string;
    /** Recommended when `status: 'deprecated'`. */
    replacementKey?: string;
    /** Recommended when `status: 'deprecated'`. ISO date. */
    removalPlannedAt?: string;
    /** Free-text reason for deprecation/internal. */
    reason?: string;
    /**
     * Feature keys that this capability's feature requires at runtime (#35)
     * — e.g. `TRAINING_PLANNER` ⟹ `RESOURCE_MANAGEMENT`.
     * The scanner aggregates the union of all capability requires per feature
     * (minus its own featureKey); the strict-mode check and the configurator
     * use it to surface unmet dependencies.
     */
    requires?: string[];
    /**
     * Old feature keys that this capability's feature replaces (#39).
     * Hard path of replacement: the declaration lives on the NEW feature, the
     * old code can be deleted in the same commit. (`replacementKey` remains
     * the soft path on the still-existing, deprecated old code.)
     */
    replaces?: string[];
}

/** Options for `@RequiresCapability(...keys)` — currently no options, just the key list. */
export type RequiresCapabilityKeys = readonly string[];

/**
 * Options for `@DefinesQuota(options)`. `key` is the QuotaKey that
 * `@EnforceQuota(...)` checks against at runtime.
 */
export interface DefinesQuotaOptions {
    key: string;
    label: string;
    /** Unit for the UI (e.g. 'invoices', 'GB', 'requests'). */
    unit: string;
    policy: DiscoveredQuotaPolicy;
    /** Aggregation wrapper: which feature the quota is bound to. */
    feature?: string;
    /** Old QuotaKeys that this quota replaces (#39, analogous to Capability `replaces`). */
    replaces?: string[];
}

/** Options for `@EnforceQuota(key, options)`. */
export interface EnforceQuotaOptions {
    /**
     * Increment step per call (default 1). Negative values allow a decrement
     * (e.g. reversal of an invoice).
     */
    incrementBy?: number;
    /**
     * When the quota is checked:
     * - `before` — before the handler runs (default; prevents the write)
     * - `after`  — after successful execution (for counters that need the
     *              result — e.g. actual storage size)
     */
    timing?: 'before' | 'after';
}
