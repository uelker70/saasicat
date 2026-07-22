// useAuditEntries — Vue composable over the admin audit endpoint.
//
// **The endpoint is mandatory** and is supplied by the consuming app
// (e.g. `/api/admin/audit` or `/api/v1/admin/audit`).
//
// The consumer backend exposes the endpoint via an `AuditQueryPort.list` adapter.
// The composable types the response as `AuditEntry[]`.

import { ref, type Ref } from 'vue';
import type { AuditEntry, AuditQuery } from '@saasicat/types';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

export interface UseAuditEntriesOptions {
    /**
     * Fully-qualified audit endpoint including the app's globalPrefix
     * (`/api/admin/audit`, `/api/v1/admin/audit`, …). Mandatory.
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
            'useAuditEntries: `endpoint` is required (e.g. "/api/admin/audit" ' +
                'or "/api/v1/admin/audit"). The platform has no default because ' +
                'apps use different globalPrefix conventions.',
        );
    }
    const filter = options.filter ?? ref<AuditQuery>({});
    // AuditQuery has optional-only fields; index-signature cast for the
    // useApiList constraint.
    const list = useApiList<AuditEntry>({
        endpoint: options.endpoint,
        filter: filter as unknown as Ref<Record<string, unknown>>,
        http: options.http,
        getAuthToken: options.getAuthToken,
        autoLoad: options.autoLoad,
    });
    return { ...list, filter };
}
