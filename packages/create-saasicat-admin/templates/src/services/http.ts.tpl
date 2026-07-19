// HTTP-Client + LoginAdapter für `createSuperAdminApp`.
//
// TODO: `adminLogin` an dein Backend-Auth anpassen — POST-Body und Token-
// Speicherung sind App-spezifisch.

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
        // TODO: ersetze den Endpoint durch dein Auth-Backend.
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
