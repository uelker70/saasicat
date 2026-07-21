export interface DiscoveryFeature {
    featureKey: string;
}

export interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}

export interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
}

export interface FeatureMeta {
    label?: string;
    /** Bucket in the library pool (e.g. "Core", "Communication"). */
    group?: string;
}

export interface PredecessorVersion {
    version: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    /** "Valid from" of the predecessor version — the draft must start strictly after it. */
    validFrom: string | null;
}

export interface EditorDiffRow {
    id: string;
    section: string;
    label: string;
    sub?: string;
    from?: string;
    to?: string;
    bg: string;
    border: string;
    color: string;
    sign: string;
    tag: string;
}

export interface DraftForm {
    version: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    changeNote: string;
    marketed: boolean;
    validFrom: string | null;
    validUntil: string | null;
}

/**
 * Save payload = DraftForm plus the persisted bundle selection. `bundles`
 * is derived from the final feature list (all fully-active bundles),
 * so that the persisted list is invariantly consistent with `features` —
 * see `PlanVersionRow.bundles`.
 */
export interface PlanVersionSavePayload extends DraftForm {
    bundles: string[];
}

export type PoolTab = 'features' | 'quotas' | 'bundles';
export type PoolKind = 'feature' | 'quota' | 'bundle';
export type PreviewMode = 'desktop' | 'mobile';

export interface PoolTabItem {
    id: PoolTab;
    label: string;
    count: number;
}

export interface FeatureGroup {
    key: string;
    label: string;
    rows: DiscoveryFeature[];
}

export interface ChecklistItem {
    id: string;
    label: string;
    ok: boolean;
}

export interface SelectedQuotaRow {
    quotaKey: string;
    label: string;
    unit: string;
    sub: string;
}
