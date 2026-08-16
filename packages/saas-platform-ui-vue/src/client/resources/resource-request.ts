// The JSON request/response policy the admin catalogue endpoints share.
//
// This exact function is written out three times in the package today —
// `use-plans.ts` contains two byte-identical copies of it in one file, and
// `use-bundles.ts` and `use-catalog-entries.ts` a third and fourth — differing
// only in the message they put on the error. The policy itself is one
// decision, so it is written once here.
//
// It is NOT the policy the tenant-side billing composables use: those check
// `>= 400` before the 204 branch, read the error body with `text()` as a
// fallback, and let an unparsable 2xx reject with the raw parse error. Those
// three are mutually incompatible and belong to a different audience — see the
// tenant package split. Nothing here should be pointed at them.

import { AdminError, readErrorCode, readErrorDetail } from '../admin-error.js';
import type { HttpClient } from '../types.js';

export interface ResourceRequestInit {
    /** Default `GET`. */
    method?: string;
    /** Serialised here — the `HttpClient` contract only carries strings. */
    body?: unknown;
    /** Merged over the defaults, so a caller's header wins. */
    headers?: Record<string, string>;
}

/**
 * Sends a request and returns the parsed body, or `null` when there was none.
 *
 * `null` covers both a `204` and a 2xx whose body would not parse. The two are
 * deliberately not distinguished: every caller treats them the same way — a
 * list turns `null` into `[]`, a mutation turns it into a failure — and no
 * endpoint in this family answers a mutation with an empty 200 on purpose.
 *
 * A non-2xx throws an `AdminError` carrying the parsed body, so a caller can
 * still branch on `status` and `body.code` the way the pages do today.
 */
export async function requestJson<T>(
    http: HttpClient,
    url: string,
    init: ResourceRequestInit = {},
): Promise<T | null> {
    const method = init.method ?? 'GET';
    const response = await http(url, {
        method,
        headers: { 'content-type': 'application/json', ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (response.status >= 400) {
        throw new AdminError({
            status: response.status,
            code: readErrorCode(body),
            body,
            // The third place this had to be read, and the second time it was
            // read a narrower way: without `detail` a page migrating onto these
            // resources loses "Plan already exists" and shows the generic
            // status sentence instead. One decision, one function.
            detail: readErrorDetail(body),
            url,
            method,
        });
    }
    return body as T | null;
}

/**
 * Reads the body of a request that must answer with one.
 *
 * The empty case is a failure rather than a `null` the caller has to re-check:
 * a create that returns nothing has not told us what it created. Raised with
 * `status: 0`, because no HTTP status went wrong — the response was a 2xx.
 */
export async function requestJsonBody<T>(
    http: HttpClient,
    url: string,
    what: string,
    init: ResourceRequestInit = {},
): Promise<T> {
    const body = await requestJson<T>(http, url, init);
    if (body === null || body === undefined) {
        throw new AdminError({ status: 0, url, method: init.method ?? 'GET', detail: what });
    }
    return body;
}
