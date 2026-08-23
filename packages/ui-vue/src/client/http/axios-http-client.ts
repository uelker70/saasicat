// The axios implementation of `HttpClient` — without depending on axios.
//
// Six near-identical copies of this function existed across the apps and
// documents that needed one: the notesapp admin and web apps, the scaffolder
// template, the admin-frontend guide and two production consumers. They
// differed in the
// prefix they strip and in nothing else that matters.
//
// `AxiosLike` is structural on purpose. A `dependencies` entry would make every
// consumer install axios to use a package that speaks `fetch` by default, and a
// `peerDependencies` entry would do the same with a warning instead of an
// install. The one method this needs is `request`, and any axios instance has
// it.
//
// The tests do install axios, as a devDependency, because the one thing a
// stand-in cannot reproduce is the transform axios applies to a body — and that
// transform is what `bodyIsRaw` below has to read correctly.

import { isAxiosNoResponseError, markTransportFailure } from '../admin-error.js';
import { trimTrailingSlashes } from '../http-json.js';
import type { HttpClient, HttpResponse } from '../types.js';

/**
 * The part of the merged request config axios echoes back on every response —
 * on the one it resolves with and on the one it attaches to a rejection. These
 * three fields say whether `data` is a decoded value or the body as it arrived,
 * for as long as axios's own response transform is the one that produced it;
 * see `bodyIsRaw`.
 *
 * They are `unknown` rather than their axios types so that a real
 * `AxiosResponse` stays structurally assignable without this package taking a
 * dependency on axios to name them.
 */
export interface AxiosLikeResponseConfig {
    transformResponse?: unknown;
    responseType?: unknown;
    transitional?: unknown;
}

export interface AxiosLikeResponse {
    status: number;
    data: unknown;
    headers: unknown;
    config?: AxiosLikeResponseConfig;
}

export interface AxiosLikeConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
}

/** The part of an axios instance this adapter uses. */
export interface AxiosLike {
    request(config: AxiosLikeConfig): Promise<AxiosLikeResponse>;
}

/**
 * What an instance leaves in `response.data`, for the one case the response
 * cannot describe: an instance that replaced `transformResponse` with a
 * non-empty pipeline of its own.
 *
 * - `'auto'` — read it off the config axios echoes on the response. Correct for
 *   an instance that still runs axios's own transform, and for every way of
 *   switching that transform's parsing off: `responseType: 'text'`,
 *   `transitional: { forcedJSONParsing: false }`, and a `transformResponse`
 *   that runs nothing (`[]` or `null`).
 * - `'raw'` — `data` is the body as it arrived, and `json()` parses it.
 * - `'decoded'` — `data` is a value the pipeline already produced, and `json()`
 *   hands it over untouched.
 */
export type AxiosResponseBody = 'auto' | 'raw' | 'decoded';

export interface AxiosHttpClientOptions {
    /**
     * Prefix(es) to remove from the start of a URL before handing it to the
     * instance, for the usual case where the instance already carries them as
     * its `baseURL`. Tried in order, first match wins — so list the longest
     * first (`['/api/v1', '/api']`), or `/api/v1/admin/x` loses only `/api`.
     */
    stripPrefix?: string | readonly string[];

    /**
     * How this instance hands the body over. Defaults to `'auto'`, which needs
     * no configuration and is right for every instance that leaves axios's own
     * `transformResponse` in place.
     *
     * Set it only if you replaced `transformResponse` with a non-empty pipeline
     * of your own: `'raw'` if that pipeline hands the body over as it arrived
     * (`[(data) => data]`), `'decoded'` if it parses. The response cannot be
     * read for the answer — both echo one opaque function — so `'auto'` would
     * take your pipeline for axios's; see `bodyIsRaw`.
     *
     * The declaration is read before anything else, an empty `data` included:
     * under `'decoded'` an empty `data` is the empty string the pipeline
     * produced, and `json()` hands it over; under `'raw'` it is an empty body,
     * and `json()` throws the way `Response.json()` does.
     */
    responseBody?: AxiosResponseBody;
}

