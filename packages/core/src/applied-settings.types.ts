// What the platform records about the configuration it is running on.
//
// `config/saas.yaml` says what should be true; nothing said what IS true, and
// nobody was told when the two changed. The record here is the answer to the
// first half: the settings the installation applied at boot, a fingerprint over
// them, when they took effect and where they came from.
//
// The record is a mirror, never a source. Nothing reads it to decide
// behaviour — the file is the one place a setting lives — and the port that
// stores it is reached from the recorder and the read-only endpoint, and from
// nowhere else. A test in `@saasicat/nest` holds that.

/**
 * The settings subtree of a plan catalogue: every top-level block that is
 * configuration rather than the catalogue itself. JSON-shaped, because it is
 * stored as JSON and compared as JSON.
 */
export type AppliedSettingsValues = Record<string, unknown>;

/** The one row per installation: what is applied, since when, and from where. */
export interface AppliedSettingsRecord {
    /**
     * `sha256-<hex>` over the canonical JSON of `settings`. Two boots with the
     * same resolved values produce the same fingerprint however the file was
     * formatted, and a plan added to the catalogue does not move it.
     */
    fingerprint: string;
    settings: AppliedSettingsValues;
    /**
     * Where the values came from: the absolute path of the file the platform
     * read, or a phrase saying they were handed to it in code.
     */
    source: string;
    /** The moment these values became the running configuration. */
    appliedAt: Date;
}

/** What a boot noticed had changed since the previous record. */
export interface SettingsChangeRecord {
    id: string;
    /** The boot that noticed the difference and applied the new values. */
    noticedAt: Date;
    source: string;
    previous: AppliedSettingsValues;
    current: AppliedSettingsValues;
    /** Set once an operator has seen it; null while it is still owed a look. */
    acknowledgedAt: Date | null;
    /** Who acknowledged it — an actor tag, as the audit log writes it. */
    acknowledgedBy: string | null;
}

export type NewSettingsChange = Pick<
    SettingsChangeRecord,
    'noticedAt' | 'source' | 'previous' | 'current'
>;

/** One leaf that differs between two settings subtrees. */
export interface SettingsDifference {
    /** Dotted path, as the loader names a field: `tenantBilling.cancellationNoticeDays.monthly`. */
    path: string;
    /** `undefined` where the leaf did not exist on that side. */
    before: unknown;
    after: unknown;
}
