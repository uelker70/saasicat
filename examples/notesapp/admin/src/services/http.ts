// HTTP client + login adapter for `createSuperAdminApp`.
//
// The notesapp backend authenticates with two plain headers instead of a real
// auth flow (see `src/auth/demo-auth.guard.ts`), so there is no token endpoint
// to call. "Logging in" here only records the demo identity locally; every
// request then carries the headers the DemoAuthGuard reads.
//
// A real app replaces `adminLogin` with its auth backend and the header
// interceptor with `Authorization: Bearer …` — nothing else changes.

import axios from 'axios';
import { createAxiosHttpClient } from '@saasicat/ui-vue';

const SESSION_KEY = 'notesapp-admin-session';

/** Tenant id the DemoAuthGuard maps the SuperAdmin surface to. */
const DEMO_ADMIN_TENANT = 'admin';
const DEMO_ADMIN_ROLE = 'SUPER_ADMIN';

/** The demo backend accepts any caller; the form still expects a password. */
const DEMO_EMAIL = 'admin@notesapp.example';
const DEMO_PASSWORD = 'demo';

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
    // Unconditional: `/admin/boot` runs before the login page has a session,
    // and this backend authenticates every route by header.
    cfg.headers['x-demo-tenant'] = DEMO_ADMIN_TENANT;
    cfg.headers['x-demo-role'] = DEMO_ADMIN_ROLE;
    return cfg;
});

// The instance already carries `/api/v1` as its baseURL, and the platform
// passes fully-qualified paths — so the prefix is stripped back off before the
// request, or it would be sent twice.
export const platformHttp = createAxiosHttpClient(api, { stripPrefix: '/api/v1' });

export async function adminLogin(email: string, password: string) {
    if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        return { ok: false as const, code: 'BAD_CREDENTIALS' };
    }
    localStorage.setItem(SESSION_KEY, DEMO_ADMIN_TENANT);
    return { ok: true as const };
}

export function isAuthenticated(): boolean {
    return !!localStorage.getItem(SESSION_KEY);
}

/**
 * Ends the session `adminLogin` started.
 *
 * `isAuthenticated()` above reads exactly this key, so leaving it in place
 * would make every sign-out a no-op: the next navigation to `/admin` passes
 * the guard again.
 */
export function adminLogout(): void {
    localStorage.removeItem(SESSION_KEY);
}

/**
 * Token provider for the platform loaders. The demo backend reads headers
 * rather than a bearer token, so there is nothing to hand out.
 */
export function getAuthToken(): string | null {
    return null;
}

/** Credentials the login page shows outside production builds. */
export const DEMO_CREDENTIALS = { email: DEMO_EMAIL, password: DEMO_PASSWORD };
