// DiscoverySnapshot — wire format of the code-discovery endpoint
// (`GET /admin/discovery`).
//
// Describes the **code state** at boot time: which capabilities,
// features, and quotas has the running backend annotated? Bundles are
// deliberately NOT aggregated from code — they are planned exclusively
// by the SuperAdmin in the UI (DB table `bundles`, see SPEC_V2
// §3 + §11.1 M3).
//
// Built by the DiscoveryScanner in saas-platform-nest and consumed by
// the SuperAdmin UI in saas-platform-ui-vue.
//
// Unlike CapabilityCatalogEntryRow/FeatureCatalogEntryRow
// (see catalog-entry.types.ts), this is a pure code snapshot —
// no review status, no marketing, no DB persistence.

import type { CapabilityKind } from './catalog-entry.types.js';

/**
 * Code status of a capability in the decorator (`@ImplementsCapability`):
 *
 * - `active`       — normally usable (default)
 * - `experimental` — WIP capability; shown in the UI with a warning
 * - `deprecated`   — to be replaced (`replacementKey` recommended)
 * - `internal`     — does not appear in the SuperAdmin UI, but in the snapshot hash
 */
export type DiscoveryCodeStatus = 'active' | 'experimental' | 'deprecated' | 'internal';

/**
 * A single capability entry in the DiscoverySnapshot — matches the
 * wire format that `/admin/discovery` delivers.
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
     * Feature keys that this capability's feature requires at runtime
     * (#35). `null` = no dependencies — the default, so that snapshots
     * from older platform versions stay readable unchanged.
     */
    requires: string[] | null;
    /**
     * Old feature keys that this capability's feature replaces (#39,
     * hard path: the old code has already been deleted). `null` = none.
     */
    replaces: string[] | null;
    /**
     * Where the capability is declared — `ClassName.methodName` for
     * methods, `ClassName` for class level. Helps with forensics /
     * discovery diff.
     */
    declaredAt: string;
}

/** Aggregate of several capabilities with `feature: 'X'`. */
export interface DiscoveredFeature {
    featureKey: string;
    /** Capability keys that declare this feature via `feature: 'X'`. */
    capabilityKeys: string[];
    /**
     * Union of the capability `requires` minus its own featureKey (#35).
     * `null` = no dependencies (backward-compatible with old snapshots).
     */
    requires: string[] | null;
    /** Union of the capability `replaces` (#39). `null` = none. */
    replaces: string[] | null;
}

/**
 * Quota policy:
 * - `monthlyReset` — counter is reset to 0 at the start of the month
 * - `continuous`   — counter grows monotonically (e.g. storage consumption)
 * - `hardCap`      — on overrun, HTTP 429 / domain-level block
 */
export type DiscoveredQuotaPolicy = 'monthlyReset' | 'continuous' | 'hardCap';

/** A quota declared in code via `@DefinesQuota`. */
export interface DiscoveredQuota {
    quotaKey: string;
    label: string;
    unit: string;
    policy: DiscoveredQuotaPolicy;
    feature: string | null;
    /** Old quotaKeys that this quota replaces (#39). `null` = none. */
    replaces: string[] | null;
    /** Where the quota is declared — `ClassName`. */
    declaredAt: string;
    /** Capability keys that reference this quota via `@EnforceQuota(quotaKey)`. */
    enforcedBy: string[];
}

/**
 * Complete discovery snapshot — built at boot time, delivered as JSON by
 * the AdminController, checked against the DB catalog by the strict-mode
 * check (SPEC_V2 §8).
 */
export interface DiscoverySnapshot {
    schemaVersion: 1;
    /** ISO timestamp of the boot-time scan. */
    scannedAt: string;
    app: {
        /** projectKey, same concept as in the catalog tables. */
        key: string;
        /** Backend version, e.g. from package.json. */
        version: string;
    };
    capabilities: DiscoveredCapability[];
    features: DiscoveredFeature[];
    quotas: DiscoveredQuota[];
    /**
     * Canonical SHA256 hash over sorted/normalized snapshot data.
     * Stable across boot restarts, serves as the ETag for `/admin/discovery`.
     */
    hash: string;
}
