// The audit trail.
//
// ── Which vocabulary this endpoint speaks ─────────────────────────────────
//
// The package held two audit contracts, and this descriptor used to be on the
// wrong side of them. Measured against the platform's own controller
// (`@Get('audit')` in `@saasicat/nest`'s generated admin resources):
//
//   the route accepts  actor, action, entity, since, limit   → a bare array
//   `AuditQuery` says  actorTag, from, to, page, pageSize    → a page
//
// `AuditQuery` is the vocabulary of `AuditQueryPort`, one layer BELOW the HTTP
// boundary — the Prisma adapter translates `actor` into `actorTag: *actor*` and
// `since` into `from` before it ever reaches the port. So a descriptor sending
// `actorTag` at this URL sends a parameter the controller does not read: the
// filter is dropped and the operator gets an unfiltered list that looks
// filtered.
//
// It was latent, because nothing consumed the descriptor. `AuditPage` moving
// onto it is what would have made it live, and that is the "page rebuild that
// can move both sides at once" the previous version of this comment deferred
// to.
//
// `useAuditEntries` is NOT the counterpart. It takes an endpoint from the app
// and speaks `AuditQuery`, for a consumer that exposes `AuditQueryPort` over
// its own route. The counterpart is `createAdminResourceClient.loadAudit`,
// which reads the same platform route — and `tests/resources-match-the-
// composables.test.js` pairs them.

import type { AdminAuditListFilter, AuditEntry } from '@saasicat/core';

import { defineResource } from './define-resource.js';
import { filterQueryString } from './list-resource.js';
import { requestJson } from './resource-request.js';

/**
 * What the audit list can be narrowed by — the controller's query parameters.
 *
 * Not paginated: the route answers with a bare array and caps the size through
 * `limit`. `useResourceList` is therefore not the way to read it; a page calls
 * `list` and renders what comes back.
 */
export type AuditListFilter = AdminAuditListFilter;

export const auditResource = defineResource('audit', {
    list: async (http, ctx, filter: AuditListFilter = {}): Promise<AuditEntry[]> =>
        (await requestJson<AuditEntry[]>(
            http,
            `${ctx.apiBase}/audit${filterQueryString({
                actor: filter.actor,
                action: filter.action,
                entity: filter.entity,
                since: filter.since,
                limit: filter.limit,
            })}`,
        )) ?? [],
});
