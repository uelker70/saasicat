// The axios implementation of `HttpClient` — without depending on axios.
//
// Six near-identical copies of this function exist across the known consumer
// apps and the documentation: the notesapp admin and web apps, the scaffolder
// template, the handbook, vereinsfux and autohauspro. They differ in the
// prefix they strip and in nothing else that matters.
//
// `AxiosLike` is structural on purpose. A `dependencies` entry would make every
// consumer install axios to use a package that speaks `fetch` by default, and a
// `peerDependencies` entry would do the same with a warning instead of an
// install. The one method this needs is `request`, and any axios instance has
// it.

import type { HttpClient, HttpResponse } from '../types.js';

export interface AxiosLikeResponse {
    status: number;
    data: unknown;
    headers: unknown;
}

export interface AxiosLikeConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    validateStatus?: (status: number) => boolean;
}

/** The part of an axios instance this adapter uses. */
export interface AxiosLike {
    request(config: AxiosLikeConfig): Promise<AxiosLikeResponse>;
}

export interface AxiosHttpClientOptions {
    /**
     * Prefix(es) to remove from the start of a URL before handing it to the
     * instance, for the usual case where the instance already carries them as
     * its `baseURL`. Tried in order, first match wins — so list the longest
     * first (`['/api/v1', '/api']`), or `/api/v1/admin/x` loses only `/api`.
     */
    stripPrefix?: string | readonly string[];
}

/**
 * Removes a prefix only at a path boundary. `startsWith` alone is not enough:
 * `/api/v10/x` starts with `/api/v1` and would be cut to `0/x`, which is the
 * shape of the `url.slice(7)` the copies of this function all used.
 */
function stripped(url: string, prefixes: readonly string[]): string {
    for (const prefix of prefixes) {
        if (!prefix || !url.startsWith(prefix)) continue;
        const rest = url.slice(prefix.length);
        if (rest === '') return '/';
        if (rest.startsWith('/')) return rest;
    }
    return url;
}

/**
 * Reads a header without knowing how the instance spells it.
 *
 * Both casings occur on the reading side too: the manifest loader asks for
 * `ETag` and then for `etag`, because it could not rely on the shims agreeing.
 * Answering both is what makes that second attempt unnecessary.
 */
function headerReader(headers: unknown): (name: string) => string | null {
    const record =
        typeof headers === 'object' && headers !== null ? (headers as Record<string, unknown>) : {};
    const lowered = new Map<string, unknown>();
    for (const [key, value] of Object.entries(record)) lowered.set(key.toLowerCase(), value);
    return (name) => {
        const value = lowered.get(name.toLowerCase());
        return value == null ? null : String(value);
    };
}

/**
 * Adapts an axios instance to `HttpClient`.
 *
 * Two decisions are worth knowing about, because five of the six shims this
 * replaces made them differently:
 *
 * **No status throws.** `validateStatus` accepts everything, so a 402, a 404
 * and a 500 all arrive as responses. The shims used `status < 500`, which let
 * a server error escape as an axios rejection — a second error shape, from the
 * one seam whose whole purpose is to have one. The platform reads the status
 * itself everywhere (a 304 is a cache hit, a 402 carries a limit payload), and
 * it can only do that for statuses it is handed.
 *
 * **`json()` parses a string.** An instance with `transformResponse` disabled
 * hands back the raw body, so a string means unparsed JSON and is parsed here.
 * It follows that a response whose body is a bare JSON string round-trips as
 * that string — the admin API returns objects and arrays, never a naked
 * scalar — and that a non-JSON body throws, exactly as `Response.json()` does.
 */
export function createAxiosHttpClient(
    instance: AxiosLike,
    options: AxiosHttpClientOptions = {},
): HttpClient {
    const prefixes =
        typeof options.stripPrefix === 'string'
            ? [options.stripPrefix]
            : (options.stripPrefix ?? []);

    return async (url, init) => {
        const response = await instance.request({
            url: stripped(url, prefixes),
            method: (init?.method ?? 'GET').toUpperCase(),
            headers: init?.headers,
            data: init?.body,
            validateStatus: () => true,
        });

        const result: HttpResponse = {
            status: response.status,
            headers: { get: headerReader(response.headers) },
            json: async () =>
                typeof response.data === 'string' ? JSON.parse(response.data) : response.data,
            text: async () =>
                typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        };
        return result;
    };
}
