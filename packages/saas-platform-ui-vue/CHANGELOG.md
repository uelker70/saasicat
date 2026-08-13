# @saasicat/ui-vue

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

### Patch Changes

- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- @saasicat/types@0.22.1

## 0.22.0

### Minor Changes

- 9dc78b3: Give statistics one tile and sections one surface

    Seven tile implementations existed across the admin pages. Two of them —
    `sa-discovery__kpi` and `sa-bundles__kpi` — were byte identical. Three lived in
    unscoped page-level `<style>` blocks, which is the construction that produced
    the `sa-bundles__head` leak. There was no test on any of them.

    `AdminStatistics` and `AdminKpi` replace all seven:

    ```vue
    <AdminStatistics :columns="4">
      <AdminKpi label="Live" :value="liveCount" sub="published" tone="positive" />
    </AdminStatistics>
    ```

    `action` decides interactivity: with one the tile is a `<button>` carrying
    `aria-pressed`, without one a `<div>`. The three filter strips never announced
    their selected state before. `emphasis` keeps the one difference that was
    real — filter pills colour the number, discovery and draft tiles tint the whole
    tile, because there the colour is the statement. Two tiles set that tint with
    inline `style` and were immune to theming; they use the tone now.

    **Surfaces moved one level down.** `.sa-page` was the only thing painting the
    canvas, so a page could not be transparent. The canvas now sits on the layout —
    covering the gutters beside `max-width: 1600px` too — and sections carry the
    surface, rounded, with a head that echoes the hero one shade lighter. Eight
    sections that also carried `.sa-card` painted twice; the card is gone from them,
    since a section is one.

    **Breaking for CSS overrides.** `.sa-stat*` is gone (use `AdminKpi`), and
    `components/KpiCard.vue` is deleted — it had no importer in this repo or in
    either known consumer. An app that restyled `.sa-stat__num` should move to
    `.sa-kpi__value`.

    Five radius tokens (`--sa-radius-hero|section|card|head|tile`) replace the
    scattered literals; `--sa-radius-tile` is the single declaration requirement
    every tile resolves to. `--sa-bg-surface-2` names the `#f8fafc` inset grey.

    The plans page finally has a hero subtitle.

    **`components/plan-cockpit/` is deleted** — eight files, 1745 lines. It is an
    earlier implementation of the plan drill-in that `plan-detail/` superseded:
    `PlansPage` renders `PlanDetail` for `mode === 'cockpit'`, and nothing anywhere
    imports `PlanCockpit`. Like `KpiCard.vue` it was reachable through the
    `./components/*` subpath, so it belongs in this note. The two `planDetail`
    message keys only it consumed (`kpis.noDraft`, `kpis.createNewDraft`) go with
    it.

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

- @saasicat/types@0.22.0

## 0.21.0

### Minor Changes

- 3d29936: Make the admin page structure a component contract

    The repo had already tried to hold the admin pages to one page structure, as a
    CSS naming convention: `sa-theme.css` asked pages to use `.sa-page-head`
    "instead of creating their own BEM variants". Of the eighteen pages, seven
    did. Four copied the header into their own BEM variant, four pushed it into a
    sub-component, and one shipped its title in a `<div>` with no heading element
    at all. `.sa-toolbar` had no users anywhere. A class name is advice, and advice
    does not hold a structure together.

    The structure is now three components in `components/admin-page/`, and the part
    that makes it a contract is that `title` is a required prop: a page cannot
    forget to instantiate `AdminHero` the way it could forget to add a class,
    because `vue-tsc` rejects it.

    ```vue
    <AdminPage>
      <AdminHero title="Plans & versions" subtitle="…">
        <template #actions><q-btn … /></template>
      </AdminHero>
      <AdminSection title="Active plans"> … </AdminSection>
    </AdminPage>
    ```

    `AdminHero` renders the page's only `<h1>`; `AdminSection` renders a
    `<section>` whose `aria-labelledby` points at its own `<h2>`. The wiring is the
    reason the section is a component: an unnamed `<section>` is not a landmark at
    all, and naming one by hand needs an id unique per instance — the step
    hand-written markup forgets.

    **`<main>` now exists, once.** No page rendered one, and `AdminLayout` wrapped
    the router view in a plain `<div>`, so the admin UI had no main landmark.
    `PlansPage` was the sole exception via `<q-page>`, which renders `<main>`
    itself — so moving the landmark into the layout would have nested one `<main>`
    inside another. The layout owns it now and `PlansPage` no longer uses `QPage`.

    **Breaking for CSS overrides: `.sa-toolbar` and `.sa-toolbar__search` are
    gone.** They had no users in this repo or in either known consumer. `.sa-page`
    and `.sa-section*` are new, and `.sa-page-head*` is unchanged — the classes
    stay unscoped so a consumer app can still restyle `.sa-page-head__title` from
    its own CSS.

    Page props, emits and slots are unchanged, so wrappers around the standard
    pages keep working untouched.

    **Two collisions fixed.** `.sa-bundles__head` / `__title` / `__head-actions`
    were defined in `BundlesPage`'s unscoped `<style>` but appeared nowhere in its
    own template — they styled its child header, and their only other effect was
    leaking onto `plans-page/PlanBundleOverview`, which reuses the same class
    names and got `display: flex` plus `justify-content: space-between` it never
    asked for. The rules are gone with the markup they styled.
    `MarketingCatalogPage` was the second: `mc-` is now `sa-marketing-`, and
    `plan-list/PlanList`'s `pl-` is `sa-plan-list-`, so the admin surface has one
    prefix again.

    **Also.** The first-run setup wizard's title is an `<h1>` instead of a `<div>`.
    The landing-page preview inside the marketing catalog no longer uses `<h1>` for
    its mock-up hero — assistive technology cannot tell a mock-up from the document
    around it. `bundles-page/BundlesHeader.vue` is now `BundlesToolbar.vue` (it no
    longer renders a header) and `discovery-page/DiscoveryHeader.vue` is gone,
    absorbed into the page's hero. Neither was imported outside this package.

    `tests-component/admin-page-shell.test.ts` holds the line: it mounts the
    components and then reads every page source, failing on a hand-written
    `.sa-page-head`, a stray `<h1>`, a `<main>` or a `QPage`.

