export interface TenantDetailData {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    vatId?: string | null;
    subscription?: {
        plan?: string | null;
        status?: string | null;
        isPilot?: boolean | null;
        trialEndsAt?: string | null;
        pilotEndsAt?: string | null;
    } | null;
    users?: Array<Record<string, unknown> & { id: string }>;
    /** Freely selectable usage numbers — the page renders them via `verbrauchFields`. */
    counts?: Record<string, number | string>;
}

export interface VerbrauchField {
    label: string;
    /** Lookup key in `data.counts`. */
    key?: string;
    /** Alternative: custom getter. Takes precedence over `key`. */
    getter?: (data: TenantDetailData) => string | number;
}

/**
 * The resolved labels for the master-data block. The page owns the i18n
 * lookup and the per-label prop overrides; the block only renders them.
 */
export interface TenantMasterDataLabels {
    plan: string;
    status: string;
    pilot: string;
    trialEnd: string;
    pilotEnd: string;
    vatId: string;
}
