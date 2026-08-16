// One error type for everything that fails on the way to or from the admin
// API, and one function that turns whatever was caught into it.
//
// The problem this solves: the package's HTTP contract (`HttpClient` in
// `types.ts`) is a bare function type, so an error can arrive in any shape the
// consumer's client produces — an axios rejection with `err.response.data`, a
// `fetch` TypeError, a platform `HttpJsonError`, or a plain string. Code that
// reads exactly one of those shapes works for exactly one kind of consumer and
// silently shows nothing to the others.
//
// Two ideas are deliberately kept apart:
//
//   - `message` is the diagnostic. It names the request and what came back,
//     and it belongs in logs and stack traces. It is never user-facing.
//   - `detail` is the text the failing side supplied — a response body's
//     `message`, or the message of a non-HTTP error we wrapped. It is the only
//     candidate for showing a user, and it is `undefined` when there is none.
//
// `adminErrorMessage()` is what turns an error into user-facing text; it is
// the only place that decides between `detail` and a translated fallback.

import { formatMessage } from './i18n/format.js';
import type { SaMessages } from './i18n/messages.js';

/**
 * Brand for cross-copy recognition.
 *
 * The package ships `dist/index.*` and `dist/client/index.*` as separate
 * rollups, so an app that reaches `@saasicat/ui-vue` through both entries can
 * hold two `AdminError` classes — `instanceof` is then false for an error the
 * other copy created, and re-wrapping it would drop `status`, `code` and
 * `body`. A `Symbol.for` key resolves through the process-wide registry, so
 * every copy agrees on it.
 */
const ADMIN_ERROR = Symbol.for('@saasicat/ui-vue/AdminError');

/**
 * Brand for the error classes this package throws itself.
 *
 * `toAdminError` has to answer one question about a caught error: is its
 * `message` something an operator should read? For a consumer's
 * `Error('Quota exhausted')` the answer is yes. For
 * `PlansApiError(403, {}, 'Plans API responded with HTTP 403')` it is no — that
 * is a diagnostic, and showing it instead of the translated wording is what
 * this whole separation exists to prevent.
 *
 * Shape cannot answer it. Both are `Error`s with a numeric `status`, and two
 * successive attempts to guess — first from `status === 0`, then from a class
 * name ending in `ApiError` — each turned out to catch consumer errors as well.
 * A name suffix is a convention anyone may share; identity is not. `Symbol.for`
 * because the package ships more than one bundle copy.
 */
const PLATFORM_ERROR = Symbol.for('@saasicat/ui-vue/PlatformError');

/**
 * Marks an error as one this package raised. Called by the package's own error
 * classes in their constructors; nothing else should call it.
 */
export function markPlatformError(error: Error): void {
    Object.defineProperty(error, PLATFORM_ERROR, { value: true });
}

/** Whether an error came from this package, across bundle copies. */
export function isPlatformError(value: unknown): boolean {
    return typeof value === 'object' && value !== null && PLATFORM_ERROR in value;
}

/**
 * Brand for the throw sites where the request completed and only the body was
 * missing.
 *
 * A second brand rather than an inference from the first, because the two
 * answer different questions about different things. `PLATFORM_ERROR` is a
 * fact about the *class* — is this `message` a diagnostic, or a consumer's
 * words? Whether the server answered with an empty body is a fact about the
 * *throw site*, and one class hosts both: `PlansApiError` is raised for
 * `Plans API responded with HTTP 403` and for `Create returned no body`.
 *
 * Deriving the second from the first (`status === 0 && isPlatformError(err)`)
 * looked equivalent and was not. `BootLoader.load`, `ManifestLoader` and
 * `useDiscovery` pass a client-supplied status straight into a branded error
 * behind a `status !== 200` guard, so an `HttpClient` that reports a transport
 * failure as `status: 0` instead of rejecting — which XHR and axios do, and
 * which `HttpClient` explicitly permits — produced a branded status-0 error
 * for a read-only GET. `adminErrorMessage` then answered "check whether the
 * change was applied" for a request that never left the machine and could not
 * have changed anything.
 *
 * `Symbol.for` for the same reason as above: the package ships more than one
 * bundle copy.
 */
const EMPTY_RESPONSE = Symbol.for('@saasicat/ui-vue/EmptyResponse');

/**
 * Marks an error as the empty-body sentinel: the call reached the server, the
 * server answered, and the body the caller needed was not in it. Returns the
 * error so a throw site stays one expression.
 *
 * Called at those throw sites only — never in a constructor, because the class
 * is also raised for calls that failed outright.
 */