### Patch Changes

- @saasicat/types@0.21.0

## 0.20.0

### Patch Changes

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

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0

## 0.19.0

### Patch Changes

- edfbdfe: Ship default error texts in English and German

    An error body carries a code and an English developer message. That leaves a
    consumer two bad options: show English to end users, or translate 128 strings
    before showing anything. For the 21 codes thrown as a bare `{ code }` —
    most of the registration funnel, including every OTP failure — there is no
    message at all, so the code itself was the only thing to display.

    `ERROR_MESSAGES_EN` and `ERROR_MESSAGES_DE` now ship a text per code, and
    `resolveErrorMessage` renders one: consumer override first, then the shipped
    default, then the `message` from the body, and only then the bare code. Since
    every coded exception carries a message, that last step is unreachable in
    practice — a consumer that has not yet translated a new code shows English
    prose, never `PLAN_VERSION_NOT_LIVE`.

    The English texts are derived from the messages the backend actually sends, so
    the shipped default cannot drift from the real one. Placeholders read `params`
    first and the remaining body fields second, so a value already on the wire is
    not duplicated into `params` just to be interpolated.

    `error-messages.test.js` fails if any code lacks a text in any shipped locale,
    or if two locales interpolate different values for the same code.

    `formatMessage` in `@saasicat/ui-vue` now delegates to the same implementation
    instead of keeping a byte-identical copy.

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0

## 0.18.1

### Patch Changes

- 2c487b2: PilotEditDialog now uses the same class names as PilotCreateDialog. The styles
  are scoped, so the rename has no effect on consumers — it only makes visible
  that both dialogs draw the same building blocks.
- 2c487b2: The pilot dialogs now share their building blocks through one stylesheet
  instead of two identical copies. The emitted CSS is unchanged.
- 2c487b2: The promo-code dialogs now share their form body through one internal
  component. Create and edit had kept byte-identical copies of it. The public
  surface of both dialogs — props, emits, class names — is unchanged.
    - @saasicat/types@0.18.1

## 0.18.0

### Minor Changes

- ccdd7b1: Let every string follow an app-supplied language. A handful of helper modules
  still indexed the built-in catalogs by locale code — discovery status labels and
  hints, review actions, relative dates, bundle status. An app that added French
  got a French shell with 34 strings stranded in the fallback language, and
  `i18n.overrides` never reached them either, for the same reason the sidebar
  missed them before 0.17.0.

    They take the resolved catalog slice now, the way `buildRoutes()` takes `nav`:

    ```ts
    statusLabel(status, msg); // was: statusLabel(status, locale)
    formatRelative(iso, planVersions); // was: formatRelative(iso, locale)
    bundleStatusMeta(status, bundles); // was: bundleStatusMeta(status, locale)
    i18nFieldLabel(field, discovery, common); // was: i18nFieldLabel(field, locale)
    ```

    Breaking for anyone calling those four directly; the platform pages are updated.
    `builtinLocaleOf()` is gone with them — it existed only to keep those lookups
    from crashing on a locale they had no entry for.

### Patch Changes

- @saasicat/types@0.18.0

## 0.17.0

### Minor Changes

