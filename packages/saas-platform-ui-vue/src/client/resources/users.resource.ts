// The platform user list.
//
// Unpaginated, like the promo list and unlike the tenant list: the controller
// answers a bare array filtered by `q` and `tenant`. So this is a plain
// operation over `filterQueryString` rather than a `defineListOp` — see the
// note on `promo-codes.resource`.

import type { AdminUserListFilter, AdminUserListRow } from '@saasicat/types';

import { defineResource, type ResourceContext } from './define-resource.js';
import { filterQueryString } from './list-resource.js';
import { requestJson } from './resource-request.js';

function usersUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/users`;
}

export const usersResource = defineResource('users', {
    /**
     * `q` searches name and mail, `tenant` narrows to one tenant's members.
     *
     * Both are dropped when empty rather than sent as `q=` — see
     * `isSentInQuery`; an empty search that reached the server would filter
     * every row away on an endpoint that treats the parameter as a substring.
     */
    list: async (http, ctx, filter: AdminUserListFilter = {}): Promise<AdminUserListRow[]> =>
        (await requestJson<AdminUserListRow[]>(
            http,
            `${usersUrl(ctx)}${filterQueryString({ q: filter.q, tenant: filter.tenant })}`,
        )) ?? [],
});
