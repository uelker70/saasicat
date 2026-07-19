// Gemeinsame Konfigurations-Typen für alle UI-Vue-Loader/-Composables.

/**
 * Minimale Abstraktion über `fetch`. Konsumenten dürfen eine eigene
 * Implementation übergeben (z. B. axios-Wrapper, der Auth-Header und
 * Tenant-Header bereits einhängt).
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

/** Einfacher Persistenz-Adapter; Default ist `localStorage`. */
export interface KvStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

/**
 * Liefert einen `KvStore`-Wrapper um `localStorage` (oder `null` bei SSR).
 * Tests dürfen einen In-Memory-Stub übergeben.
 */
export function defaultKvStore(): KvStore {
    if (typeof globalThis.localStorage === 'undefined') {
        // SSR / non-browser → No-op-Stub.
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
 * Default-`HttpClient` über `fetch`. Konsumenten reichen eine eigene
 * Variante durch, wenn sie Auth-Header / Tenant-Header / Retry-Logik
 * brauchen.
 */
export function defaultHttpClient(): HttpClient {
    return (url, init) => fetch(url, init);
}
