// The axios implementation of `HttpClient` — without depending on axios.
//
// Six near-identical copies of this function exist across the known consumer
// apps and the documentation: the notesapp admin and web apps, the scaffolder
// template, the handbook, vereinsfux and autohauspro. They differ in the
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

import type { HttpClient, HttpResponse } from '../types.js';

/**
 * The part of the merged request config axios echoes back on every response —
 * on the one it resolves with and on the one it attaches to a rejection. These
 * three fields are the ones that say whether `data` is a decoded value or the
 * body as it arrived; see `bodyIsRaw`.
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

export interface AxiosHttpClientOptions {
    /**
     * Prefix(es) to remove from the start of a URL before handing it to the
     * instance, for the usual case where the instance already carries them as
     * its `baseURL`. Tried in order, first match wins — so list the longest
     * first (`['/api/v1', '/api']`), or `/api/v1/admin/x` loses only `/api`.
     */
    stripPrefix?: string | readonly string[];
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
        const trimmed = prefix.replace(/\/+$/, '');
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
 * The response answers it itself. axios echoes the merged config on every
 * response, including the one carried by a rejection, and
 * `config.transformResponse` is not a description of the decoding: it is the
 * function array axios applied to produce `data`. An empty array is therefore
 * proof that nothing touched the body, and the rest of the answer is the
 * condition axios's own default transform decides by, read off the same object.
 *
 * A config that proves neither means something decoded the body, and that
 * something's output *is* the body; decoding it again would be decoding it
 * twice. A response carrying no config at all is read the same way: real axios
 * always attaches one, so only a stand-in can omit it, and reading a stand-in
 * as already-decoded fails loudly — objects arriving as strings — instead of
 * silently changing what a scalar means.
 */
function bodyIsRaw(response: AxiosLikeResponse): boolean {
    // No body is raw under either reading: axios's transform skips a falsy
    // body, so `''` is never something it decoded. Parsing it throws, which is
    // what `Response.json()` does with an empty body.
    if (response.data === '') return true;

    const config = response.config;
    if (Array.isArray(config?.transformResponse) && config.transformResponse.length === 0) {
        return true;
    }

    // What follows is the negation of the one condition axios's default
    // transform parses under (`lib/defaults/index.js`):
    //
    //     (forcedJSONParsing && !responseType) || responseType === 'json'
    //
    // Written from that condition rather than from the cases it produces,
    // because there are three ways to turn the parsing off and reading them
    // as a list is how the third one gets forgotten.
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
 * cannot be guessed from the value; the response says it. See `bodyIsRaw`.
 */
/** Presents an axios response as the `HttpResponse` the contract declares. */
function adapt(response: AxiosLikeResponse): HttpResponse {
    return {
        status: response.status,
        headers: { get: headerReader(response.headers) },
        json: async () => {
            const { data } = response;
            if (typeof data !== 'string') return data;
            return bodyIsRaw(response) ? JSON.parse(data) : data;
        },
        text: async () =>
            typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    };
}

export function createAxiosHttpClient(
    instance: AxiosLike,
    options: AxiosHttpClientOptions = {},
): HttpClient {
    const prefixes =
        typeof options.stripPrefix === 'string'
            ? [options.stripPrefix]
            : (options.stripPrefix ?? []);

    return async (url, init) => {
        try {
            return adapt(
                await instance.request({
                    url: stripped(url, prefixes),
                    method: (init?.method ?? 'GET').toUpperCase(),
                    headers: init?.headers,
                    data: init?.body,
                }),
            );
        } catch (err: unknown) {
            // A status the instance rejected still carries its response, and
            // by then every interceptor has had its turn — including a refresh
            // that may have retried and succeeded. Adapt what came back
            // instead of rethrowing, so the seam keeps its one error shape.
            const response = (err as { response?: AxiosLikeResponse })?.response;
            if (response && typeof response.status === 'number') return adapt(response);
            // No response at all: the request never completed. That is a
            // transport failure and belongs to the caller.
            throw err;
        }
    };
}
