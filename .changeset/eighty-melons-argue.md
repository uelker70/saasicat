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

New i18n namespace `errors`, nine keys, one per branch `adminErrorMessage` can
take — `network`, `unauthorized`, `forbidden`, `notFound`, `conflict`,
`validation`, `rateLimited`, `server`, and a `{status}` template for everything
else. Nothing here restates a key `common` already owns: those name an action
("Failed to load"), these name a cause. German and English ship together, and
`defineMessages` makes a missing English key a compile error.

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

The five page-level copies are not removed here — they belong to the page
migration, and this release changes no page behaviour.
