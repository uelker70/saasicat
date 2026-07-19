import type { BundleAggregateStatus } from '../../components/bundle-editor/bundle-version-status.js';

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
