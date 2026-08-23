# create-saasicat-admin

## 1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 3ebc363: **`saasicat schema apply` now appends the enums a fragment declares, above the models that use
  them.** It used to copy models only, so a fresh schema ended up with `Subscription.billingCycle`
  and no `BillingCycle` — twenty Prisma validation errors at quickstart step 3 for anyone who had
  not pasted the enums in by hand. An enum the schema already declares is left untouched, as models
  are. Found by installing the 1.0 candidate from npm into an empty project; the example app had
  carried the enums since before the command existed, so nothing in the repository saw the gap.

    **Every package with an exports map now exports `./package.json`.** Seven did not, and a bundler
    plugin, `vue-tsc` or pnpm reading the manifest got `ERR_PACKAGE_PATH_NOT_EXPORTED`.
    **`saasicat init` names two more things the generated wiring needs.** The `forRoot` block now
    carries `imports: [YourPrismaModule, YourAuthModule]` the way it carries `YourAuthGuard` — it does
    not compile until you name them — because `prismaPersistence({ client: PrismaService })` is
    resolved inside the platform module, which sees only what that list holds or what is `@Global`.
    Left out, the generated app compiled and stopped on its first boot with "Nest can't resolve
    dependencies of … (PrismaService)". And `init` now refuses a `tsconfig.json` whose
    `moduleResolution` is `node`: the files it writes import subpath exports, which only `node16`,
    `nodenext` or `bundler` resolve. The quickstart says so too.

    **`create-saasicat-admin` scaffolds an app that type-checks.** Its `platform-loaders.ts` still
    passed `getAuthToken` to `createPlatformLoaders`, an option the 1.0 line no longer has, so every
    fresh admin failed `vue-tsc` on its first run. The scaffolder's tests now type-check a scaffolded
    app against the `@saasicat/ui-vue` it was scaffolded for.

## 1.0.0-rc.1

## 1.0.0-rc.0

### Minor Changes

