// useAuditEntries — Vue-Composable über den Admin-Audit-Endpoint.
//
// **Endpoint ist Pflicht** und wird vom App-Konsumenten geliefert (AutohausPro:
// `/api/admin/audit`, vereinsfux: `/api/v1/admin/audit`).
//
// Konsument-Backend exposed den Endpoint via `AuditQueryPort.list`-Adapter.
// Composable typisiert den Response als `AuditEntry[]`.

import { ref, type Ref } from 'vue';
import type { AuditEntry, AuditQuery } from '@saasicat/types';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

export interface UseAuditEntriesOptions {
    /**
     * Voll-qualifizierter Audit-Endpoint inkl. App-globalPrefix
     * (`/api/admin/audit`, `/api/v1/admin/audit`, …). Pflicht.
     */
    endpoint: string;
    filter?: Ref<AuditQuery>;
    http?: UseApiListOptions<Record<string, unknown>>['http'];
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UseAuditEntriesResult extends UseApiListResult<AuditEntry> {
    filter: Ref<AuditQuery>;
}

export function useAuditEntries(options: UseAuditEntriesOptions): UseAuditEntriesResult {
    if (!options?.endpoint) {
        throw new Error(
            'useAuditEntries: `endpoint` ist Pflicht (z. B. "/api/admin/audit" ' +
                'oder "/api/v1/admin/audit"). Plattform hat keinen Default, weil ' +
                'Apps unterschiedliche globalPrefix-Konventionen haben.',
        );
    }
    const filter = options.filter ?? ref<AuditQuery>({});
    // AuditQuery hat optional-only-Felder; Index-Signature-Cast für
    // useApiList-Constraint.
    const list = useApiList<AuditEntry>({
        endpoint: options.endpoint,
        filter: filter as unknown as Ref<Record<string, unknown>>,
        http: options.http,
        getAuthToken: options.getAuthToken,
        autoLoad: options.autoLoad,
    });
    return { ...list, filter };
}