export function markEmptyResponse<E extends Error>(error: E): E {
    Object.defineProperty(error, EMPTY_RESPONSE, { value: true });
    return error;
}

/** Whether an error is that sentinel, across bundle copies. */
export function isEmptyResponse(value: unknown): boolean {
    return typeof value === 'object' && value !== null && EMPTY_RESPONSE in value;
}

/**
 * Brand for the opposite fact: the request never reached the server.
 *
 * The third brand, and for the third time because the shape does not carry the
 * answer. `err instanceof TypeError` was the guess here, and `TypeError` is
 * also what a null dereference raises — `rows.map` on a `null` produced "check
 * your connection" for a bug in the page. A name, a status and a class are all
 * things two unrelated failures can share; only the seam that made the request
 * knows whether it left the machine.
 *
 * `defaultHttpClient` marks what `fetch` rejects with, which is the one client
 * this package ships. A consumer's `HttpClient` is welcome to mark its own
 * rejections — that is why this is exported — and an axios rejection is still
 * recognised by its `config`-without-`response` shape, because axios documents
 * that shape and cannot be asked to brand anything.
 *
 * `Symbol.for` for the same reason as above: the package ships more than one
 * bundle copy.
 */
const TRANSPORT_FAILURE = Symbol.for('@saasicat/ui-vue/TransportFailure');

/**
 * Marks an error as one the request did not survive: no connection, DNS
 * failure, CORS rejection, abort, or a client that reported the same by
 * resolving without an HTTP status. Returns the error so a throw site stays one
 * expression.
 */
export function markTransportFailure<E>(error: E): E {
    if (typeof error === 'object' && error !== null) {
        try {
            Object.defineProperty(error, TRANSPORT_FAILURE, { value: true });
        } catch {
            // A frozen or sealed error cannot take the brand. Losing it costs
            // the precise sentence; replacing the error would cost the
            // diagnostic altogether, so the original is what propagates.
        }
    }
    return error;
}

/** Whether an error is a declared transport failure, across bundle copies. */
export function isTransportFailure(value: unknown): boolean {
    return typeof value === 'object' && value !== null && TRANSPORT_FAILURE in value;
}

export interface AdminErrorInit {
    /** HTTP status. `0` means the request never produced one. */
    status?: number;
    /** Machine-readable code from the response body (`{ code }`). */
    code?: string;
    /** Parsed response body, when there was one. */
    body?: unknown;
    /** Requested URL, when known. */
    url?: string;
    /** Request method, when known. */
    method?: string;
    /**
     * Text the failing side supplied. Never invent one — its absence is the
     * signal that only a translated fallback can be shown.
     */
    detail?: string;
    /**
     * The request completed and the answer was unusable — a 2xx that carried
     * no body where one was required.
     *
     * Its own state because the model could not otherwise tell it from a
     * transport failure: both have no HTTP status to report, and both were
     * therefore `status: 0`. They need opposite words. A request that never
     * left says "check your connection"; one the server accepted and answered
     * with nothing says "check whether the change was applied", because it may
     * well have been.
     */
    emptyResponse?: boolean;
    /**
     * The request never reached the server.
     *
     * Its own state for the same reason as `emptyResponse`: neither has an HTTP
     * status to reason from, so a status of `0` cannot tell them apart — and
     * neither can it tell either of them from an error that simply carries no
     * status, such as a bug in page code. Only the seam that made the request
     * knows, and it says so with `markTransportFailure`.
     */
    transportFailure?: boolean;
    /** Diagnostic message. Derived from the fields above when omitted. */
    message?: string;
    /** The error this one was built from. */
    cause?: unknown;
}

/**
 * Builds the diagnostic message. Deliberately shaped like the one
 * `admin-resource-client.ts` already produces (`GET /url → HTTP 403`), so
 * logs read the same whichever layer threw.
 */
function describe(init: AdminErrorInit): string {
    const status = init.status ?? 0;
    const where = [init.method, init.url].filter(Boolean).join(' ');
    const what = status > 0 ? `HTTP ${status}` : 'request failed';
    const head = where ? `${where} → ${what}` : what;
    const code = init.code ? ` (${init.code})` : '';
    return init.detail ? `${head}${code}: ${init.detail}` : `${head}${code}`;
}

