// HTTP client + login adapter for `createSuperAdminApp`.
//
// TODO: adapt `adminLogin` to your backend auth — POST body and token
// storage are app-specific.

import axios from 'axios';
import { createAxiosHttpClient } from '@saasicat/ui-vue';

const TOKEN_KEY = '__APP_KEY__-admin-token';

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
});

// The instance already carries `/api/v1` as its baseURL and the platform passes
// fully-qualified paths, so the prefix is stripped back off before the request.
export const platformHttp = createAxiosHttpClient(api, { stripPrefix: '/api/v1' });

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