/**
 * Removes a prefix only at a path boundary. `startsWith` alone is not enough:
 * `/api/v10/x` starts with `/api/v1` and would be cut to `0/x`, which is the
 * shape of the `url.slice(7)` the copies of this function all used.
 *
 * The prefix is trimmed of trailing slashes first. Writing the option the way
 * an axios `baseURL` is usually written — `'/api/v1/'` — otherwise left the
 * remainder as `admin/boot`, which does not start with `/`, so the boundary
 * check rejected it and the URL passed through unstripped. axios then prepended
 * its base and sent `/api/v1/api/v1/admin/boot`: every request broken, for a
 * configuration that looks correct.
 */
function stripped(url: string, prefixes: readonly string[]): string {
    for (const prefix of prefixes) {
        const trimmed = trimTrailingSlashes(prefix);
        if (!trimmed || !url.startsWith(trimmed)) continue;
        const rest = url.slice(trimmed.length);
        if (rest === '') return '/';
        if (rest.startsWith('/')) return rest;
        // A query or a fragment ends the path just as a slash does, so
        // `/api/v1?tenant=acme` is the prefix too — without this it fell
        // through unstripped and was sent doubled.
        if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`;
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
 * Whether `response.data` is the body as it arrived, rather than a value axios
 * already decoded out of it.
 *
 * The type of `data` cannot answer that. Under axios's default transform a
 * body of `"ready"` decodes to the string `ready`, and a body that failed to
 * parse is handed back as the string it was — both arrive as strings, both
 * under an `application/json` content type, so neither the value nor the media
 * type separates them. Decoding a second time then throws on `"ready"` and,
 * worse, silently turns the string `"null"` into `null`.
 *
 * `'auto'` reads the answer off the merged config axios echoes on every
 * response, including the one carried by a rejection. Two readings, in order: a
 * `transformResponse` axios's own iteration would run nothing for is proof that
 * nothing touched the body; otherwise the condition axios's own default
 * transform parses under, negated, off `responseType` and `transitional`. An
 * empty `data` is answered before either of them, and the comment on that line
 * says what it costs.
 *
 * **The second reading is an assumption, not a measurement**: it holds while
 * axios's default transform is the one that ran. `config.transformResponse` is
 * not a description of the decoding — it is the function array axios applied,
 * and functions are opaque. An instance built with `[(data) => data]` and one
 * built with `[(data) => JSON.parse(data)]` echo the same config as a stock
 * instance does, down to the array length and the arity of its one element, and
 * each can be handed a body that makes it produce the very same `data` as the
 * others — `"ready"` through the first, `"\"ready\""` through the other two,
 * all three arriving as `"ready"` — while needing the opposite answer.
 * Nothing else on the response separates them either: the
 * only field that differs is `content-length`, which gzip or a chunked reply
 * makes meaningless. Guessing "non-empty means decoded" is silently wrong for
 * the first, guessing "non-empty means raw" for the second.
 *
 * So an instance that replaced `transformResponse` says which it is, through
 * the `responseBody` option, and `'auto'` covers everyone who did not. The
 * declaration is read first, because a reading that overrode it would leave the
 * tie it exists to break unbroken.
 *
 * A response carrying no config at all is read as decoded: real axios always
 * attaches one, so only a stand-in can omit it, and reading a stand-in as
 * already-decoded fails loudly — objects arriving as strings — instead of
 * silently changing what a scalar means.
 */
function bodyIsRaw(response: AxiosLikeResponse, declared: AxiosResponseBody): boolean {
    // The declaration answers for every body, the empty one included. Under
    // `'decoded'` `data` is the value the pipeline produced and `''` is the
    // empty string; under `'raw'` `data` is the body and an empty one is what
    // `Response.json()` throws on.
    if (declared !== 'auto') return declared === 'raw';

    // Under `'auto'` an empty `data` is read as no body, and `json()` therefore
    // throws as `Response.json()` does. For an instance that hands the body
    // over that reading is exact — nothing shortens a body to nothing. For one
    // that decodes it is a collision the response cannot resolve: axios's
    // transform turns a zero-byte body and the two bytes `""` into the same
    // `''`, and `""` is valid JSON meaning the empty string. That is the same
    // undecidability the docstring above owns, so it has the same way out —
    // `responseBody: 'decoded'`, which is why it is read one line further up.
    if (response.data === '') return true;

    // `config.transformResponse` is not a description of the decoding, but it
    // is the collection axios handed to its own `forEach`, and two of the
    // shapes that accepts run nothing at all: the empty array, and `null`
    // (`forEach` returns immediately for a nullish collection). Either is
    // therefore proof that the body was not touched.
    //
    // `=== null` and not `== null`: an *absent* `transformResponse` reads as
    // `undefined` too, and absence is not a statement about decoding — it is
    // what a structural stand-in produces, which the readings below already
    // answer for. Only a config that spells the property out has said anything.
    const config = response.config;
    if (config?.transformResponse === null) return true;
    if (Array.isArray(config?.transformResponse) && config.transformResponse.length === 0) {
        return true;
    }

    // What follows is the negation of the one condition axios's default
    // transform parses under (`lib/defaults/index.js`):
    //
    //     (forcedJSONParsing && !responseType) || responseType === 'json'
    //
    // Written from that condition rather than from the cases it produces:
    // several settings turn the parsing off, and keeping a list of them is how
    // one of them gets forgotten.
    const responseType = config?.responseType;
    if (responseType === 'json') return false;
    if (typeof responseType === 'string' && responseType !== '') return true;
    const transitional = config?.transitional;
    return (
        typeof transitional === 'object' &&
        transitional !== null &&
        (transitional as { forcedJSONParsing?: unknown }).forcedJSONParsing === false
    );
}

/**
 * Reads a body axios was told not to turn into text.
 *
 * `responseType: 'arraybuffer'` and `'blob'` switch the decoding off the way
 * `'text'` does, so the body arrives exactly as it was sent — only as bytes
 * rather than as a string. Turning them back into text is a measurement, not a
 * guess: JSON is defined in UTF-8, and `bodyIsRaw` already answers `true` for
 * both, so the readings below stay the ones the rest of this file reasons about.
 *
 * A stream is refused. It can be consumed once, not synchronously, and not
 * twice by `json()` and `text()` in turn; handing it back would satisfy the
 * return type while breaking what the type promises, which is the failure mode
 * this file spent three rounds removing. The message names the option that
 * makes the request work.
 *
 * Anything else is passed through: a consumer's own transform may return an
 * object, and that object is the body.
 */
async function readBody(data: unknown): Promise<unknown> {
    if (typeof data === 'string' || data === null || data === undefined) return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
    const maybe = data as { text?: unknown; pipe?: unknown; getReader?: unknown };
    if (typeof maybe.pipe === 'function' || typeof maybe.getReader === 'function') {
        throw new TypeError(
            "createAxiosHttpClient cannot read a streamed body: responseType 'stream' can be " +
                "consumed only once, and never synchronously. Use 'arraybuffer' or the default " +
                'for the instance the platform receives.',
        );
    }
    if (typeof maybe.text === 'function') return (maybe.text as () => Promise<string>).call(data);
    return data;
}

/** Presents an axios response as the `HttpResponse` the contract declares. */
function adapt(response: AxiosLikeResponse, declared: AxiosResponseBody): HttpResponse {
    return {
        status: response.status,
        headers: { get: headerReader(response.headers) },
        json: async () => {
            const data = await readBody(response.data);
            if (typeof data !== 'string') return data;
            return bodyIsRaw({ ...response, data }, declared) ? JSON.parse(data) : data;
        },
        text: async () => {
            const data = await readBody(response.data);
            return typeof data === 'string' ? data : JSON.stringify(data);
        },
    };
}

/**
 * Adapts an axios instance to `HttpClient`.
 *
 * Two decisions are worth knowing about, because five of the six shims this
 * replaces made them differently:
 *
 * **No status throws — but the instance still decides.** A 402, a 404 and a
 * 500 all arrive as responses, because the platform reads statuses itself (a
 * 304 is a cache hit, a 402 carries a limit payload) and can only do that for
 * statuses it is handed. That is achieved by adapting the rejection rather
 * than by overriding `validateStatus`: an override would make axios resolve
 * everything, and a config that never rejects makes the **rejection half of
 * the instance's own response interceptors unreachable** — the conventional
 * place a consumer puts token refresh and retry. Their session would expire
 * silently instead of refreshing.
 *
 * **`json()` decodes only what axios left undecoded.** Which of the two it is
 * cannot be guessed from the value. The response says it for every instance
 * that still runs axios's own `transformResponse`; an instance that replaced it
 * says it with the `responseBody` option, because at that point the response no
 * longer can. See `bodyIsRaw`.
 *
 * Nothing here overrides the instance's own configuration — not
 * `validateStatus`, and not `transformResponse` either. Forcing the transform
 * off would make the answer knowable, at the price of handing the consumer's
 * own response interceptors a string where they had an object.
 */
export function createAxiosHttpClient(
    instance: AxiosLike,
    options: AxiosHttpClientOptions = {},
): HttpClient {
    const prefixes =
        typeof options.stripPrefix === 'string'
            ? [options.stripPrefix]
            : (options.stripPrefix ?? []);
    const responseBody = options.responseBody ?? 'auto';

    return async (url, init) => {
        try {
            return adapt(
                await instance.request({
                    url: stripped(url, prefixes),
                    method: (init?.method ?? 'GET').toUpperCase(),
                    headers: init?.headers,
                    data: init?.body,
                }),
                responseBody,
            );
        } catch (err: unknown) {
            // A status the instance rejected still carries its response, and
            // by then every interceptor has had its turn — including a refresh
            // that may have retried and succeeded. Adapt what came back
            // instead of rethrowing, so the seam keeps its one error shape.
            const response = (err as { response?: AxiosLikeResponse })?.response;
            if (response && typeof response.status === 'number') {
                return adapt(response, responseBody);
            }
            // No response came back through this seam — and that is the whole
            // of what this seam knows. It knows a request was attempted; it
            // does not know whether one arrived, because an interceptor that
            // answered a status with an error of its own has already replaced
            // everything the rejection would have said. So the brand goes on
            // exactly what axios itself reports as "made, nothing came back",
            // which `isAxiosNoResponseError` reads off axios's documented
            // `request`-without-`response` form.
            //
            // Measured with axios 1.18.1 against a real `node:http` server.
            // Marked: connection refused and reset, DNS failure, timeout,
            // abort — each of them also when a rejection interceptor rethrows
            // it. Not marked: an interceptor answering a 401 with
            // `new Error('session expired')`, whether or not it copies
            // `error.config` or `error.request` across; the setup failures
            // axios files under neither half (unsupported protocol, a signal
            // aborted before the call, a throwing `paramsSerializer`); and any
            // structural `AxiosLike` that is not axios at all.
            //
            // That last group is the decision rather than the measurement, and
            // it is the case an earlier round asked to mark: an offline request
            // through a client that says nothing about itself. It stays
            // unmarked because nothing in it can be told from an interceptor's
            // replacement error — `new Error('cannot reach api')` after a dead
            // socket and `new Error('session expired')` after a 401 are the
            // same object down to the last own property, so marking the first
            // costs the second its message, which is the only explanation the
            // operator would have had. A client that knows it could not send
            // says so itself: `markTransportFailure` is exported for that, and
            // `createFetchHttpClient` is the reference use.
            throw isAxiosNoResponseError(err) ? markTransportFailure(err) : err;
        }
    };
}