/** A failed admin API call, in the one shape the package works with. */
export class AdminError extends Error {
    /** HTTP status. `0` means the request never produced one. */
    readonly status: number;
    /** Machine-readable code from the response body, when it carried one. */
    readonly code?: string;
    /** Parsed response body, when there was one. */
    readonly body?: unknown;
    /** Requested URL, when known. */
    readonly url?: string;
    /** Request method, when known. */
    readonly method?: string;
    /**
     * Text the failing side supplied — the only candidate for user-facing
     * output. `undefined` when nothing was supplied.
     */
    readonly detail?: string;
    /** The request completed but the answer was unusable. See `AdminErrorInit`. */
    readonly emptyResponse: boolean;
    /** The request never reached the server. See `AdminErrorInit`. */
    readonly transportFailure: boolean;

    constructor(init: AdminErrorInit = {}) {
        super(init.message ?? describe(init), { cause: init.cause });
        this.name = 'AdminError';
        this.status = init.status ?? 0;
        this.code = init.code;
        this.body = init.body;
        this.url = init.url;
        this.method = init.method;
        this.detail = init.detail;
        this.emptyResponse = init.emptyResponse ?? false;
        this.transportFailure = init.transportFailure ?? false;
        Object.defineProperty(this, ADMIN_ERROR, { value: true });
        // `message` here is `describe()`'s diagnostic, or one a throw site
        // supplied — never text for a screen, which is exactly what the
        // platform brand states. `toAdminError` returns an `AdminError`
        // unchanged and so never reads it, but the promise holds for anyone
        // who does, and it keeps the guard's rule ("every error class this
        // package declares carries the brand") free of exceptions.
        markPlatformError(this);
    }
}

/** Whether `err` is an `AdminError`, including one from another bundle copy. */
export function isAdminError(err: unknown): err is AdminError {
    return typeof err === 'object' && err !== null && ADMIN_ERROR in err;
}

/** Narrows to an indexable object without asserting anything about its keys. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Reads the human-readable message out of a response body.
 *
 * Covers the two shapes the platform and its host produce: a coded platform
 * error (`{ code, message }`) carries a string, while a NestJS
 * `ValidationPipe` rejection carries `message: string[]` — one entry per
 * failed constraint. Joining them is what keeps a validation error readable
 * instead of rendering as `[object Object]`.
 *
 * Exported because every place that builds an `AdminError` from a response
 * needs the same answer. It had two implementations for one release and they
 * disagreed: the one in `http-json.ts` accepted only a string, so a validation
 * rejection arriving through `getJson`/`postJson` lost its constraints
 * entirely and the operator was shown the generic fallback.
 */
export function readErrorDetail(body: unknown): string | undefined {
    const record = asRecord(body);
    if (!record) return asString(body);
    const message = record.message;
    if (Array.isArray(message)) {
        const parts = message.filter((part): part is string => typeof part === 'string');
        return parts.length > 0 ? parts.join(', ') : undefined;
    }
    return asString(message) ?? asString(record.error) ?? asString(record.reason);
}

/** Reads the machine-readable code out of a response body, if it carries one. */
export function readErrorCode(body: unknown): string | undefined {
    return asString(asRecord(body)?.code);
}

/**
 * Turns anything that was caught into an `AdminError`.
 *
 * Recognises, in order: an `AdminError` (from any bundle copy), an axios-style
 * rejection, an error carrying a numeric `status` — which is every one of the
 * package's own `*ApiError` classes — and finally any `Error`, string or
 * unknown value.
 */
