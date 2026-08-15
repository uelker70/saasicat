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

Two details the copies got wrong, fixed here once:

- **Prefix stripping respects path boundaries.** Four of the shims wrote
  `url.slice(7)` — a hardcoded `'/api/v1'.length`. `startsWith` alone matches
  `/api/v10/x` and would cut it to `0/x`. Caught by the test before it shipped.
- **Response headers read under any casing.** The manifest loader asks for
  `ETag` and then again for `etag`, because it could not rely on the shims
  agreeing. Both adapters answer either.

`stripPrefix` accepts a list as well as a string, because one consumer strips
`/api/v1` and then `/api` — apps there mount under both conventions. Order
matters and the shorter prefix must come last; it is documented on the option.

Migrated in this release: both notesapp apps, the scaffolder template, and
handbook §8.1, which now shows the two adapters instead of printing a shim.
Duplication across `packages/` and `examples/` moves 2.89 % → 2.86 %.

Existing hand-written clients keep working unchanged — the contract they satisfy
did not move.
