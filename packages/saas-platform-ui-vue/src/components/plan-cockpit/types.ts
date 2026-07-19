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

export interface ImpactTenant {
    name: string;
    plan: string;
    state: 'auto' | 'review' | 'conflict';
}

export interface TenantImpact {
    auto: number;
    review: number;
    conflict: number;
    examples?: ImpactTenant[];
}

export interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}

export interface FeatureMeta {
    label?: string;
}

export interface TimelineSegment {
    key: string;
    version: number;
    status: 'draft' | 'supersed' | 'live';
    flex: number;
}

export interface PlanVersionPair {
    from: PlanVersionRow;
    to: PlanVersionRow;
}

export interface DiffSummary {
    addedFeatures: string[];
    removedFeatures: string[];
    addedQuotas: Array<{ key: string; value: number }>;
    removedQuotas: Array<{ key: string; value: number }>;
    changedQuotas: Array<{ key: string; from: number; to: number }>;
    priceChanged: boolean;
    priceFrom: string;
    priceTo: string;
}

export interface DiffRow {
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
