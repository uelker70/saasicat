// AuditTailFlow — `<app> audit tail [--actor=<email>] [--action=<X>] [--entity=<Y>]
//                                    [--since=<ISO>] [--limit=<N>]`.
//
// Liest die letzten Audit-Log-Einträge über `AuditQueryPort` und formatiert
// sie als ASCII-Tabelle. Lese-only — kein MFA, kein Audit-Log, keine
// Production-Confirm.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.5 (3.3).

import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditQuery, AuditQueryPort } from '@saasicat/types';
import { AUDIT_QUERY_PORT_TOKEN } from './tokens.js';

export interface AuditTailOptions {
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    /** Default 50, max 500 — vom Konsumenten-Adapter durchgesetzt. */
    limit?: number;
}

@Injectable()
export class AuditTailFlow {
    constructor(@Inject(AUDIT_QUERY_PORT_TOKEN) private readonly auditQuery: AuditQueryPort) {}

    async run(options: AuditTailOptions = {}): Promise<AuditEntry[]> {
        const filter: AuditQuery = {};
        if (options.actor) filter.actorTag = options.actor;
        if (options.action) filter.action = options.action;
        if (options.entity) filter.entity = options.entity;
        if (options.since) filter.from = options.since;
        if (options.limit) filter.pageSize = options.limit;
        return this.auditQuery.list(filter);
    }

    /** Ergebnis als ASCII-Tabelle für `console.table` formatieren. */
    formatRows(entries: AuditEntry[]): Record<string, string>[] {
        return entries.map((e) => ({
            createdAt: e.createdAt,
            actor: e.actorTag ?? '—',
            entity: e.entity,
            entityId: this.truncate(e.entityId, 12),
            action: e.action,
        }));
    }

    private truncate(s: string, maxLen: number): string {
        return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
    }
}