- 9449492: **Twelve admin primitives, and every hand-built copy of them is gone.**

    New in `@saasicat/ui-vue/ui/*.vue`:

    - `AdminBanner` — an inline notice, in one of four tones
    - `AdminErrorBanner` — the failure case of that. One prop, and it renders
      nothing when there is no error, so a page binds it unconditionally
    - `AdminEmptyState` — what a list shows when it has nothing to show
    - `AdminDialog` — the chrome under every dialog
    - `AdminFormDialog` — a dialog whose point is a write. Owns the submit
      lifecycle: disabled while pending, failure shown without closing
    - `AdminConfirmDialog` — a dialog that asks before something irreversible
    - `AdminToolbar` — the action row above a table that is not the hero
    - `AdminRowActions` — the per-row controls in a table's `row-actions` slot
    - `AdminField` / `AdminFieldGrid` — a labelled control, and the grid it sits in
    - `AdminStatusPill` — a status, as a word plus a tone

    `AdminStatusPill` is promoted out of a private directory where one page used
    it while nine other places rendered their own status display. Its `PillTone`
    type is exported from `@saasicat/ui-vue/vue`, along with `PROMO_STATUS_TONE` —
    the one status vocabulary shared across pages.

    **What this replaces.** Nineteen hand-written banners in six different colour
    recipes, nineteen raw `<q-dialog>` sites in seventeen files, five word-for-word
    copies of the same `errMsg()` helper, and the four pages that reached for
    `useQuasar()` because the confirm port had no consumer. All four numbers are now
    zero. Two dialogs keep their own submit handler on purpose: they route a failure
    to the MFA prompt or to themselves depending on the response reason, and a
    component that owns the error cannot make that split.

    **One behaviour fix rides along.** A fully redeemed promo code rendered red —
    both copies of the page's status-to-colour function fell through to `negative`
    for `EXHAUSTED`. The campaign that worked best looked like a defect. It is now
    muted.

    **Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`
    and is now `'en'`. It is also the fallback for `Intl`, so an app that names no
    locale now formats dates and currency the English way as well. German remains a
    complete, first-class catalog — an app that wants it passes
    `createSuperAdminApp({ i18n: { locale: 'de' } })`, and a missing English
    translation is still a compile error.

    **Also fixed:** dialogs teleport out of the page, so the package's page-wide
    `box-sizing: border-box` never reached them. Hand-built modals each carried
    their own reset; the shared dialog chrome now carries it once.

    ***

    **Two standard pages read their data themselves.** `PromoCodesPage` and
    `AuditPage` no longer take loader or submit props — they ask the platform's
    resource registry by name. `PromoCodesPage` drops `loadPromos`, `submitCreate`,
    `submitEdit` and `submitDelete`; `AuditPage` drops `loadAudit`. An app that
    rendered either with the standard wiring can delete that wiring; an app that
    needs one call diverted passes `:resources` instead of re-supplying all of them.

    **`useResource(key, override?)`** takes a per-page override now, layered over the
    app-wide one rather than replacing it — platform, then app, then instance. An app
    that wraps an operation app-wide keeps that wrapper when a single page is pointed
    somewhere else.

    **Fixed: the audit resource sent parameters the endpoint ignores.**
    `auditResource.list` spoke `AuditQuery` (`actorTag`, `from`, `to`, paginated) at
    `GET /admin/audit`, which accepts `actor`, `action`, `entity`, `since`, `limit`
    and answers with a bare array. `AuditQuery` belongs to `AuditQueryPort`, one
    layer below HTTP — the adapter translates. Filtering the audit list by actor
    would have returned an unfiltered list that looked filtered. Nothing consumed the
    descriptor yet, so no released version shipped the wrong request; it is corrected
    before the page reaches it.

    Two consequences for anyone who did use it: `AuditListFilter` is now
    `AdminAuditListFilter`, and `useResourceList('audit')` no longer compiles —
    the operation returns an array, not a page, so `audit` is not a list resource.
    Call `useResource('audit').list(filter)`.

    **`PromoRow` lost its `[extra: string]: unknown`.** It was there so rows arriving
    through a `loadPromos` prop could carry anything an app returned. The resource
    decides the shape now, and the index signature was what kept a typo from being
    distinguishable from a field the server had started sending.

### Patch Changes

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

## 0.27.0

### Minor Changes

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

## 0.26.1

## 0.26.0

### Minor Changes

- 01f963e: Ship the HTTP adapter every app was writing by hand

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

- b188c06: Refuse a project-scoped resource that has no project, at boot

    A shell configured without `endpoints.projectKey` bound the plan catalogue to an
    empty one, and nothing downstream objected. `?projectKey=` is a perfectly valid
    request: an admin API that filters on it answers for no project at all, so the
    catalogue rendered as an empty catalogue — no error, no empty-state hint, nothing
    saying the shell was misconfigured. The same context put `projectKey: ''` into a
    create body, where it finally failed validation, one operator action and one
    screen later than the mistake. `usePlans()` has refused this at construction from
    the start; a page reaching the same endpoints through the registry did not.

    `bindResource` now refuses it where the resource is bound — which is boot, for
    both `createResourceRegistry()` and `createSuperAdminApp()` — naming the option:

    ```text
    Resource "plans" is project-scoped, but the context it is bound to names no
    project. … Name the project this admin administers — `endpoints.projectKey` for
    createSuperAdminApp(), `context.projectKey` for createResourceRegistry().
    ```

    **Per descriptor, not per registry.** A descriptor declares `projectScoped`, and
    only those are refused. That is not a stylistic choice: of the four platform
    resources exactly one reads `ctx.projectKey`, so a demand made once for the whole
    registry would refuse an admin that lists tenants and reads the audit trail over
    a value those endpoints never send. `defineResource()` takes the declaration as
    a third argument, and a test drives every operation through a recording context
    and fails when a declaration and what the operations actually read disagree in
    either direction — so the flag cannot go stale as the roster grows.

    **What an app has to do:** name `projectKey` in the endpoints it hands
    `createSuperAdminApp()` if it also passes `http`. The scaffolded template now
    does, and `examples/notesapp/admin` — which had been running with an empty one —
    sets `projectKey: 'notesapp'`. An app that passes no `http` client gets no
    registry and needs no project.

## 0.25.0

## 0.24.2

## 0.24.1

## 0.24.0

### Patch Changes

- fe83513: Scaffolded apps now dedupe the peer dependencies in their Vite config.

    `createSuperAdminApp()` creates the router, the Pinia instance and the Quasar
    plugin; your own pages read them back with `useRoute()`, `useRouter()` and store
    hooks. Those APIs work by module identity, so two copies of a library do not
    share one — and because the UI package ships its pages as `.vue` source, its
    imports resolve relative to the package while yours resolve relative to your app.

    With both in the bundle, `inject` returns `undefined` and the first thing that
    touches it throws somewhere unrelated:

    ```text
    TypeError: Cannot read properties of undefined (reading 'params')
    ```

    The shell renders and the content area is blank. Pages that read no route params
    keep working, so it reads as one broken page rather than a broken wiring.

    Existing apps: add `resolve: { dedupe: ['vue', 'vue-router', 'pinia', 'quasar'] }`
    to your Vite config — see handbook §8.0.

## 0.23.0

### Minor Changes

- 4102659: Three token layers, one colour system, and a dark theme

    The admin UI shipped a token file **and** 643 literal colours, 198 `rgba()`
    literals and 23 font sizes. A reader could not tell which value was a decision
    and which was a guess, so every new page guessed again. Hex colours, `rgb()`
    and `hsl()` literals, named colours and raw font sizes are all at zero now, and
    the audit (`pnpm run tokens`) keeps them there. What it still reports is 56
    colours built in script (inline `:style` bindings) and 70 distinct pixel values
    — known debt, held under a ratchet so it can only shrink.

    **The layers.** `@saasicat/ui-vue/theme.css` is the new entry
    (`./sa-theme.css` still works and is removed in 1.0):

    - **L1 primitives** — the palette and the scales. Reference nothing.
    - **L2 roles** — `--sa-color-fg-muted`, `--sa-color-negative-surface`, … The
      only layer that differs between light and dark.
    - **L3 components** — the shell chrome, reading roles.

    A component asks for a role, never for a value. That single rule is what makes
    the dark theme one file instead of sixty-two, and it is enforced: primitives may
    reference nothing, roles may hold no literal, and nothing outside the role layer
    may name a palette colour.

    **One brand, not two.** `--sa-color-accent` reads Quasar's `--q-primary`, which
    comes from your `$primary`. Set it once and the hero, the buttons, the focus
    ring, the tinted surfaces, Quasar's own components and the tenant-facing pages
    all follow. Previously the platform painted `#3f6bff` while a scaffolded app
    painted `#1e40af`, in the same screen, because each had its own source of truth.
    To change the brand at runtime, write to the root:
    `setCssVar('primary', value, document.documentElement)`. The third argument is
    not optional — Quasar's default target is `<body>`, and the accent role is
    computed on `:root`, which cannot see a value declared below it.

    **Dark mode.** `createSuperAdminApp({ theme: { scheme: 'system' } })`, plus
    `useSaTheme()` anywhere. `'system'` follows the operating system live. Quasar's
    own `$q.dark.set(true)` flips the platform as well, so an app that already has a
    dark switch needs nothing from this. Verified on all nineteen standard pages by
    a contrast check rather than by a second set of screenshots: the canvas must get
    darker, most text colours must move, and nothing may fall under 3:1 in either
    theme.

    The stylesheet itself does **not** answer `prefers-color-scheme`, deliberately.
    It paints the platform's surfaces while Quasar paints its own cards, dialogs and
    steppers, and Quasar follows only `body--dark` — so a media query there moves
    one half of the screen and leaves the other. Following the OS lives in
    `createSaTheme`, where the bridge moves both. An app that embeds tenant pages
    and wants OS-following dark opts in with
    `bindSaThemeToDocument(createSaTheme())`.

    **Also:** the spacing, type, radius, shadow, z-index and breakpoint scales;
    `--sa-radius-pill`; and a fix for `--sa-color-fg-subtle`, which was reading
    2.56:1 on a white card — captions and price units were decoration rather than
    information.

    **Teleported dialogs and menus are themed too.** Quasar appends every dialog,
    menu and tooltip to `<body>`, outside the `.sa-page` wrapper — so the theme
    never reached them, and dialog cards kept Quasar's grey surface, its 4px radius
    and its transparent outlined inputs, while every dropdown opened a `#1d1d1d`
    panel over a slate page. `createSuperAdminApp` now marks those portals
    (`config.globalNodes.class`, appended to yours if you set one) and the theme
    addresses `.sa-page` and `.sa-portal` alike.

    Be aware of the scope: `globalNodes` is document-wide, not per-owner. Every
    portal opened inside an app bootstrapped by `createSuperAdminApp` is marked —
    including a dialog opened by a page you contribute into the admin shell. That is
    intended, because a page mounted in the shell is admin UI, and `.sa-page`
    already repaints its cards. An app that does not call `createSuperAdminApp` is
    untouched. Tooltips keep Quasar's own colours.

    **Quieter row actions.** Table row icons were three different recipes across
    five pages — two painted `primary`, two carried a per-action colour, one had its
    own class — so one table read as a row of traffic lights beside another's row of
    greys. They share `.sa-icon-btn` now: muted by default, colour reserved for the
    destructive action. Rows of actions are chrome, not announcements. And the plan
    list stretches its cells to a common height, so the hover band no longer
    notches where a column happens to be shorter.

    ## What you may need to do

    **If you embed `@saasicat/ui-vue/pages-tenant/*` in your own app**, add one
    import to that app's entry:

    ```ts
    import '@saasicat/ui-vue/theme.css';
    ```

    Those pages used to carry their own colours and their own dark theme; they read
    the shared roles now, which is what lets one `$primary` brand both surfaces. The
    stylesheet is safe to load beside your own design — every selector in it is
    either a `.sa-`-prefixed class of ours or sits under `.sa-page`, and there is no
    bare element rule.

    **If you override an `--sa-*` variable in your own CSS**, reading still works;
    setting no longer does. The old names are aliases of the roles now. Set
    `$primary` for the brand — that is the whole answer for the common case.

    To override a **role**, write both of its values, on the same selectors the
    theme uses:

    ```css
    :root {
        --sa-color-negative: #a3122b;
    }
    [data-sa-theme='dark'],
    body.body--dark {
        --sa-color-negative: #ff6b81;
    }
    ```

    A role has two values, so an override has two. `:root` alone is not enough and
    fails differently per trigger — under Quasar's `body--dark` the roles are
    declared on `<body>`, and an inherited `:root` value never reaches past that.
    See the design guide.

    **Expect a visual change.** Colours that were three near-identical greens
    collapse to one success colour, the same for the browns and the reds; the type
    scale snaps 23 sizes onto nine; and the admin adopts your `$primary` instead of
    the platform's blue.