- 9ecbbff: Hand the language set to the app. The platform ships German and English and
  stops there — which of them an app offers, and which languages it adds, is now
  its own decision instead of a platform release.

    - `i18n.locales` narrows the offered set. A single entry hides the switcher, and
      the starting locale follows the selection, so an English-only app no longer
      starts in German. A stored pick for a language the app dropped is ignored.
    - `i18n.additionalLocales` adds languages the platform does not ship, each with
      its switcher label, `Intl` tag and a deep-partial catalog. Untranslated keys
      fall back to `basedOn` (default `'en'`), so a translation is usable from its
      first key onwards.
    - `i18n.storageKeyPrefix` separates apps that share one origin, mirroring
      `createPlatformLoaders`.

    Two defects surfaced on the way. `buildRoutes()` read the built-in catalogs by
    locale code, so `i18n.overrides` never reached the sidebar and an app-supplied
    language would have crashed it; it now takes the resolved `nav` catalog, which
    `AdminLayout` passes. And an active locale the catalog cannot render falls back
    instead of blanking the shell.

    Breaking: `SaLocale` is now an open string type — the two the platform ships are
    `SaBuiltinLocale`, and the guard `isSaLocale` is `isSaBuiltinLocale`. Catalog
    maps (`SA_MESSAGES`, `SA_INTL_LOCALES`, `SA_LOCALE_LABELS`) are keyed by
    `SaBuiltinLocale`.

    Known gap: a few helper modules still index the built-in catalogs directly
    (discovery status labels, relative dates, bundle status), so those strings stay
    in the fallback language for an app-supplied locale. Everything reached through
    `useSaMessages` translates fully.

### Patch Changes

- 4419016: Stop a partial boot response from taking the login card down. The card read
  `boot.project.displayName` behind an optional chain that only guarded `boot`, so
  a payload without `project` threw inside a computed and blanked the page on the
  next render — which the language switcher made easy to trigger.

    The brand projection now lives in `resolveLoginBranding()` / `isProductionBoot()`
    in the client layer, guarded and unit-tested, instead of in the SFC where it
    could not be reached by a test.

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

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0

## 0.16.0

### Minor Changes

- f734b71: Add a language switcher to the SuperAdmin shell. The `AdminLayout` header and
  the login page (first-run setup wizard included) now render a `LocaleSwitcher`
  that lists every locale in `SA_LOCALES` by its own name, so users reach the
  English catalog without an app-side control. The pick is persisted under the
  `sa:locale` key and outranks the `i18n.locale` option on the next visit;
  `i18n.persist: false` or an app-supplied `Ref` keeps the locale under app
  control as before.
- 2ed46a4: Harden the language switcher and the storage it uses.

    `defaultKvStore()` no longer lets a browser take the app down: reading
    `globalThis.localStorage` throws `SecurityError` when site data is blocked (a
    sandboxed iframe, cookie blocking), and `typeof` evaluates that getter rather
    than guarding it. Since the locale persistence put storage on the mandatory
    boot path of `createSuperAdminApp()`, that throw meant a blank admin page.
    Access and every read/write are now guarded, so persistence degrades to a no-op
    instead — which also covers `QuotaExceededError` in Safari's private mode for
    the manifest ETag cache.

    The switcher gained an off switch: `i18n.switcher: false` for deployments that
    ship a single language. A readonly `locale` ref (typically a `computed`)
    disables it automatically — TypeScript accepts one because it ignores
    `readonly` in assignability checks, and writing to it would fail silently.

    On the login and first-run cards the switcher now sits inside the card instead
    of floating above the page, where it collided with the centered card on short
    viewports. The provider-less fallback context no longer persists, so it cannot
    make test outcomes depend on their order.

### Patch Changes

- 02ff350: Show the language switcher unless it is explicitly disabled. The injection key
  is a `Symbol.for`, so an i18n context created by an older copy of the package
  resolves in the current `LocaleSwitcher` — and that context carries no
  `switcherEnabled` field. Reading the missing field as "disabled" made every
  switcher disappear after such an upgrade with nothing logged anywhere, so only
  an explicit `false` hides it now.
    - @saasicat/types@0.16.0

## 0.15.1

### Patch Changes

- @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0

## 0.12.1

### Patch Changes

- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- @saasicat/types@0.11.0

## 0.10.1

### Patch Changes

- @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

### Minor Changes

- 6524f04: Require Quasar >= 2.22.0. Earlier releases are affected by the prototype
  pollution in Quasar's `extend()` utility (GHSA-3r53-75j5-3g7j), so the
  `@saasicat/ui-vue` peer range and the generated admin scaffold now start at the
  patched version. Consumers still on Quasar 2.18–2.21 need to upgrade.
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
    - @saasicat/types@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.
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

### Patch Changes

- Updated dependencies [0c08fc3]
    - @saasicat/types@0.6.0

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

### Patch Changes

- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- @saasicat/types@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0

## 0.2.1

### Patch Changes

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

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [c94b1fe]
    - @saasicat/types@0.2.0
