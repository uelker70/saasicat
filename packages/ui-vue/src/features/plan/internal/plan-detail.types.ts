import type { PlanVersionRow } from '@saasicat/types';

export interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    user?: { email: string; firstName?: string; lastName?: string } | null;
    userEmail?: string | null;
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
}

export type PlanVersionStatus = 'draft' | 'live' | 'superseded';

export interface PlanVersionEditability {
    editable: boolean;
    reason: 'draft' | 'pre-active' | null;
}

export interface PlanVersionDiff {
    featuresAdded: string[];
    featuresRemoved: string[];
    quotasAdded: Array<{ key: string; value: number }>;
    quotasRemoved: Array<{ key: string; value: number }>;
    quotasChanged: Array<{ key: string; from: number; to: number }>;
    priceChanged: boolean;
}

export interface DiffRow {
    id: string;
    kind: 'add' | 'rm' | 'mod';
    sign: string;
    tag: string;
    label: string;
    key: string;
    from?: string;
    to?: string;
}

export type StatusOf = (version: PlanVersionRow) => PlanVersionStatus;
export type StatusChipOf = (version: PlanVersionRow) => string;
export type EditabilityOf = (version: PlanVersionRow) => PlanVersionEditability;
