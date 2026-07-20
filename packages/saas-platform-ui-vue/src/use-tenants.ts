// useTenants — Vue composable over the admin tenants endpoint.
//
// **Endpoint is mandatory** and is supplied by the consumer, because apps
// have different `globalPrefix` conventions:
//   - `globalPrefix='api/v1'` → `/api/v1/admin/tenants`
//   - `globalPrefix='api'`    → `/api/admin/tenants`
// A hardcoded default in the platform would always serve one app wrongly.
// The composable stays prefix-neutral; app wrappers are explicit.
//
// The consumer backend exposes the endpoint via the `TenantPort.list` adapter.
// The composable types the response as `TenantDto[]` and reacts to
// filter changes (status/plan/search) with a re-fetch + reset to page 1.

import { ref, type Ref } from 'vue';
import type { TenantDto, TenantListFilter } from '@saasicat/types';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

export interface UseTenantsOptions {
    /**
     * Fully qualified tenants-list endpoint including the app globalPrefix
     * (`/api/admin/tenants`, `/api/v1/admin/tenants`, …). Mandatory — the
     * platform has no uniform default, because apps mount differently
     * (see header comment).
     */
    endpoint: string;
    /** Reactive filter; default is an empty object. */
    filter?: Ref<TenantListFilter>;
    http?: UseApiListOptions<Record<string, unknown>>['http'];
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UseTenantsResult<T extends TenantDto = TenantDto> extends UseApiListResult<T> {
    filter: Ref<TenantListFilter>;
}

/**
 * Composable for the tenants list. Generic over the row shape:
 * consumer apps with extended backend responses (plan/usage/pilot/…)
 * specialize via `useTenants<MyRow>()`.
 */
export function useTenants<T extends TenantDto = TenantDto>(
    options: UseTenantsOptions,
): UseTenantsResult<T> {
    if (!options?.endpoint) {
        throw new Error(
            'useTenants: `endpoint` ist Pflicht (z. B. "/api/v1/admin/tenants" oder ' +
                '"/api/admin/tenants"). Plattform hat keinen Default, weil Apps ' +
                'unterschiedliche globalPrefix-Konventionen haben.',
        );
    }
    const filter = options.filter ?? ref<TenantListFilter>({});
    const list = useApiList<T>({
        endpoint: options.endpoint,
        filter: filter as unknown as Ref<Record<string, unknown>>,
        http: options.http,
        getAuthToken: options.getAuthToken,
        autoLoad: options.autoLoad,
    });
    return { ...list, filter };
}
