# @saasicat/nest

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1
    - @saasicat/spec@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 9449492: **One name for everything — and a codemod that applies it.** Phase 5 of the 1.0 cut.

    `npx @saasicat/cli@latest codemod v1 --dir=.` does the surface cut from the previous
    candidates and everything below in one run. `docs/migrating-to-1.0.md` is the written
    form, with before/after for each change.

    **`SaasPlatformModule` is gone; `SaaSiCatModule` is the class**, not an alias of it.
    The thirteen `SaasPlatform*` option types are `SaaSiCat*` — `SaaSiCatModuleOptions`,
    `SaaSiCatAdapters`, `SaaSiCatCatalogOptions` and so on. `createSaasPlatformTestModule`
    is `createSaaSiCatTestModule`; `SaasicatPersistenceAdapter` and its six slice types are
    `SaaSiCatPersistenceAdapter` and `SaaSiCatPersistence*`. There is one spelling of the
    product name left: `SaaSiCat` in types and prose, `saasicat` in packages and files,
    `SAASICAT_` in constants.

    **Every registry key is `saasicat/<package>/<Name>`.** Four prefixes —
    `saas-platform/`, `saas-platform-nest/`, `saas-platform-cli/`, and `@saasicat/ui-vue/` for
    the Vue injection keys — became one. This matters only if your code calls `Symbol.for`
    with one of those strings itself; the exported token constants are unchanged in name and
    resolve as before. The keys will not be renamed again: the rule in `CONTRIBUTING.md` says
    why, and a repository test refuses any other prefix.

    **`FEATURE_UI_REGISTRY_TOKEN` has two names now**, because it meant two registries:
    `BILLING_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/billing` and
    `CATALOG_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/catalog`. The codemod picks by
    the entry you imported from and reports an import it cannot decide.

    **`@saasicat/ui-vue/testing-e2e/*` is `@saasicat/ui-vue/testing/*`** — the Playwright
    helper consumers run their admin pages through. Nothing else about it changed.

    Inside the repository, for anyone who reads it: the package directories are the package
    names (`packages/nest`, not `packages/saas-platform-nest`), Nest files follow
    `<area>/<name>.module.ts`, adapter files end in `.repository.ts` or `.adapter.ts`, and test
    directories are `tests/{integration,component,e2e}`. None of that reaches a consumer's
    imports.

### Patch Changes

- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0
    - @saasicat/spec@1.0.0-rc.0

## 0.27.0

### Minor Changes

