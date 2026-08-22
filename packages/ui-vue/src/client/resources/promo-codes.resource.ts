// Promo codes — the discount codes an operator hands out.
//
// Not to be confused with `promotions.resource`, which is a different
// endpoint (`catalog/promotions`), a different table and a different job: a
// promotion is a price rule attached to a plan or bundle in the catalogue, a
// promo code is a string a customer types at checkout. The plan's roster
// called both "promos"; the sources call them two things, and so do we.
//
// The list does not page. `AdminResourcesPort` answers a bare array here, so
// this is a plain operation over `filterQueryString` rather than a
// `defineListOp` — a paginated descriptor would offer a paginator over a
// server that ignores it.

import type { PromoCodeRecord } from '@saasicat/core';

import { defineResource, type ResourceContext } from './define-resource.js';
import { filterQueryString } from './list-resource.js';
import { requestJson } from './resource-request.js';

/** What the promo list can be narrowed by, including its "all" state. */
export interface PromoCodesFilter {
    search?: string;
    status?: string | null;
}

function promoCodesUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/promo-codes`;
}

/** What the detail view reads: the code, its counters and who redeemed it. */
export interface PromoDetail {
    promo: Record<string, unknown> & {
        code?: string;
        valueType?: string;
        value?: number | string;
        status?: string;
    };
    stats: Record<string, unknown>;
    redemptions: Array<Record<string, unknown> & { id: string }>;
}

export const promoCodesResource = defineResource('promoCodes', {
    list: async (http, ctx, filter: PromoCodesFilter = {}): Promise<PromoCodeRecord[]> =>
        (await requestJson<PromoCodeRecord[]>(
            http,
            `${promoCodesUrl(ctx)}${filterQueryString({
                search: filter.search,
                status: filter.status,
            })}`,
        )) ?? [],

    /**
     * Returns nothing, matching `createAdminResourceClient.createPromo`.
     *
     * The endpoint does answer with the created record, but the page it feeds
     * reloads the list rather than reading it, and promising a body a caller
     * would then have to trust is a wider contract than anything holds today.
     */

    /**
     * One code with its statistics and redemptions.
     *
     * The platform's own admin controller serves list, create, update and
     * delete but NOT this — the detail view is answered by the consuming app,
     * at the path its page already calls. Recorded here rather than left as a
     * `loadDetail` prop, so the page needs no callback and an app that serves
     * it elsewhere overrides one operation instead of supplying one.
     */
    detail: async (http, ctx, id: string): Promise<PromoDetail | null> =>
        requestJson<PromoDetail>(http, `${promoCodesUrl(ctx)}/${encodeURIComponent(id)}`),

    create: async (http, ctx, payload: unknown): Promise<void> => {
        await requestJson(http, promoCodesUrl(ctx), { method: 'POST', body: payload });
    },

    update: async (http, ctx, id: string, payload: unknown): Promise<void> => {
        await requestJson(http, `${promoCodesUrl(ctx)}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: payload,
        });
    },

    remove: async (http, ctx, id: string): Promise<void> => {
        await requestJson(http, `${promoCodesUrl(ctx)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
    },
});
