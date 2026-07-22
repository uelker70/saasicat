// HTTP client + login adapter for `createSuperAdminApp`.
//
// TODO: adapt `adminLogin` to your backend auth — POST body and token
// storage are app-specific.

import axios from 'axios';
import type { HttpClient, HttpResponse } from '@saasicat/ui-vue';

const TOKEN_KEY = '__PROJECT_KEY__-admin-token';

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
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
        text: async () =>
            typeof r.data === 'string' ? r.data : JSON.stringify(r.data),
    };
    return res;
};

export async function adminLogin(email: string, password: string) {
    try {
        // TODO: replace the endpoint with your auth backend.
        const r = await api.post('/auth/admin-login', { email, password });
        localStorage.setItem(TOKEN_KEY, r.data.token);
        return { ok: true as const };
    } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        return {
            ok: false as const,
            code: status === 401 ? 'BAD_CREDENTIALS' : 'unknown',
        };
    }
}

export function isAuthenticated(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
}

/** Auth-token provider for the platform loaders (`Authorization: Bearer …`). */
export function getAuthToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}