- 0a46f7f: Backend integration: a generator, a boot that refuses a broken licence chain,
  and configuration errors that arrive all at once.

    **`saasicat init`** scaffolds the platform wiring — app config, persistence
    bundle, feature-UI registry, manifest contribution, admin module, one provider
    per `--quota=key:Model`, a password hasher — and adds
    `SaaSiCatModule.forRoot(...)` to an existing `src/app.module.ts`. What was
    thirteen files to create by hand is now none: what stays yours is what each
    quota counts, the hasher if scrypt is not enough, and your auth guard. The
    command prints all three as next steps and refuses to overwrite an existing
    file. A value flag written without `=` is a usage error rather than an internal
    one, `--app-name="My App"` produces `MyAppAdminModule` while the catalogue keeps
    the words, and a root module whose last import spans several lines is no longer
    cut open at its opening brace.

    The generated module does not compile until you name that guard — it writes
    `controller: { guards: [YourAuthGuard] }`, a symbol that does not exist, and
    `tsc` says so once. An empty array would have compiled, and `[]` is this
    platform's word for _deliberately_ unauthenticated: the discovery and manifest
    endpoints would have answered to anyone.

    **`saasicat init` refuses what the platform would refuse, before it writes
    anything.** Everything in `config/saas.yaml` is validated against the catalogue
    schema at boot, so every rule the generator skipped was one the integrator met
    after every file had been written and `app.module.ts` patched. Three of them
    each produced an application that could not start: a project key outside
    `^[a-z][a-z0-9-]{1,30}$`, a quota key with a separator (`active-seats` — the
    plan's `quotas` object forbids additional properties), and no `--quota` at all,
    which wrote `quotas: {}` where the schema requires at least one. `--quota` is
    therefore required now. All three rules are read off the schema rather than
    restated, and the suite loads the generated catalogue with the platform's own
    loader.

    **A broken enforcement chain no longer boots.** `@RequireFeature` and
    `@EnforceQuota` with nothing able to resolve a tenant to a plan used to be
    silent — the routes answered, the quotas read as unlimited, and the first signal
    was a customer using something they never bought. `EnforcementChainCheck` now
    refuses the boot, after bootstrap where the annotated routes are visible, and
    names them. Same for `globalFeatureGuard: false` with a route that has no
    feature guard in front of it. An application with no annotations at all still
    boots: a catalogue without enforcement is a real shape.

    **Breaking:** an application in any of those states will stop starting. Neither
    known consumer is affected: every `@RequireFeature` in both sits in a file that
    also binds a feature guard, and neither has a single `@EnforceQuota` route, so
    the quota branch cannot fire for them. `FeatureGuardCoverageCheck` is renamed to
    `EnforcementChainCheck`.

    Quotas are asked about separately from features, because only the static stack
    registers `EnforceQuotaInterceptor`: an application on the V3 entitlement path
    with no plan resolver enforces `@RequireFeature` correctly and cannot enforce
    `@EnforceQuota` at all. That combination used to boot with every quota reading
    as unlimited.

    Two shapes the check cannot recognise and correctly enforces anyway: a feature
    guard of your own that wraps ours without carrying `FEATURE_GUARD_MARKER`, and
    one bound globally as an `APP_GUARD` rather than per controller. Set
    `enforcementChainCheck: false` if that is you — it turns off this check and
    nothing else.

    **Configuration problems arrive together.** The fifteen checks in `forRoot` are
    a rule table now: a misconfigured application gets the complete numbered list on
    the first boot, each entry with its rule id and a link to
    `docs/reference/options.md` — which is generated from that table. Five missing
    bindings used to cost five restarts.

    **`saasicat schema migrate`** writes the migration with `--create-only`,
    appends the constraints Prisma's DSL cannot express, and then applies it — or
    stops before applying, if appending failed, because the advice it prints then
    (add the SQL by hand first) is only followable while the migration is unapplied
    —
    instead of asking you to paste them in. Only the constraints whose tables that
    migration creates, so a run scoped with `--fragments` is not failed by an index
    on a table it never made.

    And `schema apply`/`schema migrate` take `--tenant-model` / `--user-model` to
    enable the foreign keys from the platform tables to your own models. A name your
    schema does not declare is refused, with the list of names it does; a relation
    whose opposite field your model does not carry stays commented and the command
    prints the exact line to add, because writing it would produce a schema Prisma
    refuses.

    **`PrismaAdminResourcesAdapter` takes a mapping.** `adminResources: { delegates:
{ tenant: 'organization' }, fields: { tenant: { isActive: 'enabled' } } }` — an
    application whose models are named differently no longer has to set
    `adminResources: false` and lose every SuperAdmin endpoint. A mapped delegate
    the client does not have fails at construction and lists the ones it does. The
    shape is still the boundary: an m:n tenant/user relation implements
    `AdminResourcesPort` itself.

    **`@saasicat/ui-vue`** completes the resource descriptors: bundles, bundle
    versions, catalogue entries, discovery, marketing, promo codes, promotions,
    users, subscriptions, and the by-slug tenant operations — 13 descriptors over 54
    operations, each held to the same request as the composable or admin client it
    mirrors.

    Internal: `saas-platform.module.ts` is 244 lines instead of 1,240, with one
    composer file per feature; two redundant port barrels are gone from
    `@saasicat/types`; and ESLint now enforces the nest domain boundaries with no
    exemptions.

- 40e270c: **The license changes from Apache-2.0 to PolyForm Shield 1.0.0.** SaaSiCat is
  source-available from this release on, not OSI open source.

    What stays permitted, and it is nearly everything: reading the code, running it,
    changing it, redistributing it, and building and selling your own SaaS product on
    top of it. What is not permitted is offering a product that competes with
    SaaSiCat itself, or with a product its author provides using it. There is no time
    limit and no reversion to a permissive license.

    **Versions up to and including 0.26.1 remain Apache-2.0.** Rights granted with a
    published version cannot be withdrawn, and npm versions are immutable — if you
    depend on 0.26.1 or earlier, nothing about your terms changes until you upgrade.

    Practically: if you use SaaSiCat to build an application, this changes nothing
    for you. If you were planning to repackage SaaSiCat itself as a product, it does.

    The reasoning, the alternatives that were weighed, and the consequences are in
    [ADR 0001](https://github.com/uelker70/saasicat/blob/main/docs/adr/0001-source-available-licensing.md).

### Patch Changes

- Updated dependencies [0a46f7f]
- Updated dependencies [40e270c]
    - @saasicat/types@0.27.0
    - @saasicat/spec@0.27.0

## 0.26.1

### Patch Changes

- @saasicat/spec@0.26.1
- @saasicat/types@0.26.1

## 0.26.0

### Minor Changes

- bea2423: Let the caller of `buildLabel` choose the number locale and the currency.

    The promo label was formatted in German and worded in English — `25 % once`,
    `1.234,56 € for the first month` — and the `€` was written into the string by
    hand. That is not an internal debug string: `PromoCodesService.preview()` puts
    it on the wire as `label`, so an app that renders the promo preview shows it to
    the customer in checkout. A German product got English words, an English one
    got German digit grouping, and everybody got euros.

    `buildLabel` now takes a third, optional argument:

    ```ts
    buildLabel(promo, 'MONTHLY', { locale: 'en-US', currency: 'USD' });
    // '$30.00 once' — was '30,00 € once' regardless of what you asked for
    ```

    `locale` is a BCP-47 tag and decides grouping, the decimal separator and where
    the symbol sits; `currency` is an ISO-4217 code and decides the symbol and the
    number of decimals — two for EUR, none for JPY, because the minor-unit count
    belongs to the currency rather than to this function. Percentages follow the
    locale too, so `en-US` writes `25%` closed up where `de-DE` writes `25 %`. An
    unusable locale tag raises a `RangeError` instead of quietly falling back to
    another one.

    **Nothing moves unless you pass the argument.** The defaults are the previous
    `de-DE` and `EUR`, down to the bytes: `Intl` separates a number from its unit
    with a non-breaking space, so every such space in the formatted number is
    folded to a plain one — the old string-concatenated output used a plain space,
    and an invisible character that shifts with the runtime's ICU version has no
    business travelling over the wire.

    `PromoCodesService.preview()` still calls `buildLabel` with the defaults, so
    the `label` in a promo preview response is unchanged. What is not solved here
    is the language of the words: `once`, `for the first month` and `for 6 months`
    are English and stay English, because translating them means composing the
    sentence from `valueType`, `value`, `durationType` and `durationValue` — the
    same fields the response already carries in `discount` — in the consumer's own
    i18n layer. That version drops the string from the payload and is a breaking
    change; this one is the part that fits under it.

### Patch Changes

- @saasicat/spec@0.26.0
- @saasicat/types@0.26.0

## 0.25.0

### Patch Changes

- @saasicat/spec@0.25.0
- @saasicat/types@0.25.0

## 0.24.2

### Patch Changes

- @saasicat/spec@0.24.2
- @saasicat/types@0.24.2

## 0.24.1

### Patch Changes

- @saasicat/spec@0.24.1
- @saasicat/types@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/spec@0.24.0
- @saasicat/types@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/spec@0.23.0
- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- 4a0b534: Import the discovery primitives the coverage check depends on

    `FeatureGuardCoverageCheck` injects Nest's `DiscoveryService` and
    `MetadataScanner`, which exist only once `@nestjs/core`'s `DiscoveryModule` is
    imported. It was registered without it, so any application reaching that branch
    with the platform's own DiscoveryModule switched off failed to boot:
    "Nest can't resolve dependencies of the FeatureGuardCoverageCheck".

    Found by a consumer's test suite rather than ours, because the first test for
    this check constructed the class directly and never went through DI. The module
    test now asserts the import — by identity, since the platform ships a
    `DiscoveryModule` of its own and a name comparison would assert nothing.
    - @saasicat/spec@0.22.2
    - @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- 2348568: Stop warning about `globalFeatureGuard` at applications that have nothing open

    The warning added in 0.22.0 fired on the option alone, from `forRoot()` — where
    no controller exists yet, so it could only read the setting back. It therefore
    told every application using the per-controller guard pattern that it "serves
    unlicensed traffic", including the two that bind a guard on all of their
    annotated routes (22 of 22 and 18 of 18, counted). A warning that fires on a
    correct configuration is worse than none: it teaches people to scroll past
    warnings, including the ones that mean something.

    The question is now asked where it can be answered. `FeatureGuardCoverageCheck`
    runs after bootstrap, walks the controllers, and warns only about routes that
    carry `@RequireFeature` with no feature guard in front of them — naming each
    one. Silence means "checked, nothing open" rather than "did not look".

    A guard of your own that wraps `FeatureGuard`/`StaticFeatureGuard` is not
    recognised, and its routes are listed; the message says so. Naming a covered
    route costs a moment to verify, whereas staying silent about an open one is not
    recoverable.

- 854fb16: Recognise the platform's feature guards by marker rather than by class name

    `FeatureGuard` is a name any application might use for a guard of its own, and
    the coverage check added in 0.22.1 matched on it — so a same-named foreign
    guard silenced the warning while nothing enforced the entitlement. Both
    platform guards now carry a `Symbol.for` marker, which survives the duplicate
    class identity across CJS entry points that made name matching tempting in the
    first place.

    The check also treated controller helper methods as routes: a class-level
    `@RequireFeature` is inherited by all of them, so with guards bound per handler
    the helpers looked open while every real endpoint was covered. Only methods
    carrying Nest's route metadata are considered now.
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

- @saasicat/spec@0.22.0
- @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/spec@0.21.0
- @saasicat/types@0.21.0

## 0.20.0

### Minor Changes

- 6c0d40d: Make the error contract hold what it promises

    Breaking. A review of the error-code release found the contract stated more
    than the wire delivered.

    **`message` is now always present.** `PlatformErrorBody` declared it required,
    but 36 throw sites passed only `{ code }` — most of the registration funnel,
    every OTP failure. NestJS hands an object argument through verbatim, so those
    responses shipped without a message: a consumer typing the body read
    `undefined`, and `body.message.includes(...)` threw. A new `codedError(code,
params?)` derives the message from the shipped English catalogue, which also
    makes the fallback text identical to the shipped default by construction.

    **One params shape per code.** The same code carried different keys depending
    on which service threw it — `versionId` here, `bundleVersionId` there. Since a
    consumer's translation interpolates by key name, half the throw sites left the
    placeholder unfilled. `error-params-contract.test.js` now fails if a throw site
    omits a placeholder its template names, or if two sites disagree on a key.

    **`FEATURE_NOT_LICENSED` has one shape.** Both feature guards always emit the
    full `FeatureNotLicensedBody`; without a resolver `offers` is `[]` rather than
    absent, so a consumer can rely on the declared type. The code is now part of
    `PLATFORM_ERROR_CODES`, so an exhaustive switch covers it.

    **Renamed / split codes** — update any consumer that matches these strings:

    | before                                 | after                                                    |
    | -------------------------------------- | -------------------------------------------------------- |
    | `PLAN_VERSION_NOT_LIVE`                | `PLAN_VERSION_NOT_PUBLISHED` / `PLAN_VERSION_SUPERSEDED` |
    | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED`                  |
    | `SUBSCRIPTION_BUNDLE_NOT_CANCELED`     | `SUBSCRIPTION_BUNDLE_NOT_CANCELLED`                      |

    The split matters: one code covered both "was never published" and "already
    superseded", which a consumer could not tell apart.

    Also: `QUOTA_DIMENSION_UNKNOWN` is emitted instead of a bare `Error` (still
    500 — the dimension comes from the calling code, not from user input), the
    promo rate limiter sends the `retryAfterSeconds` its catalogue entry promises,
    and `requireSubscriptionPk` gained `SUBSCRIPTION_PK_MISSING` so a wiring error
    is distinguishable from a missing subscription.

    `reason` remains alongside `code` everywhere it existed.

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0
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

### Patch Changes

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0
    - @saasicat/spec@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/spec@0.18.1
- @saasicat/types@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/spec@0.18.0
- @saasicat/types@0.18.0

## 0.17.0

### Minor Changes

- cbd1737: Remove consumer domain vocabulary from the platform.

    `slugify()` fell back to the literal `'verein'` when a tenant name reduced to
    nothing, and that value reaches the tenant slug during registration — so a car
    dealership or a notes app could end up on a slug from someone else's business.
    The fallback is now `'tenant'`, the platform's own term. This changes observable
    output for degenerate input (empty, whitespace-only, or a name with no ASCII
    letters).

    Two placeholder texts in the shared catalogs carried club vocabulary as their
    example — the bundle description ("for active clubs") and the marketing feature
    label ("Membership management"). Both are now domain-neutral; apps that want
    their own wording set it via `i18n.overrides`.

    Doc comments that illustrate how an app supplies its _own_ vocabulary are kept
    deliberately: they document the extension point rather than leak a domain into
    the platform.

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0
    - @saasicat/spec@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/spec@0.16.0
- @saasicat/types@0.16.0

## 0.15.1

### Patch Changes

- de0fc7c: Require `js-yaml` 4.3.1 or newer to include the fix for quadratic complexity
  in `!!omap` duplicate-key detection.
    - @saasicat/spec@0.15.1
    - @saasicat/types@0.15.1

## 0.15.0

### Minor Changes

- c970673: `SaaSiCatModule.forRoot()` can now compose the complete standard NestJS
  platform stack, including setup, admin statistics, checkout offers and
  subscription contracts.

    Standard repositories are derived from the shared persistence bundle where
    possible, while application-specific providers, imports and guards remain
    configurable. The high-level module and its typed configuration helper are
    available from both `@saasicat/nest` and `@saasicat/nest/platform`; fine-grained
    modules remain available as escape hatches.

    Intentionally unauthenticated controllers now carry a shared public-route
    marker. Global authentication guards can detect it with the exported
    `isSaaSiCatPublicRoute` helper.

### Patch Changes

- @saasicat/spec@0.15.0
- @saasicat/types@0.15.0

## 0.14.0

### Minor Changes

- 76d99a5: Bundles booked after a contract was signed now take effect immediately.

    `EntitlementService.deriveLimits` used to return a contract's frozen
    `entitlementSnapshot` verbatim and never looked at the subscription's bundle
    bookings. A bundle bought after signing therefore granted nothing until
    something re-froze the contract — and where the optional `contractFreeze` hook
    was not configured, that never happened, silently.

    Active bookings are now merged on top of the contract limits (features as a set
    union, quotas additive with `-1` dominance, `plannedOnly` features filtered out
    as on the plan path). Bundles the contract already
    accounts for — via `originalBundleVersionIds` or a bundle line item — are
    skipped, so their quotas are not counted twice. The frozen plan part stays
    untouched.

    Also: `SubscriptionBundleSnapshot` carries the new `bundleVersionId` field (used
    for that de-duplication), and a bundle mutation without a configured
    `contractFreeze` hook logs one warning per process instead of returning
    silently.

### Patch Changes

- @saasicat/spec@0.14.0
- @saasicat/types@0.14.0

## 0.13.0

### Minor Changes

- 362a1a7: Thread the caller's `TransactionContext` through the entitlement lookup ports.

    `EntitlementService.deriveLimits` used to call
    `SubscriptionContractRepository.findActiveByTenantId`,
    `SubscriptionBundleRepository.listActiveBySubscription` and
    `BundleRepository.findVersionById` without the surrounding transaction. Inside
    `enforceLimit` — which holds the subscription row lock in an interactive
    transaction — every one of those lookups therefore had to draw an **extra**
    pool connection. Once N parallel `enforceLimit` calls occupy N pool slots, the
    lookups starve, nothing ever completes and all transactions expire
    (observed in production-like load: 10 parallel creations at the limit against
    the node-pg default pool of 10 → 0/10 succeed).

    The three port methods now accept an optional trailing `tx?: TransactionContext`
    (backward compatible — existing adapters keep working unchanged), the service
    forwards its transaction, and the Prisma adapters query on the transaction
    connection when it is provided.

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0
    - @saasicat/spec@0.13.0

## 0.12.1

### Patch Changes

- @saasicat/spec@0.12.1
- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/spec@0.12.0
- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [bded377]
    - @saasicat/spec@0.11.0
    - @saasicat/types@0.11.0

## 0.10.1

### Patch Changes

- 30ec6c6: Make the plan-catalog snapshot deterministic, and close two gaps in the
  shared-CJS-bundle work.

    - `PrismaPlanCatalogReadSink` ordered plans and feature entries by `sortOrder`
      alone — not a total order, so rows sharing a value came back in whatever
      order Postgres picked, and the live plan-version query had no ordering at
      all. The snapshot feeds the admin-manifest hash, so two processes reading
      identical data disagreed on the hash: `GET /admin/manifest` and a CLI
      `manifest hash` could never be compared. All three queries now carry a
      deterministic tiebreaker.
    - The public entry list is derived from `package.json` `exports` instead of
      being repeated in the tsup config, the stub generator and the identity test.
      A new entry that was added to only some of those copies kept its own
      duplicated CJS bundle — silently reintroducing the split class identities the
      shared bundle exists to prevent. The build now fails with an actionable
      message instead.
    - `globalFeatureGuard`'s documentation named the wrong class. The option
      unbinds `StaticFeatureGuard`, not `FeatureGuard` — they are different
      classes backed by different entitlement paths — and neither the JSDoc nor
      the migration guide said that a replacement guard MUST be bound. An app
      following the old wording would have left every `@RequireFeature` route
      serving unlicensed traffic.
    - @saasicat/spec@0.10.1
    - @saasicat/types@0.10.1

## 0.10.0

### Minor Changes

- 7145f07: Make the CommonJS entry points share one set of objects, and open the seams a
  consumer app needs when its shape does not match the standard stack's defaults.
  Each of these was previously unreachable, so an app that hit one had to abandon
  `SaaSiCatModule` entirely rather than configure around it.

    - **The CJS build now emits one shared bundle** (`dist/_entries.cjs`) with a
      thin re-export per entry, instead of a separate bundle per entry. esbuild
      cannot code-split CommonJS, so every shared module used to be copied into each
      entry — and since Nest resolves providers by class reference, two copies of a
      class are two different providers. Composing `SaaSiCatModule` (from
      `./platform`) with `SetupModule` (from the root entry) failed at boot with
      "MfaService is not available in the SetupModule module". ESM was already
      code-split and unaffected. Consumers no longer need to know which entry a
      class "really" comes from.
    - Exported DI tokens that were still plain `Symbol()` are now `Symbol.for`,
      per the rule in `CONTRIBUTING.md` — 42 of them, including
      `ADMIN_MANIFEST_CONFIG`. The catalog and billing `FEATURE_UI_REGISTRY_TOKEN`
      stay deliberately distinct and are now namespaced apart rather than colliding
      by accident.
    - `@saasicat/nest/platform` additionally re-exports the modules and services an
      app composes alongside `SaaSiCatModule` (`AdminModule`, `AdminManifestModule`,
      `AdminStatsModule`, `SetupModule`, `CheckoutOfferModule`,
      `SubscriptionContractModule` and their services), so the standard stack can be
      assembled from a single import path.
    - New `globalFeatureGuard` option. The module bound `StaticFeatureGuard` as a
      global `APP_GUARD` unconditionally. Nest runs every global guard before every
      controller-local one, so apps that authenticate in a controller-local guard
      got a 403 on all feature-gated routes before authentication had run. Set
      `false` to bind the guard behind your own auth guard instead. The quota
      interceptor stays global either way — interceptors run after all guards.
    - `includeManifestController` is now passed through to `AdminManifestModule`.
      Apps serving `GET /admin/manifest` from their own controller could not
      suppress the platform one, and two controllers on one path abort the boot with
      a duplicate-route error.
    - `prismaPersistence()` accepts a `bundle` option forwarded to both bundle
      repositories it builds. Because the bundle constructs them directly rather
      than through Nest DI, the repository's `@Optional()` options provider never
      applied, leaving `validityWindows` unreachable — bundle publishes then
      silently dropped `validFrom`.

### Patch Changes

- @saasicat/spec@0.10.0
- @saasicat/types@0.10.0

## 0.9.0

### Minor Changes

- b30a110: Add a high-level SaaSiCat standard stack that wires catalog, entitlements,
  tenant billing and subscription bundles from one persistence bundle. The
  Prisma bundle now includes the canonical catalog and tenant-billing adapters,
  including a reusable subscription usage mapper and standard Admin resource
  adapter. Tenant, user, audit and subscription controllers plus promo-code CRUD
  can now be enabled with two flags. The Vue client supplies the matching
  resource loaders and actions. Existing fine-grained modules and adapter
  overrides remain available.

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0
    - @saasicat/spec@0.9.0

## 0.8.0

### Minor Changes

- 1003a52: Remove the obsolete `PlanVersionsPage`, its standard navigation manifest key,
  and the synthetic client-side catalog snapshot projection. Plan lifecycle and
  per-plan version history remain in `PlansPage`; `MarketingCatalogPage` remains
  the separate marketing projection.

    Retain the reusable catalog timeline and diff components behind a presentation
    contract that can consume immutable Publication Archive / Catalog History
    snapshots from issues #30 and #35.

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/spec@0.8.0
    - @saasicat/types@0.8.0

## 0.7.0

### Minor Changes

- 05729ce: Add explicit, backwards-compatible Prisma schema profiles for semantic
  plan-key and normalized Plan UUID bindings, configurable catalog and
  entitlement delegates, opt-in PlanVersion and BundleVersion validity windows,
  and atomic tenant plan/PlanVersion writes including onboarding rollback.
  Atomic onboarding is exposed only through an explicit schema opt-in; pending
  PlanVersion acceptance now uses a compare-and-set guard, and active-version
  selection consistently puts legacy null validity dates last.
  Opt-in SubscriptionBundle booking counts let the shared subscription adapter
  preserve BundleVersion editability without requiring the junction table.
  Active subscription counts now derive their authoritative plan identity from
  PlanVersion and Plan, stay scoped to the requested project, and ignore drifted
  denormalized Subscription plan values. The configured
  `tenantSubscription.delegate` is now honored by every subscription ORM
  operation, including transactional reads; locked reads retain the canonical
  physical `subscriptions` table contract.

    Extend the executable persistence contract with semantic identity,
    plan-binding, validity-window, auto-succession, and transactional promo
    redemption rollback scenarios. Catalog lifecycle scenarios now take their
    project identity from the required contract `projectKey` option.

    Run the optional contract freeze after every successful onboarding plan
    change, regardless of whether the adapter uses atomic onboarding or the
    legacy sequential fallback.

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/spec@0.7.0
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

- Updated dependencies [98274fe]
- Updated dependencies [0c08fc3]
    - @saasicat/spec@0.6.0
    - @saasicat/types@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/spec@0.5.0
- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- 5802454: Three wiring bugs surfaced by booting the new `examples/notesapp` reference app (the existing tests only inspected `forRoot()` results without compiling them — a Nest DI boot-smoke test now guards this):

    - `SaasPlatformModule` no longer re-exports `ADMIN_MANIFEST_CONFIG` directly — exporting an imported module's token is an `UnknownExportException` at boot; the token still travels via the exported `AdminManifestModule`.
    - `LimitExceededFilter` now matches by the realm-safe `isLimitExceededError` guard (new export) and falls back to Nest's default handling via `BaseExceptionFilter`. The previous `@Catch(LimitExceededError)` never matched throws from other sub-bundles (tsup duplicates the class per entry), turning quota hits from `@EnforceQuota` into HTTP 500 instead of 402. Register it as an `APP_FILTER` provider.
    - `@saasicat/nest/testing` re-exports `StaticEntitlementService`, `StaticFeatureGuard`, `EnforceQuotaInterceptor` and the plan-resolver token: `moduleRef.get(X)` after `createSaasPlatformTestModule` only resolves when X comes from the same bundle entry.

    Docs: quickstart corrected (`policy: 'hardCap'` — `'hard'` never existed; quota responses are HTTP 402, not 429; auth guards must be registered globally BEFORE the platform module so `request.user` is populated for the feature guard/quota interceptor).
    - @saasicat/spec@0.4.0
    - @saasicat/types@0.4.0

## 0.3.0

### Minor Changes

- d758318: PostgreSQL-first, ORM-agnostic persistence: ship the complete Prisma golden path and make its semantics verifiable.

    - **`@saasicat/adapter-prisma`** (renamed from `@saasicat/prisma`, which is now deprecated): ships every previously missing adapter — `PrismaTransactionRunner`, `PrismaSubscriptionRepository` (row-locked `findByTenantIdLocked`), `PrismaPlanVersionRepository`, the three promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, `PrismaAuditAdapter` (now targeting the canonical `audit_logs` table incl. `actorTag`), `PrismaAuditQueryAdapter`, `PrismaAuditStatsAdapter`, `PrismaSuperAdminBootstrapAdapter`, `PrismaPlanCatalogReadSink`/`ImportSink` — plus the new `prismaPersistence({ client })` bundle factory.
    - **`@saasicat/types`**: new persistence bundle contract — `SaasicatPersistenceAdapter` with core/entitlement/promo slices, `PersistenceCapabilities` + `assertPersistenceCapabilities` (fail-fast `PersistenceCapabilityError`), `PersistenceProvider<T>`; `PasswordHasher` moved here from `@saasicat/nest/registration` (re-exported there).
    - **`@saasicat/nest`**: `SaasPlatformModule.forRoot({ persistence })` consumes adapter bundles (individual `adapters` entries still override field by field) and refuses to boot entitlement without transactions + pessimistic locking.
    - **`@saasicat/persistence-testing`** (new): the executable persistence contract — one node:test suite every adapter must pass against a real database (row-lock serialization, transaction rollback, exactly-once promo claims, unique redemption guard, tenant isolation, audit/MFA roundtrips). CI runs it for adapter-prisma against PostgreSQL 16.
    - **`@saasicat/spec`**: the data model is now normatively anchored in `docs/data-model.md` + `sql/constraints.postgres.sql`, with `sql/reference-schema.postgres.sql` generated from the prisma-fragments (drift-guarded in CI). Fragment fixes: `AuditLog.actorTag` column, new fragment `10-super-admin.prisma`, `FeatureCatalogEntry.core/requires/replaces/successorKey`, missing `BusinessTypeVersion↔Subscription` opposite relation.

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0
    - @saasicat/spec@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/spec@0.2.1
- @saasicat/types@0.2.1

## 0.2.0

### Minor Changes

- c94b1fe: Remove `quotaKeys` from `saas.yaml` — quota keys now have a single source of truth: the `@DefinesQuota` decorator in code, validated against the discovery snapshot.

    **Breaking:** `saas.yaml` files containing a `quotaKeys:` block fail schema validation (`additionalProperties: false`). Delete the block — the platform derives all quota dimensions from the registered `QuotaProvider` classes.

    - `plan-catalog.schema.json` / `admin-manifest.schema.json` / OpenAPI: `quotaKeys` removed from schema and `planCatalogSnapshot`.
    - `PlanCatalog.quotaKeys`, `PlanCatalogModule.forRoot({ quotaKeys })` and `buildPlanCatalogFromSnapshot` settings field removed.
    - `PlanChangePreviewService.limitsCheck` and `GET /billing/usage` iterate the union of quota keys from entitlement, target plan and usage snapshot instead of the catalog list.
    - `TenantBillingController` no longer injects the plan catalog.
    - `TenantPlanSection` derives the displayed quota keys as an ordered union across all plans and the tenant's effective limits (previously only the first plan's keys), so higher-tier-only quotas stay visible.

### Patch Changes

- Updated dependencies [db10ab9]
- Updated dependencies [c94b1fe]
    - @saasicat/spec@0.2.0
    - @saasicat/types@0.2.0
