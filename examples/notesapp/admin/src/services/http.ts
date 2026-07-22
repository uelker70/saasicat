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
import type { HttpClient, HttpResponse } from '@saasicat/ui-vue';

const SESSION_KEY = 'notesapp-admin-session';

/** Tenant id the DemoAuthGuard maps the SuperAdmin surface to. */
const DEMO_ADMIN_TENANT = 'admin';
const DEMO_ADMIN_ROLE = 'SUPER_ADMIN';

/** The demo backend accepts any caller; the form still expects a password. */
const DEMO_EMAIL = 'admin@notesapp.example';
const DEMO_PASSWORD = 'demo';

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
    if (isAuthenticated()) {
        cfg.headers['x-demo-tenant'] = DEMO_ADMIN_TENANT;
        cfg.headers['x-demo-role'] = DEMO_ADMIN_ROLE;
    }
    return cfg;
});

export const platformHttp: HttpClient = async (url, init) => {
    const stripped = url.startsWith('/api/v1') ? url.slice(7) : url;
    const r = await api.request({
        url: stripped,
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        headers: init?.headers,
        data: init?.body,
        validateStatus: (s) => s < 500,
    });
    const res: HttpResponse = {
        status: r.status,
        headers: {
            get: (n) => {
                const v = r.headers[n.toLowerCase()];
                return v == null ? null : String(v);
            },
        },
        json: async () => r.data,
        text: async () => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)),
    };
    return res;
};

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
 * Token provider for the platform loaders. The demo backend reads headers
 * rather than a bearer token, so there is nothing to hand out.
 */
export function getAuthToken(): string | null {
    return null;
}

/** Credentials the login page shows outside production builds. */
export const DEMO_CREDENTIALS = { email: DEMO_EMAIL, password: DEMO_PASSWORD };
