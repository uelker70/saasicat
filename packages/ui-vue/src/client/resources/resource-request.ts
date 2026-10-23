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
import { requireServerAnswer } from '../http-json.js';
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
 *
 * A client that resolved without an HTTP status throws before any of that: no
 * status means the request never reached the server, which is a transport
 * failure and not an answer this function may read.
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

    // Before anything is read off the response: a client that reports a
    // network, CORS or abort failure by RESOLVING with `status: 0` — the shape
    // `HttpClient` permits and `requireServerAnswer` exists for — otherwise
    // arrives here as a successful answer with no body. A list would then be
    // empty with nothing wrong on screen, and a mutation would tell the
    // operator their change may have been applied when the request never left
    // the machine.
    requireServerAnswer(
        response.status,
        method,
        url,
        (diagnostic) =>
            new AdminError({ status: response.status, url, method, message: diagnostic }),
    );

    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (response.status >= 400) throw refusalOf(response.status, body, url, method);
    // SAFETY: the caller names the shape its route answers with; this reads the
    // body as JSON and no further, and the 2xx above is the server's word for it.
    return body as T | null;
}

/** The `AdminError` a status of 400 or above is thrown as, carrying the parsed body. */
function refusalOf(status: number, body: unknown, url: string, method: string): AdminError {
    return new AdminError({
        status,
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

/** A file a download answered: its bytes, its media type and the name it is offered under. */
export interface DownloadedFile {
    content: Uint8Array;
    mediaType: string;
    fileName: string;
}

/**
 * Downloads the file `url` answers, such as an invoice's archived document. A
 * refusal is thrown as `requestJson` throws it, from the JSON body the server
 * answers a refusal with. The name is the one `Content-Disposition` offers, or
 * `fallbackName` where it offers none.
 *
 * Needs a client whose responses have `bytes()`: both clients the package
 * ships do. One of the application's own that has none is said, rather than
 * read through `text()`, which would hand a PDF over decoded as UTF-8.
 */
export async function requestFile(
    http: HttpClient,
    url: string,
    fallbackName: string,
): Promise<DownloadedFile> {
    const method = 'GET';
    const response = await http(url, { method, binary: true });
    requireServerAnswer(
        response.status,
        method,
        url,
        (diagnostic) =>
            new AdminError({ status: response.status, url, method, message: diagnostic }),
    );
    if (response.status >= 400) {
        throw refusalOf(response.status, await response.json().catch(() => null), url, method);
    }
    if (!response.bytes) {
        throw new AdminError({
            status: 0,
            url,
            method,
            message:
                'The HttpClient cannot hand over a file: its responses have no bytes(). ' +
                'createFetchHttpClient and createAxiosHttpClient have it.',
        });
    }
    return {
        content: await response.bytes(),
        mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
        fileName: offeredName(response.headers.get('content-disposition')) ?? fallbackName,
    };
}

/**
 * The name `attachment; filename="…"` offers, or `null` where the header names
 * none. Read by position rather than by pattern: the platform keeps the name to
 * letters, digits, `.`, `_` and `-`, so the first quote after it ends it.
 */
function offeredName(disposition: string | null): string | null {
    if (!disposition) return null;
    const marker = 'filename="';
    const start = disposition.indexOf(marker);
    if (start < 0) return null;
    const from = start + marker.length;
    const end = disposition.indexOf('"', from);
    const name = end < 0 ? '' : disposition.slice(from, end);
    return name === '' ? null : name;
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
        throw new AdminError({
            status: 0,
            url,
            method: init.method ?? 'GET',
            // `what` is a diagnostic — "Create returned no body" — so it goes
            // on `message`, not `detail`. As `detail` it out-ranked the
            // localized wording and the operator read an English internal
            // string instead of being told the change may already have landed.
            message: what,
            emptyResponse: true,
        });
    }
    return body;
}
