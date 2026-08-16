---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Ship the HTTP adapter every app was writing by hand

`@saasicat/ui-vue` declares an `HttpClient` contract and shipped exactly one
implementation of it: `defaultHttpClient()`, a bare `fetch` passthrough with no
auth. Every real app therefore wrote its own — and wrote the same one. Counted
across this repository and the three known consumer apps: **eight** hand-written
adapters, 22 to 64 lines each. Six axios, two `fetch`. The handbook printed a
ninth as the thing you are supposed to write, and the example app kept two
copies of it, one for `admin/` and one for `web/`.

They differ in the prefix they strip. That is the whole variation.

```ts
// before — in every app, and in §8.1 of the handbook
const httpClient: HttpClient = async (url, init) => {
    const stripped = url.startsWith('/api/v1') ? url.slice(7) : url;
    const r = await api.request({/* … 18 more lines … */});
};

// after
const platformHttp = createAxiosHttpClient(api, { stripPrefix: '/api/v1' });
```

`createAxiosHttpClient(instance, opts?)` is typed **structurally** — it declares
the one method it uses and does not import axios, so the package still installs
with `@saasicat/types` as its only dependency. `createFetchHttpClient(opts?)`
takes a `baseUrl` and a per-request `headers` hook, which is what the two
`fetch` shims needed: a token read at request time, not at construction, so a
refresh is picked up without rebuilding the client. The hook may return a
promise, because one of them awaits its token.

`defaultHttpClient()` now delegates to `createFetchHttpClient()` rather than
calling `fetch` itself. One implementation to reason about instead of two that
drift — and it keeps the ESLint exemption for `fetch` exactly one file wide.
It gains an `Accept: application/json` header, which is what stops a
content-negotiating gateway from answering the admin API with HTML.

**Neither adapter throws on an HTTP status.** The shims used
`validateStatus: s < 500`, which let a server error escape as an axios
rejection — a second error shape, out of the one seam whose entire purpose is to
have one. The platform reads statuses itself: a 304 is a manifest cache hit, a
402 carries a limit payload, a 409 a conflict. It can only do that for statuses
it is handed. Only a transport failure rejects now, and `toAdminError()` gives
it `status: 0`.

The axios adapter reaches that by **adapting the rejection**, not by overriding
`validateStatus`. The override was the first attempt and it was wrong: axios
decides resolve-vs-reject from `validateStatus`, and its response interceptors
are chained as `then(onFulfilled, onRejected)` — so a config that never rejects
makes the **rejection half unreachable for every status**. That is the
conventional place a consumer puts token refresh and retry, and an expiring
session would have been handed to the platform as a 401 instead of being
refreshed. The instance now runs its own chain to the end; a rejection that
still carries a response is adapted, and only a genuine no-response failure
escapes.

**"Genuine" is axios's own word for it, not a shape that resembles one.** The
escaping rejection is marked with `markTransportFailure` — so that `status: 0`
becomes "check your connection" rather than raw error text — and which
rejections earn that mark was measured against axios 1.18.1 driven at a real
`node:http` server, because two readings of the same `catch` disagree and no
amount of reasoning settles which is right. axios states the answer itself,
in the three-way split its README documents: `response` set means the server
answered; `request` set without it means the request was made and nothing came
back; neither means the failure happened while the request was still being set
up. A refused connection, a DNS failure, a timeout and an abort all land in the
middle group, and still do when a rejection interceptor rethrows them.

Everything else propagates unmarked and keeps its own message. That matters most
for the case a `config`-based reading got backwards: an interceptor that handles
a 401 and rejects with `new Error('session expired')` had those words replaced
by the network sentence, misreporting an expired session as a broken connection.
`config` is echoed on every axios rejection, answered ones included, and it is
the field an interceptor is most likely to carry over — it never was a statement
about whether a response arrived. The same now holds for the failures axios files
under "setting up the request" (an unsupported protocol, a signal aborted before
the call, a throwing `paramsSerializer`): their message names the actual fault,
which beats sending an operator after their router for a configuration mistake.

