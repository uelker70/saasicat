// Shared JSON helpers over the injectable `HttpClient`. A single
// request/error path for all pre-login calls (boot, setup status, setup),
// instead of raw `fetch` with divergent error handling per component. A
// consumer `HttpClient` (auth header, baseURL, retry) then applies everywhere.

import { AdminError, markTransportFailure, readErrorCode, readErrorDetail } from './admin-error.js';
import type { HttpClient } from './types.js';

/**
 * Whether a resolved `HttpResponse` describes an answer from the server.
 *
 * `HttpClient` is a bare function type, and an axios or XHR wrapper reports a
 * network error, a CORS rejection or an abort by RESOLVING with `status: 0`
 * rather than by rejecting — a shape the contract permits and its own
 * documentation invites. Every caller that reads a body afterwards is assuming
 * an answer arrived; this is the one place that decides what "arrived" means,
 * so the two sentences it separates ("check your connection" against "check
 * whether the change was applied") cannot drift apart per composable.
 *
 * `> 0` is the same boundary `AdminError` documents for its `status`.
 */
function serverAnswered(status: number): boolean {
    return status > 0;
}

/**
 * Fails, at the seam that can still tell, when the client resolved without an
 * HTTP status: the request never reached the server.
 *
 * Every caller below then knows that an absent body means the server answered
 * without one, which is the precondition the empty-response sentinel needs and
 * did not have — `if (!data)` was true for both facts, and the mutation
 * sentinel told the operator of a request that never left the machine to go
 * check whether their change had been applied.
 *
 * `raise` builds the error class of the calling seam from the diagnostic, so
 * the caught error keeps saying which API it came from.
 */
export function requireServerAnswer(
    status: number,
    method: string,
    url: string,
    raise: (diagnostic: string) => Error,
): void {
    if (serverAnswered(status)) return;
    throw markTransportFailure(
        raise(`${method} ${url} produced no HTTP status — the request did not reach the server`),
    );
}

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

async function failed(
    res: { status: number; json(): Promise<unknown> },
    method: string,
    url: string,
): Promise<AdminError> {
    const body = await readErrorBody(res);
    return new AdminError({
        status: res.status,
        // Read here rather than left to the status: `status: 0` reaches
        // `adminErrorMessage` as "nothing is known about this failure", and
        // this seam knows better — it held the response.
        transportFailure: !serverAnswered(res.status),
        code: readErrorCode(body),
        body,
        url,
        method,
        // Shared with `toAdminError` on purpose: a NestJS `ValidationPipe`
        // rejection carries `message` as an array, and reading it here in a
        // second, narrower way is how those constraints went missing.
        detail: readErrorDetail(body),
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
