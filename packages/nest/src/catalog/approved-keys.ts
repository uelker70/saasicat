// Approved-gate helper (#20 Slice 5): loads the approved feature/quota
// keys from the catalog entries so that strict-mode check / Seed-Gate /
// Preflight can verify "only approved is sellable". `null` repo →
// `null` (the approval part is skipped, e.g. minimal deploy without
// catalog entries).

import type { ApprovedCatalogKeys, CatalogEntryRepository } from '@saasicat/types';

export async function loadApprovedCatalogKeys(
    repo: CatalogEntryRepository | null,
    projectKey: string,
): Promise<ApprovedCatalogKeys | null> {
    if (!repo) return null;
    const [features, quotas] = await Promise.all([
        repo.listFeatures({ projectKey, discoveryStatus: 'approved' }),
        repo.listQuotas({ projectKey, discoveryStatus: 'approved' }),
    ]);
    return {
        features: new Set(features.map((f) => f.featureKey)),
        quotas: new Set(quotas.map((q) => q.quotaKey)),
    };
}
