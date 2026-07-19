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
    /** Bucket im Library-Pool (z. B. „Core", „Communication"). */
    group?: string;
}

export interface PredecessorVersion {
    version: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    /** „Gültig ab" der Vorgänger-Version — der Draft muss strikt danach starten. */
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
 * Save-Payload = DraftForm plus die persistierte Bundle-Auswahl. `bundles`
 * wird aus der finalen Feature-Liste abgeleitet (alle voll-aktiven Bundles),
 * damit die persistierte Liste invariant konsistent zu `features` ist —
 * siehe `PlanVersionRow.bundles`.
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
