// Shared configuration types for all UI-Vue loaders/composables.

import { createFetchHttpClient } from './http/fetch-http-client.js';

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

/** Stand-in for when there is no usable `localStorage`. */
const NOOP_KV_STORE: KvStore = {
    get: () => null,
    set: () => {},
    remove: () => {},
};

/**
 * Returns a `KvStore` wrapper around `localStorage`, or a no-op store when the
 * environment has none or refuses access. Tests may pass an in-memory stub.
 *
 * Every persistence built on this is a convenience — losing it must never take
 * the app down, so no failure mode is allowed to escape.
 */
export function defaultKvStore(): KvStore {
    const ls = resolveLocalStorage();
    if (!ls) return NOOP_KV_STORE;
    return {
        get: (k) => {
            try {
                return ls.getItem(k);
            } catch {
                // See resolveLocalStorage: access can be revoked per call too.
                return null;
            }
        },
        set: (k, v) => {
            try {
                ls.setItem(k, v);
            } catch {
                // Full quota or Safari's private mode — the value is simply
                // not remembered.
            }
        },
        remove: (k) => {
            try {
                ls.removeItem(k);
            } catch {
                // Nothing to clean up if the store is unreachable.
            }
        },
    };
}

/**
 * `localStorage` is a throwing getter, not a plain property: a browser that
 * blocks site data (cookie blocking, a sandboxed iframe) raises `SecurityError`
 * on read, and `typeof` evaluates the getter rather than guarding it. The
 * access therefore has to happen inside `try`.
 */
function resolveLocalStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * Default `HttpClient` over `fetch`, with no base URL and no headers of its
 * own. Consumers pass their own variant when they need auth headers, tenant
 * headers or retry logic — `createFetchHttpClient({ headers })` and
 * `createAxiosHttpClient(instance)` are the two the package ships.
 *
 * It delegates rather than calling `fetch` itself so that there is one
 * implementation to reason about instead of two that drift.
 */
export function defaultHttpClient(): HttpClient {
    return createFetchHttpClient();
}
