// Approved-Gate-Helfer (#20 Slice 5): lädt die freigegebenen Feature-/
// Quota-Keys aus den Catalog-Entries, damit Strict-Mode-Check/Seed-Gate/
// Preflight „nur Approved ist verkaufbar" prüfen können. `null`-Repo →
// `null` (Approval-Teil wird übersprungen, z. B. minimaler Deploy ohne
// Catalog-Entries).

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
