// The audit trail.
//
// This descriptor speaks the contract `useAuditEntries` speaks: `AuditQuery`
// (`actorTag`, `from`, `to`, `entity`, …) over a paginated endpoint. The
// package holds a second, incompatible one — `createAdminResourceClient`
// sends `actor`/`since`/`limit` at `AdminAuditListFilter`, unpaginated, and
// that is what `AuditPage.vue` receives through its `loadAudit` prop.
//
// Two audit contracts in one package is a defect, but it is not this change's
// to settle: choosing either spelling here would send a different request than
// one of the two callers sends today. The descriptor mirrors the composable it
// is measured against, and the reconciliation belongs to the page rebuild that
// can move both sides at once.

import type { AuditEntry, AuditQuery } from '@saasicat/types';

import { defineResource } from './define-resource.js';
import { defineListOp, type ListFilterOf } from './list-resource.js';

/** What the audit list can be narrowed by. The page number is not a filter. */
export type AuditListFilter = ListFilterOf<AuditQuery>;

export const auditResource = defineResource('audit', {
    list: defineListOp<AuditEntry, AuditListFilter>((ctx) => `${ctx.apiBase}/audit`),
});