## 0.22.2

## 0.22.1

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.1

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.1

## 0.10.0

## 0.9.0

### Minor Changes

- 6524f04: Require Quasar >= 2.22.0. Earlier releases are affected by the prototype
  pollution in Quasar's `extend()` utility (GHSA-3r53-75j5-3g7j), so the
  `@saasicat/ui-vue` peer range and the generated admin scaffold now start at the
  patched version. Consumers still on Quasar 2.18–2.21 need to upgrade.

## 0.8.0

## 0.7.0

## 0.6.0

### Minor Changes

- 1af2364: Localize the SuperAdmin UI: German (reference) and English message catalogs.

    Every hard-coded German string in the standard pages, components and composables
    now comes from a typed catalog. There is no `vue-i18n` dependency — the catalogs
    are plain typed objects, so a missing key is a compile error rather than a gap at
    runtime. German stays the default; nothing changes for existing apps that do not
    opt in.

    **Choosing the language** via `createSuperAdminApp()`:

    ```ts
    createSuperAdminApp({
        // …
        i18n: { locale: 'en' },
    });
    ```

    Pass a `Ref<SaLocale>` instead of a literal to switch at runtime (the handle
    exposes the same context as `handle.i18n`), and `i18n.overrides` to replace
    individual strings per locale without forking a page. Components read the
    catalog via `useSaMessages('<namespace>')` / `useSuperAdminI18n()`; outside a
    shell both fall back to German, so isolated mounts and unit tests need no setup.

    Switching the locale also re-renders sidebar labels and drawer sections, and
    moves date, number and currency formatting plus search/sort collation to the
    active locale.

    **Breaking (0.x minor):**

    - `DEFAULT_SECTION_ORDER` → `defaultSectionOrder(locale?)`. The drawer section
      names are locale-dependent, so a constant could not stay correct.

        ```diff
        -import { DEFAULT_SECTION_ORDER } from '@saasicat/ui-vue';
        +import { defaultSectionOrder } from '@saasicat/ui-vue';
        -buildSidebar(routes, DEFAULT_SECTION_ORDER);
        +buildSidebar(routes, defaultSectionOrder('en'));
        ```

    - `DEFAULT_PILOT_COPY` removed — the pilot dialogs resolve their defaults from
      the catalog. The `PilotCopy` type stays as the consumer override API.
    - Label-returning helpers reachable through the `./pages/*` and `./components/*`
      subpath exports take a trailing `locale` parameter and dropped their `…De`
      suffix: `formatDateDe`/`formatTsDe`/`formatRelativeDe` →
      `formatDate`/`formatTimestamp`/`formatRelative`, `BUNDLE_STATUS_META` →
      `bundleStatusMeta(status, locale)`, `STATUS_META` →
      `statusLabel(status, locale)` / `statusHint(status, locale)`.
    - Developer-facing error messages (missing `endpoint`, unregistered action
      handlers, integration bugs) are now English. They target integrators, not end
      users, so they are deliberately not translatable — update any test that
      asserts on the German wording.

    **New:**

    - `@saasicat/ui-vue/client` exports the i18n core: `SaLocale`, `SA_MESSAGES`,
      `resolveMessages`, `formatMessage`, `formatCurrency` and `defineMessages`.
    - `formatCurrency(amount, locale)` replaces nine copies of the same
      German-formatted euro helper. Whole amounts keep rendering without decimals
      (`29 €`), as before.
    - Tenant-facing pages (`@saasicat/ui-vue/pages-tenant/*`) keep their prop-based
      `TenantPlanSectionI18n` map but now ship an English default alongside the
      German one, selected by `defaultTenantPlanSectionI18n(locale)`.

