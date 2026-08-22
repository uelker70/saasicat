import type { PlanRow, PlanVersionRow } from '@saasicat/types';

export interface PlanArchiveTarget {
    plan: PlanRow;
    hasLive: boolean;
}

export interface PlanDiscardTarget {
    plan: PlanRow;
    draft: PlanVersionRow;
}

export interface RegressionChange {
    field: string;
    oldValue: unknown;
    newValue: unknown;
    direction: 'REGRESSION' | 'IMPROVEMENT' | string;
}
