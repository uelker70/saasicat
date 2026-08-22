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

    /**
     * Issues a new password and reports the one-time value when the backend
     * generates one. Void means "changed, tell the user by mail" — both shapes
     * exist in the wild, and the page renders the password only when it gets one.
     *
     * The platform serves no such route: this is the path the consumers already
     * call (`/users/:id/reset-password`), written down so a page does not need
     * a callback for it. `reason` is required because the audit trail records it.
     */
    resetPassword: (
        http,
        ctx,
        id: string,
        reason: string,
        mfaCode?: string,
    ): Promise<{ oneTimePassword?: string } | null> =>
        requestJson<{ oneTimePassword?: string }>(
            http,
            `${usersUrl(ctx)}/${encodeURIComponent(id)}/reset-password`,
            {
                method: 'POST',
                body: { reason },
                headers: mfaCode ? { 'X-Mfa-Code': mfaCode } : undefined,
            },
        ),

    /** Same contract as `resetPassword`: app-served, audit-logged, MFA-gated. */
    deactivate: async (http, ctx, id: string, reason: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${usersUrl(ctx)}/${encodeURIComponent(id)}/deactivate`, {
            method: 'POST',
            body: { reason },
            headers: mfaCode ? { 'X-Mfa-Code': mfaCode } : undefined,
        });
    },
});
