// Catalogue promotions — price rules attached to a plan, bundle or offer.
//
// A sibling of `promo-codes.resource` in name only; see the note there for
// why the two are separate. This one lives under `catalog/`, is scoped to a
// project, and never reaches a customer directly.

import type { CreatePromotionData, PromotionRow, UpdatePromotionData } from '@saasicat/types';

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

function promotionsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/promotions`;
}

export const promotionsResource = defineResource(
    'promotions',
    {
        list: async (http, ctx): Promise<PromotionRow[]> =>
            (await requestJson<PromotionRow[]>(
                http,
                `${promotionsUrl(ctx)}?projectKey=${encodeURIComponent(ctx.projectKey)}`,
            )) ?? [],

        create: (http, ctx, data: CreatePromotionData): Promise<PromotionRow> =>
            requestJsonBody<PromotionRow>(http, promotionsUrl(ctx), 'Create returned no body', {
                method: 'POST',
                body: data,
            }),

        update: (http, ctx, id: string, data: UpdatePromotionData): Promise<PromotionRow> =>
            requestJsonBody<PromotionRow>(
                http,
                `${promotionsUrl(ctx)}/${id}`,
                'Update returned no body',
                { method: 'PATCH', body: data },
            ),

        remove: async (http, ctx, id: string): Promise<void> => {
            await requestJson(http, `${promotionsUrl(ctx)}/${id}`, { method: 'DELETE' });
        },
    },
    { projectScoped: true },
);
