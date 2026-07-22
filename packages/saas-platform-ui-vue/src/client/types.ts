// Shared configuration types for all UI-Vue loaders/composables.

/**
 * Minimal abstraction over `fetch`. Consumers may pass their own
 * implementation (e.g. an axios wrapper that already injects auth headers
 * and tenant headers).
 */
export type HttpClient = (
    url: string,
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
    },
) => Promise<HttpResponse>;

export interface HttpResponse {
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
}

/** Simple persistence adapter; default is `localStorage`. */
export interface KvStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

/**
 * Returns a `KvStore` wrapper around `localStorage` (or `null` under SSR).
 * Tests may pass an in-memory stub.
 */
export function defaultKvStore(): KvStore {
    if (typeof globalThis.localStorage === 'undefined') {
        // SSR / non-browser → no-op stub.
        return {
            get: () => null,
            set: () => {},
            remove: () => {},
        };
    }
    const ls = globalThis.localStorage;
    return {
        get: (k) => ls.getItem(k),
        set: (k, v) => ls.setItem(k, v),
        remove: (k) => ls.removeItem(k),
    };
}

/**
 * Default `HttpClient` over `fetch`. Consumers pass their own variant
 * through when they need auth headers / tenant headers / retry logic.
 */
export function defaultHttpClient(): HttpClient {
    return (url, init) => fetch(url, init);
}
