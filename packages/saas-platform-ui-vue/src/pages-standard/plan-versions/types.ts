// Shared types of the plan version views.
//
// Phase 2c: ported from a consumer admin;
// source type generic over the platform version rows.

import type { PlanVersionRow } from '@saasicat/types';

export type PlanVersionViewMode = 'list' | 'matrix' | 'audit';

export type DraftKind = 'plan';

export interface DraftEntry {
    kind: DraftKind;
    id: string;
    label: string;
    detail: string;
    source: PlanVersionRow;
    baseId: string | null;
    hasChangeNote: boolean;
}

export interface ValidationCheck {
    ok: boolean;
    label: string;
    detail: string;
}

export interface PublishResult {
    id: string;
    label: string;
    ok: boolean;
    error?: string;
}
