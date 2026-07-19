// Geteilte Typen der Plan-Versions-Views.
//
// Phase 2c: Aus autohauspro/admin/src/pages/components/plan-versions/types.ts
// portiert; Source-Type generisch über die Plattform-Versions-Rows.

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
