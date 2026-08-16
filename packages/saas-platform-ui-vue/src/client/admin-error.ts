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

    constructor(init: AdminErrorInit = {}) {
        super(init.message ?? describe(init), { cause: init.cause });
        this.name = 'AdminError';
        this.status = init.status ?? 0;
        this.code = init.code;
        this.body = init.body;
        this.url = init.url;
        this.method = init.method;
        this.detail = init.detail;
        Object.defineProperty(this, ADMIN_ERROR, { value: true });
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
        return new AdminError({
            status: record.status,
            code: readErrorCode(record.body) ?? asString(record.code),
            body: record.body,
            // Same reasoning as above: `BundlesApiError`'s message is
            // "Bundles API responded with HTTP 403", a diagnostic. It stays on
            // `message`, where logs read it.
            detail: readErrorDetail(record.body),
            message: asString(record.message),
            cause: err,
        });
    }

    if (err instanceof Error) {
        return new AdminError({ detail: asString(err.message), message: err.message, cause: err });
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
 * `detail` wins whenever there is one. Only when there is none does the status
 * decide, and a request that never produced a status cannot be described more
 * precisely than as one that did not complete.
 *
 * Pages do not call this — `useAsyncAction` and the error banner do.
 */
export function adminErrorMessage(err: unknown, msgs: SaMessages['errors']): string {
    const error = toAdminError(err);
    if (error.detail) return error.detail;
    if (error.status <= 0) return msgs.network;
    const key = statusKey(error.status);
    if (key) return msgs[key];
    return formatMessage(msgs.httpStatus, { status: error.status });
}
