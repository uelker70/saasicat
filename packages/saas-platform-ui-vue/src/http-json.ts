// Shared JSON helpers over the injectable `HttpClient`. A single
// request/error path for all pre-login calls (boot, setup status, setup),
// instead of raw `fetch` with divergent error handling per component. A
// consumer `HttpClient` (auth header, baseURL, retry) then applies everywhere.

import type { HttpClient } from './types.js';

/**
 * Error for non-2xx responses. `code` is the machine-readable error code
 * from the JSON body (`{ code }`), if present — callers map it to
 * a message (e.g. via `SETUP_ERROR_CODES`).
 */
export class HttpJsonError extends Error {
    constructor(
        readonly status: number,
        readonly code?: string,
    ) {
        super(code ?? `HTTP ${status}`);
        this.name = 'HttpJsonError';
    }
}

async function extractCode(res: { json(): Promise<unknown> }): Promise<string | undefined> {
    try {
        const body = (await res.json()) as { code?: unknown } | null;
        return typeof body?.code === 'string' ? body.code : undefined;
    } catch {
        return undefined;
    }
}

export async function getJson<T>(http: HttpClient, url: string): Promise<T> {
    const res = await http(url);
    if (res.status < 200 || res.status >= 300) {
        throw new HttpJsonError(res.status, await extractCode(res));
    }
    return (await res.json()) as T;
}

export async function postJson<T>(http: HttpClient, url: string, body: unknown): Promise<T> {
    const res = await http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
        throw new HttpJsonError(res.status, await extractCode(res));
    }
    return (await res.json()) as T;
}
