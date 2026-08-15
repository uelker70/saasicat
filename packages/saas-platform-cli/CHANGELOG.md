# @saasicat/cli

## 0.25.0

### Patch Changes

- @saasicat/spec@0.25.0
- @saasicat/types@0.25.0
- @saasicat/nest@0.25.0

## 0.24.2

### Patch Changes

- @saasicat/spec@0.24.2
- @saasicat/types@0.24.2
- @saasicat/nest@0.24.2

## 0.24.1

### Patch Changes

- @saasicat/spec@0.24.1
- @saasicat/types@0.24.1
- @saasicat/nest@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/spec@0.24.0
- @saasicat/types@0.24.0
- @saasicat/nest@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/spec@0.23.0
- @saasicat/types@0.23.0
- @saasicat/nest@0.23.0

## 0.22.2

### Patch Changes

- Updated dependencies [4a0b534]
    - @saasicat/nest@0.22.2
    - @saasicat/spec@0.22.2
    - @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- Updated dependencies [2348568]
- Updated dependencies [854fb16]
    - @saasicat/nest@0.22.1
    - @saasicat/spec@0.22.1
    - @saasicat/types@0.22.1

## 0.22.0

### Minor Changes

- 9599214: Fix four defects that only showed up in a running admin

    **A route-mounted page cannot require props.** `AdminManifestErrorPage`
    declared `onRetry` and `onLogout` as required, but `createAdminRoutes()`
    mounts it as a plain route record and Vue Router passes nothing to such a
    component. The props were unsatisfiable by construction, and this is the
    fail-closed screen — it renders precisely when the app is already in
    trouble, and both of its buttons called `undefined`. They are now optional
    with defaults that work standalone.

    **An expired session is not a broken manifest.** A 401/403 from the
    manifest load sent the operator to the error page — "the manifest could not
    be loaded" — when the truth was "log in again". This is the normal path
    after a token expires, because `isAuthenticated()` in practice only checks
    that a token exists. The guard now separates the two, and offers the
    re-login exactly once: a consumer's `onUnauthenticated` typically clears the
    session, so a manifest that keeps rejecting for a reason logging in cannot
    fix would otherwise produce an unbreakable login loop.

    **Signing out did not sign anyone out.** Both platform affordances are
    reached through components every consumer mounts as bare route records:
    `AdminLayout` at `/admin` and `AdminManifestErrorPage` at `/admin-error`.
    A route record attaches no props and no listeners, so the layout's
    `emit('logout')` reached nobody at all, and the error page's fallback only
    called `router.replace('/login')`. Since `isAuthenticated()` reads a token
    out of storage, the session survived and the next navigation to `/admin`
    walked straight back in — the operator saw a login form and was still
    signed in. `SuperAdminLoginAdapter` gained an optional `logout()`, and both
    components now end the session through it before navigating; apps that pass
    `@logout` or `onLogout` keep full control, and an app that supplies neither
    gets a console warning rather than silence.

    **The fail-closed page was a dead end.** Its retry reloaded `/admin-error`
    in place — a route that is `meta.public` by necessity, so the navigation
    guard returns before it ever reaches `ensureLoaded()`. The manifest was
    never fetched again and the operator stayed stuck even after the backend
    recovered. Retry now boots into a guarded route (`retryPath`, default
    `/admin`).

    **Requests bypassing the HttpClient seam.** Three call sites used a bare
    `fetch()`, dropping the Authorization header the app registered via
    `createSuperAdminApp({ http })`. One of them was unreachable code that
    looked like a safeguard; two were live.

    **The dashboard dropped the auth token it was given.** `DashboardPage`
    declared `getAuthToken` and documented it as the token provider for the
    default client — and never read it. Removing the page's bare `fetch()` had
    taken the Authorization header with it, so an app mounting the page the
    documented way sent every KPI request unauthenticated and rendered an error
    in all of its cards. The token now travels as a header the way `useApiList`
    and the other standard pages do it.

    **`@RequireFeature` failing silently.** `SaaSiCatModule` documented a boot
    warning for the case where no plan resolver is configured — and never
    emitted one. Annotated routes then served everyone, quotas read as
    unlimited, and nothing said so. Two warnings now, each naming what is inert
    and how to fix it.

    Also: the primary `saasicat` CLI now speaks English (it was entirely German,
    against the README's own promise), and `@saasicat/ui-vue` emits the
    declaration files its `./testing-e2e/*` export has always promised — a
    concurrent `clean` in the build deleted them after writing.

### Patch Changes

- Updated dependencies [9599214]
    - @saasicat/nest@0.22.0
    - @saasicat/spec@0.22.0
    - @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/spec@0.21.0
- @saasicat/types@0.21.0
- @saasicat/nest@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0
    - @saasicat/nest@0.20.0
    - @saasicat/spec@0.20.0

## 0.19.0

### Minor Changes

- 0c17a83: Translate all user-facing strings to English

    Exception messages, log output, validation messages and CLI output were partly
    German. For an open-source package the shipped language has to be English, so
    consuming apps can localise on their own terms.

    Both feature guards keep `Feature` as the leading word of their 403 message
    (`Feature X is not included in the current plan.`). Consumers that classify the
    403 by matching the message text — autohauspro does — keep working. That text
    match is a fragile contract, and the follow-up is to give every exception a
    stable `code` so consumers can resolve their own i18n by code instead of by
    message.

    No API, no behaviour and no error-code change; only message text.

### Patch Changes

- b01eaa0: Give every exception a stable error code

    Consumers had to classify errors by matching the message text — autohauspro
    still does, with `data.message.includes('Feature')`. While the message is the
    contract, no message can be reworded safely, and a package that ships English
    text cannot be localised by its consumers.

    `@saasicat/types` now exports a catalogue of 127 codes grouped by domain, plus
    `PlatformErrorCode` and `PlatformErrorBody`. Every exception in
    `@saasicat/nest` carries `{ code, message, params }`: the code is the
    contract, `message` is an English developer-facing fallback, and `params`
    holds the values previously only interpolated into the text, so a consumer can
    render a translated sentence without scraping ids back out of the message.

    Guards that reported through a `reason` field (MFA, promo rate limit,
    IP rate limit, the limit-exceeded filter) now send `code` **and** `reason`.
    `reason` is deprecated but retained, so nothing breaks.

    Wire-shape note: NestJS turns a string argument into
    `{ message, error, statusCode }` but passes an object argument through
    verbatim. Coded errors therefore carry no `error`/`statusCode` in the body —
    the HTTP status is on the response itself. No consumer in this workspace reads
    those fields from the body.

    Two known defects are documented in the catalogue and deliberately left for a
    separate release, because fixing either changes the wire format:
    `PLAN_VERSION_NOT_LIVE` covers two distinct causes, and
    `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` spells "cancel" with one L beside a
    sibling that uses two.

    Also repairs 28 strings that the previous translation left half-German
    ("is notehr buchbar", "not foundefunden") or untranslated.

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/nest@0.19.0
    - @saasicat/types@0.19.0
    - @saasicat/spec@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/spec@0.18.1
- @saasicat/types@0.18.1
- @saasicat/nest@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/spec@0.18.0
- @saasicat/types@0.18.0
- @saasicat/nest@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/nest@0.17.0
    - @saasicat/types@0.17.0
    - @saasicat/spec@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/spec@0.16.0
- @saasicat/types@0.16.0
- @saasicat/nest@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [de0fc7c]
    - @saasicat/nest@0.15.1
    - @saasicat/spec@0.15.1
    - @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [c970673]
    - @saasicat/nest@0.15.0
    - @saasicat/spec@0.15.0
    - @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [76d99a5]
    - @saasicat/nest@0.14.0
    - @saasicat/spec@0.14.0
    - @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0
    - @saasicat/nest@0.13.0
    - @saasicat/spec@0.13.0

## 0.12.1

### Patch Changes

- da8aa64: Fix four parsing defects in `schema check`, all found by review of the previous
  two releases. Each let the check pass on a schema it should have flagged, or
  skip a declaration it should have compared.

    **Commented-out block attributes counted as present.** A consumer with
    `// @@unique([tenantId])` or `// @@map("subscriptions")` was reported `ok`,
    defeating exactly the correctness gate those attributes exist for. Attribute
    parsing now strips comments first. A production consumer had consequently
    never applied its canonical partial unique indexes at all.

    **A brace inside a string literal closed the model early.** `@default("}")`
    counted as structure, so every field below it looked missing — or spec fields
    after it were silently dropped and the check returned a false success. Brace
    counting now blanks string contents. `stripLineComment` became string-aware in
    the same move, so `@default("http://x")` no longer loses everything after `//`.

    **Indexed field arguments were skipped entirely.** In
    `@@index([title(sort: Desc)])` the capture stopped at the argument's closing
    paren before reaching `]`, so the index never entered the parsed set and a
    consumer lacking it got no finding. The field list is now matched to its
    closing bracket.

    **Unknown fragment selectors were silently discarded.** `--fragments=01,99`
    checked only fragment 01 and exited 0, so a typo in a CI gate left part of the
    schema surface unverified. Unknown selectors now fail with the available list.
    - @saasicat/spec@0.12.1
    - @saasicat/types@0.12.1
    - @saasicat/nest@0.12.1

## 0.12.0

### Minor Changes

- c78e1f0: `schema check` now compares block-level attributes too — `@@index`, `@@unique`
  and `@@map`.

    Comparing only fields and enum values left a whole class of divergence
    invisible. Multiple consumer schemas were missing declared indexes while
    still reporting "no drift". Worse, the same blind spot hid a missing
    `@@unique`: nothing in the field comparison can tell you that a constraint
    the platform relies on was never created.

    The two kinds are not treated alike. A missing index costs query time but
    breaks nothing, so it is reported as information and does not fail the run. A
    missing `@@unique` or a diverging `@@map` does fail: the platform relies on the
    constraint holding, and on finding the table under its canonical name.

    Attribute options and whitespace are normalised, so `@@index([a,b], map: "x")`
    matches `@@index([a, b])`. Indexes a consumer adds on top are never reported —
    same rule as for fields.

    Note the remaining gap: constraints Prisma's DSL cannot express at all (the
    partial unique indexes in `sql/constraints.postgres.sql`) still live outside
    any schema comparison. Consumers must apply them separately.

