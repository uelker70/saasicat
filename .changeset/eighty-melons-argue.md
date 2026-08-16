---
'@saasicat/ui-vue': minor
---

Give the admin one error type instead of five copies of a guess

`@saasicat/ui-vue` describes its HTTP seam as a bare function type — `HttpClient`
is `(url, init) => Promise<HttpResponse>` and nothing more. An error can
therefore arrive in whatever shape the consumer's client produces. Five pages
each answered that with the same nine lines:

```ts
type AxiosShape = { response?: { data?: { message?: string } } };
(err as AxiosShape)?.response?.data?.message ?? (err as Error)?.message ?? msg.value.errorAction;
```

That reads one shape: an axios rejection. Pass a `fetch`-based client — which
the package's own `defaultHttpClient()` is — and the first branch never matches.
It is not that the wording is wrong; it is that a consumer on the documented
default contract sees the platform's generic fallback for every failure, and no
test noticed because every fixture threw an axios-shaped object.

`AdminError` is now the one shape, and `toAdminError()` is the one conversion
into it. It recognises an axios rejection, any of the package's own `*ApiError`
classes (they all carry `status`, most carry `body`), a bare `Error`, a thrown
string, and a thrown nothing.

**The two ideas the old helper conflated now have separate names.** `message` is
the diagnostic — `GET /api/v1/admin/plans → HTTP 403 (PLAN_LOCKED)`, shaped like
the one `admin-resource-client.ts` already writes, so logs read the same whichever
layer threw. `detail` is what the failing side actually said, and it is
`undefined` when it said nothing. Only `detail` is a candidate for showing a
user; `adminErrorMessage(err, msgs)` is the single place that decides between it
and a translated fallback, and it never leaks a diagnostic into the UI.

A NestJS `ValidationPipe` rejection carries `message: string[]` — one entry per
failed constraint. Nothing in the repository handled that: the grep for
`Array.isArray(message)`, `message.join` and `message[0]` returned zero across
`packages/` and `examples/`, so a malformed request rendered as a comma soup or
fell through to the generic fallback. It is now joined deliberately, in
`readErrorDetail()` — exported rather than private because both paths that
build an `AdminError` have to give the same answer. They did not on the first
attempt: the JSON helper read the body a second, narrower way and accepted only
a string, so a validation rejection arriving through `getJson`/`postJson` lost
its constraints and showed the generic fallback anyway. Review found it; a test
now holds it.

New i18n namespace `errors`, eleven keys, one per branch `adminErrorMessage` can
take — `network`, `emptyResponse`, `unexpected`, `unauthorized`, `forbidden`,
`notFound`, `conflict`, `validation`, `rateLimited`, `server`, and a `{status}`
template for everything else. Nothing here restates a key `common` already owns:
those name an action ("Failed to load"), these name a cause. German and English
ship together, and `defineMessages` makes a missing English key a compile error.

**Three of those keys describe the same absent status and must not be swapped.**
A request that never left says `network` — check the connection. One the server
accepted and answered without the body it owed says `emptyResponse` — check
whether the change was applied, because it may well have been. A failure nobody
knows anything about says `unexpected`. None of them has an HTTP status to
reason from, so no number can tell them apart, and each is reached only because
the seam that knew declared it:

- the client that could not send the request calls `markTransportFailure()` —
  `defaultHttpClient` does it for every `fetch` rejection, and the JSON helpers
  do it for a client that reports the same by RESOLVING with `status: 0`;
- the mutation that needed a body and did not get one wraps its sentinel in
  `markEmptyResponse()`.

`toAdminError` reads both back through `isTransportFailure()` and
`isEmptyResponse()`, and everything else with no status falls to `unexpected`.
All four functions are exported, because a consumer whose own client can produce
those cases needs the same vocabulary.

Every one of those facts was a guess first, and each guess was wrong in a way
its shape could not reveal:

- **"one of ours, and `status: 0`" for an empty response.** That is a fact about
  the class, and one class hosts both kinds of throw site: `BootLoader`,
  `ManifestLoader` and `useDiscovery` raise their branded errors with whatever
  status the consumer's client reported, so a client that resolves a transport
  failure as `status: 0` — which XHR and axios do, and which the `HttpClient`
  contract permits — turned a failed read-only GET into "check whether the
  change was applied".
- **`if (!data)` for an empty response, in all 24 mutation sentinels.** The
  helpers under them only threw at `status >= 400`, so a status-0 resolve fell
  through and `null` meant two things at once. `usePlans().create()` answered
  "the change may have been applied" for a POST that never left the machine.
  The helpers now rule that out before they read a body: `requireServerAnswer()`
  is exported for a consumer writing its own.