The one case nothing here can decide is a client that replaced the rejection
without saying which case it was in — a bare `Error` out of a structural
`AxiosLike`, or out of an interceptor. Offline and "session expired" are the
same object down to the last own property, so the platform declines to guess and
the message survives. A client that knows says so with `markTransportFailure`,
which is why that is exported; `isAxiosNoResponseError(err)` is now exported too,
for a consumer that wants the same reading in its own interceptor.

Three details the copies got wrong, fixed here once:

- **Prefix stripping respects path boundaries.** Four of the shims wrote
  `url.slice(7)` — a hardcoded `'/api/v1'.length`. `startsWith` alone matches
  `/api/v10/x` and would cut it to `0/x`. Caught by the test before it shipped.
- **Response headers read under any casing.** The manifest loader asks for
  `ETag` and then again for `etag`, because it could not rely on the shims
  agreeing. Both adapters answer either.
- **`json()` decodes the body once.** A normal axios instance has already
  decoded it, so `response.data` may be a string because the body _was_ a JSON
  string — a body of `"ready"` arrives as `ready`. Decoding that again throws,
  and a body of `"null"` would quietly become `null`. The adapter reads which of
  the two it is off the config axios echoes on the response, so `res.json()`
  yields the value that was on the wire for every instance that still runs
  axios's own response transform — the default, `responseType: 'json'`,
  `responseType: 'text'`, `transformResponse: []`, `transformResponse: null` and
  `transitional: { forcedJSONParsing: false }` alike. The last two are read from
  the same fact rather than listed: `transformResponse` is the collection axios
  hands to its own `forEach`, and `forEach` runs nothing for an empty array and
  nothing for a nullish collection, so either is proof the body was not touched.
  An **absent** `transformResponse` is not — that is a structural stand-in that
  never spoke, and it keeps being read as decoded.

    That reading stops where the transform does. An instance carrying its own
    non-empty `transformResponse` echoes the same config a stock instance
    echoes — one opaque function, same array length, same arity — and
    `[(data) => data]` and `[(data) => JSON.parse(data)]` are indistinguishable
    on the response while needing opposite answers. The only field that differs
    is `content-length`, which gzip or a chunked reply makes meaningless. So
    that instance says which it is, with the new `responseBody` option: `'raw'`
    when the pipeline hands the body over as it arrived, `'decoded'` when it
    parses, `'auto'` (the default) to read the response, which is what everyone
    who left `transformResponse` alone wants and has to configure nothing for.

    **The declaration is read before the body is looked at**, and that ordering
    is the whole point of having one. There is a second undecidable case hiding
    in the empty body: axios's transform leaves the same empty `data` behind for
    a zero-byte response and for the two bytes `""`, which are valid JSON meaning
    the empty string. Under `'auto'` the adapter reads an empty `data` as no body
    and `json()` throws, as `Response.json()` does — the honest answer when the
    two cannot be told apart. Under `'decoded'` the consumer has said `data` is
    the value, so `''` is the empty string and is handed over; under `'raw'` it
    is an empty body and still throws.

    **A body axios never turned into text is turned back.** `responseType:
`'arraybuffer'`and`'blob'`switch the decoding off the way`'text'`does;
only the shape differs, so the bytes are decoded as UTF-8 and read like any
other undecoded body.`json()`used to hand back the buffer itself and
 `text()`its serialization —`{"type":"Buffer","data":[123,…]}`for a body
reading`{"slug":"acme"}`. A `'stream'` response is refused with a message
    naming the option to change, because a stream is consumable once and never
    synchronously: returning it satisfied the type and broke the promise.

    The adapter does not force the transform off to make the answer knowable.
    That would work, and it would hand the consumer's own response interceptors
    a string where they had an object — the same mistake as the
    `validateStatus` override above, in a different place.

`stripPrefix` accepts a list as well as a string, because one consumer strips
`/api/v1` and then `/api` — apps there mount under both conventions. Order
matters and the shorter prefix must come last; it is documented on the option.

Migrated in this release: both notesapp apps, the scaffolder template, and
handbook §8.1, which now shows the two adapters instead of printing a shim.
Duplication across `packages/` and `examples/` moves 2.89 % → 2.85 %.

Existing hand-written clients keep working unchanged — the contract they satisfy
did not move.
