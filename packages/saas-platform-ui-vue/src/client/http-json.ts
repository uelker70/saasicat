// Shared JSON helpers over the injectable `HttpClient`. A single
// request/error path for all pre-login calls (boot, setup status, setup),
// instead of raw `fetch` with divergent error handling per component. A
// consumer `HttpClient` (auth header, baseURL, retry) then applies everywhere.

import { AdminError } from './admin-error.js';
import type { HttpClient } from './types.js';

/**
 * @deprecated Renamed to {@link AdminError}, which is the same class: an
 * `instanceof HttpJsonError` check keeps working and now also matches errors
 * raised elsewhere in the package. Construction changed — `AdminError` takes
 * one options object instead of `(status, code)`.
 */
export const HttpJsonError = AdminError;
export type HttpJsonError = AdminError;

/**
 * Reads the error body once, for both of the things it can carry: the
 * machine-readable `code` a caller maps to its own wording, and the `message`
 * that is the only text available when the code is unknown to it.
 */
async function readErrorBody(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
        return await res.json();
    } catch {
        // A non-JSON error body (an HTML error page, an empty response) is not
        // itself a failure — the status is what the caller acts on.
        return undefined;
    }
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

async function failed(
    res: { status: number; json(): Promise<unknown> },
    method: string,
    url: string,
): Promise<AdminError> {
    const body = await readErrorBody(res);
    const record =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
    return new AdminError({
        status: res.status,
        code: asString(record?.code),
        body,
        url,
        method,
        detail: asString(record?.message),
    });
}

/**
 * Removes trailing slashes so an API prefix can be concatenated with paths
 * that start with `/`. Deliberately index-based instead of
 * `replace(/\/+$/, '')`: the regex backtracks quadratically on inputs that
 * end in many slashes.
 */
export function trimTrailingSlashes(url: string): string {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

export async function getJson<T>(http: HttpClient, url: string): Promise<T> {
    const res = await http(url);
    if (res.status < 200 || res.status >= 300) {
        throw await failed(res, 'GET', url);
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
        throw await failed(res, 'POST', url);
    }
    return (await res.json()) as T;
}
