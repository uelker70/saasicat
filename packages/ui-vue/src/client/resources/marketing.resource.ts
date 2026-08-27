// Marketing projections and the locale settings that go with them.
//
// Two endpoints under one key because they are one screen's data:
// `MarketingCatalogPage` reads the projections and the active-locale set
// together, and today it reaches the second one with a hand-written `fetch`
// through its own `httpClient` prop while the first goes through
// `useMarketingProjections`. One resource, two stems.
//
// The list filter keeps the composable's parameter order — `targetType`,
// `targetVersionId`, `locale` — because that is the URL the page requests
// today and a reordered query string is a different request to anything that
// caches or logs one.

import type {
    CreateMarketingProjectionData,
    MarketingProjectionRow,
    MarketingSettingsRow,
    UpdateMarketingProjectionData,
} from '@saasicat/core';

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

/** What the projection list can be narrowed by. */
export interface MarketingProjectionsFilter {
    targetType?: string;
    targetVersionId?: string;
    locale?: string;
}

function projectionsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/marketing-projections`;
}

function settingsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/marketing-settings`;
}

/**
 * An unfiltered list is the ordinary case now that the project is not a filter
 * part, and `${url}?` is a different URL to `${url}` for anything that caches
 * or logs one.
 */
function withQuery(url: string, params: URLSearchParams): string {
    const query = params.toString();
    return query ? `${url}?${query}` : url;
}

export const marketingResource = defineResource('marketing', {
    listProjections: async (
        http,
        ctx,
        filter: MarketingProjectionsFilter = {},
    ): Promise<MarketingProjectionRow[]> => {
        const params = new URLSearchParams();
        if (filter.targetType) params.set('targetType', filter.targetType);
        if (filter.targetVersionId) params.set('targetVersionId', filter.targetVersionId);
        if (filter.locale) params.set('locale', filter.locale);
        return (
            (await requestJson<MarketingProjectionRow[]>(
                http,
                withQuery(projectionsUrl(ctx), params),
            )) ?? []
        );
    },

    /**
     * The request only. `useMarketingProjections.create` reloads the list
     * afterwards because a unique-tuple insert can change what the filter
     * matches — that is the composable keeping its refs true, not part of
     * the call.
     */
    createProjection: (
        http,
        ctx,
        data: CreateMarketingProjectionData,
    ): Promise<MarketingProjectionRow> =>
        requestJsonBody<MarketingProjectionRow>(
            http,
            projectionsUrl(ctx),
            'Create returned no body',
            { method: 'POST', body: data },
        ),

    updateProjection: (
        http,
        ctx,
        id: string,
        data: UpdateMarketingProjectionData,
    ): Promise<MarketingProjectionRow> =>
        requestJsonBody<MarketingProjectionRow>(
            http,
            `${projectionsUrl(ctx)}/${id}`,
            'Update returned no body',
            { method: 'PATCH', body: data },
        ),

    deleteProjection: async (http, ctx, id: string): Promise<void> => {
        await requestJson(http, `${projectionsUrl(ctx)}/${id}`, { method: 'DELETE' });
    },

    /**
     * The activated locale subset, or `null` when none was ever stored.
     *
     * `null` means the full pool is active — the server's answer for "no
     * row", and the state the page falls back to.
     */
    settings: (http, ctx): Promise<MarketingSettingsRow | null> =>
        requestJson<MarketingSettingsRow>(http, settingsUrl(ctx)),

    /** `PUT`, not `PATCH`: the endpoint replaces the set it is given. */
    saveSettings: async (http, ctx, activeLocales: readonly string[]): Promise<void> => {
        await requestJson(http, settingsUrl(ctx), {
            method: 'PUT',
            body: { activeLocales },
        });
    },
});