### Patch Changes

- @saasicat/spec@0.12.0
- @saasicat/types@0.12.0
- @saasicat/nest@0.12.0

## 0.11.0

### Minor Changes

- bded377: Rename the CLI binary from `saas-platform` to `saasicat`.

    **Breaking for anyone invoking the binary by name.** `pnpm exec saas-platform …`
    becomes `pnpm exec saasicat …`. No alias is kept: the audited integrations
    use `@saasicat/cli` as a library for their `nest-commander` commands and ship
    their own binary.

    The old name was the last user-facing place where the package still announced
    itself as "saas-platform" while shipping as `@saasicat/cli`, which made it
    easy to confuse this framework with superseded `saas-platform-*` packages.
    The header comment `schema apply` writes into a consumer's `schema.prisma`
    now names `saasicat schema apply` too.

    Deliberately unchanged: the DI token namespace (`Symbol.for('saas-platform/…')`,
    `Symbol.for('saas-platform-cli/…')`). Those strings are identity, not
    branding — renaming them would break token equality between package versions.
    CONTRIBUTING.md documents the namespace as historical.

- bded377: Add `saasicat schema check` — reports what a consumer's `schema.prisma`
  is missing relative to the canonical prisma-fragments, and exits 1 on drift so
  CI can gate on it.

    `schema apply` only ever adds whole models: it carries no enums, and a model
    that already exists is skipped rather than updated. After a package upgrade a
    consumer schema therefore falls behind silently, and the gap only surfaces as a
    runtime error. Run against reference and consumer schemas, the new check
    finds missing `PlanVersion`/`BundleVersion` fields and field mismatches that
    were previously invisible.

    The check distinguishes two situations that look alike:

    - A field or enum value missing from a declaration the consumer **does** carry
      fails the check — platform code reads it with the spec's type. Type,
      optionality and list changes fail for the same reason.
    - A model or enum the consumer does not carry at all is reported as
      information. Not adopting a fragment is a decision, not drift.

    Fields a consumer adds on top of a platform model are never reported:
    extending them is supported, so a drift check has to tolerate it. Replacing a
    spec `String` with a locally declared enum stays allowed too — the fragments
    document that substitution explicitly.

    The block parser `schema apply` used moved to `prisma-blocks.ts` and now
    handles `enum` declarations as well; `extractModelNames`/`extractModelBlocks`
    keep their signatures.

