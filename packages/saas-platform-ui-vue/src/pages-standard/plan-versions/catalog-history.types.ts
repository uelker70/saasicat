import type { PlanVersionRow } from '@saasicat/types';

/**
 * Presentation contract retained for the reusable catalog timeline and diff
 * components. A future Publication Archive / Catalog History page should map
 * the immutable snapshots from saasicat#30/#35 to this shape.
 */
export type CatalogSnapshotKind = 'drafts' | 'active' | 'historical';

export interface CatalogSnapshot<P extends PlanVersionRow = PlanVersionRow> {
    id: string;
    kind: CatalogSnapshotKind;
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    label: string;
    title: string;
    description: string;
    asOf: string | null;
    createdAt: string | null;
    publishedAt: string | null;
    authorEmail: string | null;
    plans: ResolvedPlan<P>[];
    draftCount: number;
    regressionCount: number;
}

export interface ResolvedPlan<P extends PlanVersionRow = PlanVersionRow> {
    source: P;
    liveBase: P | null;
    isDraft: boolean;
    planId: string;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number;
    yearlyNet: number;
    marketed: boolean;
    version: number;
}
