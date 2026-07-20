// useTenants — Vue-Composable über den Admin-Tenants-Endpoint.
//
// **Endpoint ist Pflicht** und wird vom Konsumenten geliefert, weil Apps
// unterschiedliche `globalPrefix`-Konventionen haben:
//   - `globalPrefix='api/v1'` → `/api/v1/admin/tenants`
//   - `globalPrefix='api'`    → `/api/admin/tenants`
// Ein hardcoded Default in der Plattform würde eine App immer falsch
// bedienen. Composable bleibt prefix-neutral; App-Wrapper sind explizit.
//
// Konsument-Backend exposed den Endpoint via `TenantPort.list`-Adapter.
// Composable typisiert den Response als `TenantDto[]` und reagiert auf
// Filter-Änderungen (status/plan/search) mit Re-Fetch + Reset auf Seite 1.

import { ref, type Ref } from 'vue';
import type { TenantDto, TenantListFilter } from '@saasicat/types';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

export interface UseTenantsOptions {
    /**
     * Voll-qualifizierter Tenants-List-Endpoint inkl. App-globalPrefix
     * (`/api/admin/tenants`, `/api/v1/admin/tenants`, …). Pflicht — die
     * Plattform hat keinen einheitlichen Default, weil Apps unterschiedlich
     * mounten (siehe Header-Kommentar).
     */
    endpoint: string;
    /** Reaktiver Filter; Default ist ein leeres Object. */
    filter?: Ref<TenantListFilter>;
    http?: UseApiListOptions<Record<string, unknown>>['http'];
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UseTenantsResult<T extends TenantDto = TenantDto> extends UseApiListResult<T> {
    filter: Ref<TenantListFilter>;
}

/**
 * Composable für die Tenants-Liste. Generic über das Row-Shape:
 * Konsumenten-Apps mit erweiterten Backend-Responses (Plan/Verbrauch/Pilot/…)
 * spezialisieren via `useTenants<MeineRow>()`.
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
