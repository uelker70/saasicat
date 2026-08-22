import type { BundleAggregateStatus } from '../../features/bundle/internal/bundle-version-status.js';

export type BundlesStatusFilter = 'all' | BundleAggregateStatus;

export interface BundlesStatusFilterOption {
    label: string;
    value: BundlesStatusFilter;
}

export interface BundleEditForm {
    label: string;
    description: string;
    icon: string;
    sortOrder: number;
}
