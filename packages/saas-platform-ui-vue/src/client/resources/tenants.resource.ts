// The tenant list.
//
// One operation, deliberately: the list `useTenants` requests today. Tenant
// detail, suspend and reactivate still live in `createAdminResourceClient` and
// move here with the page that calls them — a descriptor nothing calls has
// nothing keeping it honest.
//
// The request pages; the controller does not. `AdminResourcesPort.listTenants`
// takes `status`/`plan`/`search` and answers with a bare array — no `page`, no
// `total` — while the paginated `TenantPort.list` no controller exposes returns
// `Paginated<TenantDto>`. So `page` and `pageSize` go out on every request and
// today nothing on the far side reads them. That is exactly what `useApiList`
// has been sending, and reproducing it is the point: what the server does with
// the parameters is the server's to change, and a descriptor that quietly sent
// less would be a different request wearing the same name.

import type { TenantDto, TenantListFilter } from '@saasicat/types';

import { defineResource } from './define-resource.js';
import { defineListOp, type ListFilterOf } from './list-resource.js';

/** What the tenants list can be narrowed by. The page number is not a filter. */
export type TenantsListFilter = ListFilterOf<TenantListFilter>;

export const tenantsResource = defineResource('tenants', {
    list: defineListOp<TenantDto, TenantsListFilter>((ctx) => `${ctx.apiBase}/tenants`),
});
