// The `fetch` implementation of `HttpClient`, and the only place in the
// package that is allowed to call `fetch` (ESLint enforces that; see the
// `no-restricted-globals` block in the root config).
//
// It exists because every app was writing it. Two of the shims in the known
// consumer apps are this file with different constants in it: prepend a base
// URL, merge in the auth header, ask for JSON, hand back the response in the
// four fields `HttpResponse` declares.

import type { HttpClient, HttpResponse } from '../types.js';

export interface FetchHttpClientOptions {
    /**
     * Prefix for relative URLs, e.g. `'https://api.example.com'`. Absolute
     * URLs are passed through untouched.
     *
     * Note that an app configures its API prefix twice if it also passes a
     * fully-qualified `apiBase` to the shell — the two would concatenate. Pick
     * one; a doubled prefix 404s on the first request rather than degrading
     * quietly, which is the reason this does not try to detect it.
     */
    baseUrl?: string;
    /**
     * Headers to add to every request, read per request so a token that
     * changes between calls is picked up without rebuilding the client. May
     * return a promise for a token that has to be refreshed first.
     *
     * Headers passed by the caller win, so a request that sets its own
     * `Content-Type` keeps it.
     */
    headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:|^\/\//i;

function resolveUrl(url: string, baseUrl: string | undefined): string {
    if (!baseUrl || ABSOLUTE_URL.test(url)) return url;
    return `${baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Builds an `HttpClient` over `fetch`.
 *
 * With no options it is a bare passthrough plus an `Accept: application/json`
 * header — the platform speaks JSON everywhere, and saying so is what stops a
 * content-negotiating gateway from answering with HTML.
 */
export function createFetchHttpClient(options: FetchHttpClientOptions = {}): HttpClient {
    return async (url, init) => {
        const headers = new Headers(await options.headers?.());
        headers.set('Accept', 'application/json');
        for (const [name, value] of Object.entries(init?.headers ?? {})) {
            headers.set(name, value);
        }
        // Only when the caller did not say — a `Content-Type` it chose itself
        // was set above and is left alone.
        if (init?.body !== undefined && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(resolveUrl(url, options.baseUrl), {
            method: init?.method ?? 'GET',
            headers,
            body: init?.body,
        });

        // `Response` already satisfies `HttpResponse` structurally. Naming the
        // type here is what keeps that true if either side changes.
        return response satisfies HttpResponse;
    };
}
