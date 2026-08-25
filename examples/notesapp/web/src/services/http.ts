// HTTP client for the tenant web app.
//
// The notesapp backend authenticates by two plain headers instead of a real auth
// flow (see `src/auth/demo-auth.guard.ts`): whichever tenant id the user picked
// on the login screen is stored locally and sent as `x-demo-tenant`, and the
// role this demo person holds inside their own tenant goes with it. A real app
// swaps the header interceptor for `Authorization: Bearer …` and the
// localStorage session for its own token store — nothing else changes.
//
// The role is not optional here, and that was a defect for as long as this file
// sent only the tenant. `TenantAdminGuard` protects the five cost-relevant
// routes — plan preview, plan change, initial subscription, accepting a pending
// version, cancelling — and reads `platformRole`. Without the header it is
// `undefined`, so every one of them answered 403 `TENANT_ADMIN_REQUIRED` and the
// whole "Change plan" flow was unreachable in this example.
//
// `TENANT_ADMIN` rather than a picker: the person managing their own
// subscription IS their tenant's admin. A real app takes this from the token.

import axios from 'axios';
import { createAxiosHttpClient } from '@saasicat/ui-vue';

const SESSION_KEY = 'notesapp-web-tenant';
const API_BASE = '/api/v1';
const DEMO_TENANT_HEADER = 'x-demo-tenant';
const DEMO_ROLE_HEADER = 'x-demo-role';
const DEMO_ROLE = 'TENANT_ADMIN';

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
    if (tenantId) {
        cfg.headers[DEMO_TENANT_HEADER] = tenantId;
        cfg.headers[DEMO_ROLE_HEADER] = DEMO_ROLE;
    }
    return cfg;
});

/**
 * `HttpClient` adapter for the `@saasicat/ui-vue` composables (entitlement,
 * tenant billing). They call with either a full `/api/v1/...` endpoint or an
 * `apiPrefix`-relative path; the base axios client already holds `/api/v1`, so
 * a leading `/api/v1` is stripped to avoid a doubled prefix.
 */
export const platformHttp = createAxiosHttpClient(api, { stripPrefix: API_BASE });