## 0.5.0

### Minor Changes

- 6c28b77: Layer the SuperAdmin UI package: framework-free client core, Quasar-free main entry, dedicated Quasar entry.

    **Breaking (0.x minor):** `createSuperAdminApp()`, `CreateSuperAdminAppOptions` and `SuperAdminAppHandle` moved from the main entry to `@saasicat/ui-vue/quasar`:

    ```diff
    -import { createSuperAdminApp } from '@saasicat/ui-vue';
    +import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
    ```

    Everything else keeps its import path — injection keys, shell option types and `buildNavigationGuard` now live in the Vue layer and stay exported from the main entry. The scaffolder template already uses the new path.

    New:

    - `@saasicat/ui-vue/client` — the framework-free core (BootLoader, ManifestLoader with ETag cache, nav builder, action registry, batch column fetcher, HTTP contract) as its own entry with zero Vue/Pinia/Quasar imports.
    - The main entry no longer executes any `quasar` import at module load — Quasar is now a truly optional peer dependency. (`pinia`/`vue-router` are still loaded by the main entry, unchanged, for the store factory and `ProjectPageHost`.)
    - UI notify port: standard pages emit toasts via the injected `UiNotify` port (`SUPER_ADMIN_NOTIFY_KEY`) instead of calling `$q.notify` directly. `createSuperAdminApp()` provides a Quasar-backed default (same behavior as before); override it with `createSuperAdminApp({ notify })`. Without a bootstrap the pages fall back to Quasar `Notify`.
    - Layer boundaries (client ← vue ← quasar/SFCs) are enforced via ESLint `no-restricted-imports` in CI.

    Scaffolder fixes (pre-existing bugs surfaced by an end-to-end build of the scaffolded app):

    - `main.ts` template passed `manifestGuard: { errorRoute }` without the required `ensureLoaded` — the scaffolded app did not compile. The template now wires the documented pattern: `services/platform-loaders.ts` (`createPlatformLoaders`) + `stores/manifest.ts` (`createManifestStore`) feed the manifest guard.
    - `vite.config.ts` template passed `sassVariables` as a plain relative path, which current sass versions resolve against the importing file inside `node_modules/quasar` — the production build failed. Now passed as an absolute `fileURLToPath` URL.

