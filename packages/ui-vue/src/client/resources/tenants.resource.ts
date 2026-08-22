// The tenant list, one tenant, and the two states an operator can put it in.
//
// The request pages; the controller does not. `AdminResourcesPort.listTenants`
// takes `status`/`plan`/`search` and answers with a bare array — no `page`, no
// `total` — while the paginated `TenantPort.list` no controller exposes returns
// `Paginated<TenantDto>`. So `page` and `pageSize` go out on every request and
// today nothing on the far side reads them. That is exactly what `useApiList`
// has been sending, and reproducing it is the point: what the server does with
// the parameters is the server's to change, and a descriptor that quietly sent
// less would be a different request wearing the same name.
//
// `detail`, `suspend` and `reactivate` mirror `createAdminResourceClient`,
// which is what `TenantDetailPage` receives them through today. Slugs are
// encoded on the way into the path there, so they are encoded here.

import type { AdminTenantDetail, TenantDto, TenantListFilter } from '@saasicat/types';

import { defineResource, type ResourceContext } from './define-resource.js';
import { defineListOp, type ListFilterOf } from './list-resource.js';
import { requestJson } from './resource-request.js';

/** What the tenants list can be narrowed by. The page number is not a filter. */
export type TenantsListFilter = ListFilterOf<TenantListFilter>;

function tenantsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/tenants`;
}

function tenantUrl(ctx: ResourceContext, slug: string): string {
    return `${tenantsUrl(ctx)}/${encodeURIComponent(slug)}`;
}

export const tenantsResource = defineResource('tenants', {
    list: defineListOp<TenantDto, TenantsListFilter>((ctx) => tenantsUrl(ctx)),

    detail: async (http, ctx, slug: string): Promise<AdminTenantDetail | null> =>
        requestJson<AdminTenantDetail>(http, tenantUrl(ctx, slug)),

    /**
     * Suspends a tenant. The reason is recorded on the audit trail, so it is a
     * required argument rather than an option with a default.
     */
    suspend: async (http, ctx, slug: string, reason: string): Promise<void> => {
        await requestJson(http, `${tenantUrl(ctx, slug)}/suspend`, {
            method: 'POST',
            body: { reason },
        });
    },

    reactivate: async (http, ctx, slug: string): Promise<void> => {
        await requestJson(http, `${tenantUrl(ctx, slug)}/reactivate`, { method: 'POST' });
    },
});