- **`err instanceof TypeError` for a transport failure.** `TypeError` is also
  every ordinary null dereference, so a bug in page code was reported as a
  connection problem — `rows.map` on a `null` sent the operator after their
  router. An unrecognised `TypeError` now keeps its engine text on `message`,
  where a log reads it, and the operator is told `unexpected` rather than shown
  a stack-trace line.

A consumer's own status-0 error is unaffected throughout: it never carried a
brand, and its own message still outranks anything the platform would say.

**`HttpJsonError` is now `AdminError`** — the same class object, not a subclass,
so an existing `instanceof HttpJsonError` check keeps working and now also
matches errors raised elsewhere in the package. Construction changed:
`AdminError` takes one options object where `HttpJsonError` took
`(status, code)`. Nothing in this repository or in the two sibling consumer apps
constructs it — a response error is thrown at an app, not by one. For a
TypeScript caller the change is a compile error; for a JavaScript one it is
silent, producing an error with `status: 0` and no `code`. That asymmetry is the
reason to say it here rather than to keep a compatibility constructor for a
caller no search could find.

**`ManifestLoader` repairs a broken ETag cache instead of reporting it.** Its two
storage keys can come apart — a quota eviction, another tab clearing one of them
— and the conditional request built from the surviving ETag then earns a 304 for
a body that is gone. That used to throw `ManifestLoadError(304, '… call
clearCache() and reload')`: an instruction addressed to whoever was looking at
the admin screen, who has neither a console nor a loader handle. The loader now
drops the pair and repeats the request once without `If-None-Match`, which is
the same recovery, performed where it is possible. A 304 to a request that
carried no `If-None-Match` is a server fault and is still reported — with a
message that says that, and no retry loop.

Separating the two ideas above made the old behaviour visible: the instruction
was reaching users only because it was mistaken for something the failing side
had said, and it would have been shown in English to a German operator. Neither
half was right, so neither was kept.

**The diagnostics are English again, and five catalog keys are gone with
them.** `useDiscovery`, `useCatalogEntries`, `usePromotions` and
`useMarketingProjections` built the `message` of their branded errors through
the i18n layer, which made it a translated sentence — German by default — while
the brand on the class states the opposite: that this text is a diagnostic for
the log. Both halves were wrong, and one was visible: `DiscoveryPage` renders
that message, so a 500 reached the screen as the platform's internal wording
rather than as the catalog's.

The five keys that produced it are removed, because nothing reaches them any
more and a key that silently does nothing is worse than one that is gone:
`discovery.errorDiscoveryHttp`, `discovery.errorRescanHttp`,
`discovery.errorCatalogHttp`, `promos.apiErrorHttpStatus` and
`marketing.errors.projectionsApi`. An app that overrode one of them gets a
compile error from `SaMessagesOverrides` and should drop the override: the
sentence its users see now comes from the `errors` namespace, which is
overridable in one place for every seam.

**Two standard pages stop rendering `error.message`.** `DiscoveryPage` and
`MarketingCatalogPage` put the caught error's own text in their banner; with
diagnostics no longer translated that would have shown an English internal line
to a German operator. Both now call `adminErrorMessage()`, which is what the
type exists for — what the failing side said when there is such a text, the
catalog's sentence when there is not. The remaining page-level copies belong to
the page migration and are untouched.

---

Found while building it, and the reason `isAdminError()` exists rather than a
plain `instanceof`: **esbuild code-splits ESM but not CJS**, so `dist/index.cjs`
and `dist/client/index.cjs` each carry their own copy of the class. Verified,
not assumed:

```text
CJS same class object:            false
CJS instanceof across entries:    false
```

An app that reaches the package through both entries holds two `AdminError`s.
Without a brand, `toAdminError` would treat one copy's error as an unknown
thrown value and re-wrap it — dropping the `status`, `code` and `body` it was
carrying, which is the failure the type exists to prevent. The brand is a
`Symbol.for` key, so every copy resolves the same symbol through the process-wide
registry. Counter-checked by swapping it for a plain `Symbol()`: the
cross-copy recognition test fails and the "two separate classes" test still
passes, which is the discrimination that makes the test worth having.

The same argument holds for the three declarations, which is why they are
`Symbol.for` keys too: a consumer's HTTP client usually comes from `./client`
while the page that renders the error reaches `toAdminError` through `.`, so a
brand that did not resolve across copies would drop the fact and take the
wording with it.

The five page-level `errMsg()` copies are not removed here — they belong to the
page migration. The two banners named above are changed because leaving them
alone would have been the regression, not because the migration started.