## 0.4.0

## 0.3.0

## 0.2.1

### Patch Changes

- 41000d3: Fix the scaffolder doing nothing when run via `npm create` / `npx`.

    The entry-point guard compared `import.meta.url` against `` `file://${process.argv[1]}` ``. Package managers expose the bin through a symlink in `node_modules/.bin/`, so under `npm create saasicat-admin` the invoked path and the module path differ, the comparison failed, and `main()` never ran — the command exited 0 without writing a single file. Published `0.2.0` is affected.

    The guard now compares real paths via `realpathSync`, which resolves the bin symlink. A regression test invokes the bin through a symlink the way npx does, and fails against the old guard.

## 0.2.0

### Patch Changes

- db10ab9: Fix scaffolded projects pinning a platform version that never gets published.

    `templates/package.json.tpl` hardcoded `@saasicat/types` and `@saasicat/ui-vue` at `^0.1.0`. Because caret pins the minor for `0.x` versions, `^0.1.0` resolves to `>=0.1.0 <0.2.0` and would not match the published `0.2.0` — every scaffolded project would fail to install. The template now uses a `__PLATFORM_VERSION__` token that the scaffolder fills from its own `package.json` version, so the pin tracks each lockstep release automatically.

    Also: ship `cli-conventions.md` in `@saasicat/spec` (the `@saasicat/cli` README links to it), point package README links at absolute GitHub URLs so they resolve on npm, and translate the scaffolder's CLI output to English.