### Patch Changes

- bded377: Align `PromoCode.createdById` with the types the platform already publishes, and
  stop `schema check` from flagging consumers that are stricter than the spec.

    The prisma fragment declared `createdById String` (NOT NULL) while
    `PromoCodeRecord.createdById` in `@saasicat/types` is `string | null` — the read
    contract explicitly allows a missing creator, so the column must too. Creation
    is unaffected: `CreatePromoCodeData.createdById` stays `string`. The fragment
    and the generated `reference-schema.postgres.sql` now say `String?` / `TEXT`.

    `schema check` treated nullability as a symmetric mismatch, which made this a
    zero-sum change: relaxing the spec simply moved the warning between consumer
    schemas. Only one direction can actually break — a consumer column that is
    nullable where the spec is not, because platform code reads it with the
    spec's non-null type and a NULL row reaches it as `null`. The reverse is a
    deliberate tightening by the consumer, and if the platform ever wrote NULL
    there the insert would fail loudly rather than silently. Only the breaking
    direction is reported now.

- Updated dependencies [bded377]
    - @saasicat/spec@0.11.0
    - @saasicat/types@0.11.0
    - @saasicat/nest@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [30ec6c6]
    - @saasicat/nest@0.10.1
    - @saasicat/spec@0.10.1
    - @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [7145f07]
    - @saasicat/nest@0.10.0
    - @saasicat/spec@0.10.0
    - @saasicat/types@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0
    - @saasicat/nest@0.9.0
    - @saasicat/spec@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/spec@0.8.0
    - @saasicat/types@0.8.0
    - @saasicat/nest@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/nest@0.7.0
    - @saasicat/spec@0.7.0
    - @saasicat/types@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [98274fe]
- Updated dependencies [0c08fc3]
    - @saasicat/spec@0.6.0
    - @saasicat/types@0.6.0
    - @saasicat/nest@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/spec@0.5.0
- @saasicat/types@0.5.0
- @saasicat/nest@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [5802454]
    - @saasicat/nest@0.4.0
    - @saasicat/spec@0.4.0
    - @saasicat/types@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0
    - @saasicat/spec@0.3.0
    - @saasicat/nest@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/spec@0.2.1
- @saasicat/types@0.2.1
- @saasicat/nest@0.2.1

## 0.2.0

### Patch Changes

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [db10ab9]
- Updated dependencies [c94b1fe]
    - @saasicat/spec@0.2.0
    - @saasicat/types@0.2.0
    - @saasicat/nest@0.2.0