export function toAdminError(err: unknown): AdminError {
    if (isAdminError(err)) return err;

    const record = asRecord(err);
    const response = asRecord(record?.response);

    // Axios rejection: the body sits under `response.data`, the request under
    // `config`. Both are absent on a network failure, which axios reports as a
    // rejection with no `response` at all.
    if (response && typeof response.status === 'number') {
        const config = asRecord(record?.config);
        const body = response.data;
        return new AdminError({
            status: response.status,
            code: readErrorCode(body),
            body,
            url: asString(config?.url),
            method: asString(config?.method)?.toUpperCase(),
            // Only what the response actually said. `err.message` here is
            // axios's own generated line ("Request failed with status code
            // 401") — English, untranslated, and about the transport rather
            // than about what went wrong. Letting it through as `detail` would
            // make `adminErrorMessage` return it in preference to the
            // localized wording, which is the whole point of that wording.
            detail: readErrorDetail(body),
            cause: err,
        });
    }

    // The package's own API errors (`BundlesApiError`, `PlansApiError`, …) all
    // carry `status` and most carry the parsed `body`.
    if (record && typeof record.status === 'number') {
        // Only this package's own classes carry diagnostics in `message`. A
        // consumer's status-bearing error — `Object.assign(new Error('Quota
        // exhausted'), { status: 429 })` — says something an operator needs,
        // and the page-level helper this replaces showed it.
        const ours = isPlatformError(err);
        return new AdminError({
            status: record.status,
            code: readErrorCode(record.body) ?? asString(record.code),
            body: record.body,
            // Same reasoning as above: `BundlesApiError`'s message is
            // "Bundles API responded with HTTP 403", a diagnostic. It stays on
            // `message`, where logs read it.
            detail: readErrorDetail(record.body) ?? (ours ? undefined : asString(record.message)),
            // Asked of the throw site, not of the class: only the site that
            // read the response knows whether one arrived. `status === 0 &&
            // ours` was the same question put to the wrong witness — the
            // loaders raise branded errors from a status the client chose, so
            // a client that resolves a transport failure as `0` turned a
            // failed GET into "the change may have been applied".
            emptyResponse: isEmptyResponse(err),
            transportFailure: isTransportFailure(err),
            message: asString(record.message),
            cause: err,
        });
    }

    if (err instanceof Error) {
        // A transport failure carries no message from a failing side — only
        // the client's own diagnostic, generated in English by whichever client
        // is installed. Leaving `detail` unset is what lets
        // `adminErrorMessage` reach `msgs.network`, the one sentence that
        // actually tells the operator what to do.
        //
        // Which errors those are is declared, not inferred. `defaultHttpClient`
        // brands what `fetch` rejects with; a consumer's client may brand its
        // own. `err instanceof TypeError` used to stand in for it and was
        // wrong in both directions: it caught every null dereference in page
        // code ("Cannot read properties of null") and told the operator to
        // check their connection, and it missed any client that fails with
        // something else. Axios is the one shape still read rather than
        // branded — a rejection with a `config` and no `response` is its
        // documented network-failure form, and the package cannot ask a
        // library to mark itself.
        //
        // Anything else keeps its message: an `Error('Plan is locked')` from
        // app code IS what the failing side said, and it is what the page-level
        // copies this replaces showed.
        const transport = isTransportFailure(err) || (record?.config !== undefined && !response);
        // A `TypeError` nobody declared a transport failure is a JavaScript
        // fault — `rows.map` on a `null`, or a client that failed in a way it
        // did not mark. Either way its text is the engine's ("Cannot read
        // properties of null (reading 'map')"), which belongs in a stack trace
        // and not on an admin screen, so it stays on `message` and the fallback
        // in `adminErrorMessage` answers instead.
        const saidSomethingReadable = !transport && !(err instanceof TypeError);
        return new AdminError({
            detail: saidSomethingReadable ? asString(err.message) : undefined,
            transportFailure: transport,
            message: err.message,
            cause: err,
        });
    }

    const text = asString(err);
    return new AdminError({ detail: text, message: text, cause: err });
}

/**
 * Maps `status` to the key that describes what happened. `undefined` means the
 * status has no dedicated wording and falls through to the generic template.
 */
function statusKey(status: number): keyof SaMessages['errors'] | undefined {
    if (status === 400 || status === 422) return 'validation';
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'notFound';
    if (status === 409) return 'conflict';
    if (status === 429) return 'rateLimited';
    if (status >= 500) return 'server';
    return undefined;
}

/**
 * Turns anything that was caught into text for a user.
 *
 * What the failing side said outranks anything this package could guess, so a
 * `detail` wins whenever there is one. After that come the two facts a seam
 * declared about a request with no HTTP status — they need opposite sentences
 * and no number can tell them apart — and only then the status.
 *
 * The last line is the honest one. An error with no status, no text and no
 * declaration is an error nothing knows anything about; "check your connection"
 * used to be the answer, and it sent an operator after their router for a null
 * dereference in a page. Whoever knows better says so with
 * `markTransportFailure` or `markEmptyResponse`.
 *
 * Pages do not call this — `useAsyncAction` and the error banner do.
 */
export function adminErrorMessage(err: unknown, msgs: SaMessages['errors']): string {
    const error = toAdminError(err);
    if (error.detail) return error.detail;
    if (error.emptyResponse) return msgs.emptyResponse;
    if (error.transportFailure) return msgs.network;
    if (error.status > 0) {
        const key = statusKey(error.status);
        return key ? msgs[key] : formatMessage(msgs.httpStatus, { status: error.status });
    }
    return msgs.unexpected;
}
