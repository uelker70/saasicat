// AuditTailFlow — `<app> audit tail [--actor=<email>] [--action=<X>] [--entity=<Y>]
//                                    [--since=<ISO>] [--limit=<N>]`.
//
// Reads the most recent audit-log entries via `AuditQueryPort` and formats
// them as an ASCII table. Read-only — no MFA, no audit log, no
// production confirm.

import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditQuery, AuditQueryPort } from '@saasicat/core';
import { AUDIT_QUERY_PORT_TOKEN } from './cli.tokens.js';

export interface AuditTailOptions {
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    /** Default 50; the adapter caps it. */
    limit?: number;
}

@Injectable()
export class AuditTailFlow {
    constructor(@Inject(AUDIT_QUERY_PORT_TOKEN) private readonly auditQuery: AuditQueryPort) {}

    async run(options: AuditTailOptions = {}): Promise<AuditEntry[]> {
        const filter: AuditQuery = {};
        if (options.actor) filter.actorTag = actorPattern(options.actor);
        if (options.action) filter.action = options.action;
        if (options.entity) filter.entity = options.entity;
        if (options.since) filter.from = options.since;
        if (options.limit) filter.pageSize = options.limit;
        return this.auditQuery.list(filter);
    }

    /** Format the result as an ASCII table for `console.table`. */
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

/**
 * `--actor` takes the e-mail the flag names, and the tags are
 * `<source>:<email>:<context>`, so an address alone is looked for between the
 * first and the last colon, whatever the source and context. A value that is
 * already a tag or a pattern — it holds a colon or a star — is passed on as it
 * is.
 */
function actorPattern(actor: string): string {
    return actor.includes(':') || actor.includes('*') ? actor : `*:${actor}:*`;
}
