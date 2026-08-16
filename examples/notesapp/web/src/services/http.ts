// HTTP client for the tenant web app.
//
// The notesapp backend authenticates by a single header instead of a real auth
// flow (see `src/auth/demo-auth.guard.ts`): whichever tenant id the user picked
// on the login screen is stored locally and sent as `x-demo-tenant` on every
// request. A real app swaps the header interceptor for `Authorization: Bearer …`
// and the localStorage session for its own token store — nothing else changes.

import axios from 'axios';
import { createAxiosHttpClient } from '@saasicat/ui-vue';

const SESSION_KEY = 'notesapp-web-tenant';
const API_BASE = '/api/v1';
const DEMO_TENANT_HEADER = 'x-demo-tenant';

export function getTenantId(): string | null {
    return localStorage.getItem(SESSION_KEY);
}

export function setTenantId(tenantId: string): void {
    localStorage.setItem(SESSION_KEY, tenantId);
}

export function clearTenantId(): void {
    localStorage.removeItem(SESSION_KEY);
}

export function isAuthenticated(): boolean {
    return !!getTenantId();
}

export const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((cfg) => {
    // Read at request time: the tenant can change (logout → login) without
    // re-creating the client.
    const tenantId = getTenantId();
    if (tenantId) cfg.headers[DEMO_TENANT_HEADER] = tenantId;
    return cfg;
});

/**
 * `HttpClient` adapter for the `@saasicat/ui-vue` composables (entitlement,
 * tenant billing). They call with either a full `/api/v1/...` endpoint or an
 * `apiPrefix`-relative path; the base axios client already holds `/api/v1`, so
 * a leading `/api/v1` is stripped to avoid a doubled prefix.
 */
export const platformHttp = createAxiosHttpClient(api, { stripPrefix: API_BASE });
