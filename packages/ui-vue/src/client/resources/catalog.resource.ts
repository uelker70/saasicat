// The capability / feature / quota catalogue.
//
// `load()` in `useCatalogEntries` fetches the three lists in one `Promise.all`
// and writes three refs. Here they are three operations: the descriptor's job
// is the request, and which of them a caller needs — a page showing only
// quotas asks for one — is the caller's to decide.

import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18n,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    ReviewCatalogEntryData,
    SyncDiscoveryResult,
    UpdateCatalogEntryBaseData,
} from '@saasicat/core';

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

function catalogUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog`;
}

/**
 * The discovered catalogue and the review decisions taken on it.
 *
 * Entry keys are encoded on the way into the path — that is what
 * `useCatalogEntries` does, and a feature key legitimately contains characters
 * (`.`, `:`) that a code scan produces.
 */
export const catalogResource = defineResource('catalog', {
    capabilities: async (http, ctx): Promise<CapabilityCatalogEntryRow[]> =>
        (await requestJson<CapabilityCatalogEntryRow[]>(http, `${catalogUrl(ctx)}/capabilities`)) ??
        [],

    features: async (http, ctx): Promise<FeatureCatalogEntryRow[]> =>
        (await requestJson<FeatureCatalogEntryRow[]>(http, `${catalogUrl(ctx)}/features`)) ?? [],

    quotas: async (http, ctx): Promise<QuotaCatalogEntryRow[]> =>
        (await requestJson<QuotaCatalogEntryRow[]>(http, `${catalogUrl(ctx)}/quotas`)) ?? [],

    reviewFeature: (
        http,
        ctx,
        featureKey: string,
        data: ReviewCatalogEntryData,
    ): Promise<FeatureCatalogEntryRow> =>
        requestJsonBody<FeatureCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/features/${encodeURIComponent(featureKey)}/review`,
            'Review returned no body',
            { method: 'PATCH', body: data },
        ),

    reviewQuota: (
        http,
        ctx,
        quotaKey: string,
        data: ReviewCatalogEntryData,
    ): Promise<QuotaCatalogEntryRow> =>
        requestJsonBody<QuotaCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/quotas/${encodeURIComponent(quotaKey)}/review`,
            'Review returned no body',
            { method: 'PATCH', body: data },
        ),

    /** The translations are wrapped in `{ i18n }` here, not by the caller. */
    setFeatureI18n: (
        http,
        ctx,
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow> =>
        requestJsonBody<FeatureCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/features/${encodeURIComponent(featureKey)}/i18n`,
            'i18n returned no body',
            { method: 'PATCH', body: { i18n } },
        ),

    setQuotaI18n: (
        http,
        ctx,
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow> =>
        requestJsonBody<QuotaCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/quotas/${encodeURIComponent(quotaKey)}/i18n`,
            'i18n returned no body',
            { method: 'PATCH', body: { i18n } },
        ),

    setFeatureBase: (
        http,
        ctx,
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> =>
        requestJsonBody<FeatureCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/features/${encodeURIComponent(featureKey)}`,
            'Base returned no body',
            { method: 'PATCH', body: data },
        ),

    setQuotaBase: (
        http,
        ctx,
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> =>
        requestJsonBody<QuotaCatalogEntryRow>(
            http,
            `${catalogUrl(ctx)}/quotas/${encodeURIComponent(quotaKey)}`,
            'Base returned no body',
            { method: 'PATCH', body: data },
        ),

    /**
     * Writes a discovery snapshot into the catalogue.
     *
     * The request only. `useCatalogEntries.syncDiscovery` reloads the three
     * lists afterwards, which is that composable keeping its refs true —
     * not part of the call, and not something an override should inherit
     * invisibly.
     */
    syncDiscovery: (http, ctx, snapshot: DiscoverySnapshot): Promise<SyncDiscoveryResult> =>
        requestJsonBody<SyncDiscoveryResult>(
            http,
            `${catalogUrl(ctx)}/discovery/sync`,
            'Sync returned no body',
            { method: 'POST', body: { snapshot } },
        ),
});
