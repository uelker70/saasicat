# @saasicat/ui-vue

## What this is

Vue 3 components + composables for the SuperAdmin UI shell. Provides the
boot loader, manifest loader (ETag cache), nav builder, action registry,
standard pages (Dashboard, Tenants, Plans, Discovery, …) and the tenant
self-service building blocks (`FeatureGate`, `useTenantManifest`,
`PlanChangeWizard`).

Peer dependencies: `vue` (required); `vue-router` and `pinia` (optional — see
the layers below for what actually needs them). **Not `quasar`**: the components
are built and carry it as a dependency of this package, so you install
`@saasicat/ui-vue` and nothing else — no `@quasar/vite-plugin`, no Sass
([ADR 0011](../../docs/explanation/adr/0011-admin-ui-bundles-quasar.md)).

Three stylesheet imports, once, in your entry:

```ts
import '@saasicat/ui-vue/quasar.css'; // the framework's own reset
import '@saasicat/ui-vue/icons.css'; // the icon font the components render
import '@saasicat/ui-vue/theme.css'; // the design tokens
import '@saasicat/ui-vue/style.css'; // the components' own styles
```

Quasar's stylesheet restyles `html`, `body` and typography — 76 computed
properties across every element of a page that styles itself. That is why it is
an import you write rather than one the package hides inside its bundle.

## What this is not

Not a component library to pick from. It is the SuperAdmin application's
inside: complete pages, the shell around them, the theme they read and the
data layer beneath them. Taking one primitive out of context is possible and
rarely what you want.

Not a design system for your product, either. The `Admin*` roster exists for
admin surfaces; everything else is Quasar, styled through the theme.

Compiled, since 1.0: your bundler loads `dist/`. Your **type**checker still
reads the `.vue` sources through the `types` condition, which is why that source
stays within ES2021 and why the floor below still applies.

## Entry points

The package is layered so that each entry only loads what it names. Lower
layers never import upward, and ESLint enforces it — the reasoning is in
[ADR 0004](../../docs/explanation/adr/0004-ui-vue-layer-boundaries.md).

| Entry                 | Source          | May import                    | When you take it                                                                                                                                                                     |
| --------------------- | --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./client`            | `src/client/`   | `@saasicat/core` only         | Framework-free: loaders, nav builder, action registry, the resource descriptors, `HttpClient`/`KvStore` with their `fetch` and axios adapters, `AdminError`. Usable from plain Node. |
| `.`                   | `src/vue/`      | Vue, `vue-router`, Pinia      | Composables, router guards, injection keys, `createAdminRoutes`, the store factory. No Quasar.                                                                                       |
| `./quasar`            | `src/quasar/`   | everything above, plus Quasar | `createSuperAdminApp()` and the Quasar implementations of the notify and confirm ports.                                                                                              |
| `./pages`             | `src/pages/`    | everything                    | `standardAdminChildren()` — the platform's own screens as route children.                                                                                                            |
| `./pages/*.vue`       | `src/pages/`    | everything                    | One standard page, when you mount it yourself.                                                                                                                                       |
| `./layouts/*.vue`     | `src/layouts/`  | everything                    | `AdminLayout` — the shell around the pages.                                                                                                                                          |
| `./auth/*.vue`        | `src/auth/`     | everything                    | The login screen and the first-run setup wizard.                                                                                                                                     |
| `./ui/*.vue`          | `src/ui/`       | everything                    | The `Admin*` primitives, when you build a page of your own.                                                                                                                          |
| `./theme.css`         | `src/ui/theme/` | —                             | The design tokens. Import it once; without it the pages render unstyled.                                                                                                             |
| `./style.css`         | built           | —                             | The components' own styles, extracted into one file. Import it once, beside the theme.                                                                                               |
| `./quasar.css`        | built           | —                             | Quasar's stylesheet, shipped so you do not install Quasar to get it. It restyles `html`, `body` and typography — which is why it stays an import you write rather than one we hide.  |
| `./icons.css`         | built           | —                             | The Material icon font the components render through `q-icon`. Without it every icon renders as its ligature name.                                                                   |
| `./theme/*`           | `src/ui/theme/` | —                             | The individual token layers, for a consumer that overrides roles.                                                                                                                    |
| `./theme/breakpoints` | `src/ui/theme/` | —                             | The five breakpoint values, for a build that needs them in JavaScript.                                                                                                               |
| `./vue`               | `src/vue/`      | Vue, `vue-router`, Pinia      | The Vue layer alone, without the client re-exports.                                                                                                                                  |
| `./testing/*`         | `src/testing/`  | everything                    | Fixtures for component and end-to-end tests against the pages.                                                                                                                       |

The four component subpaths keep their `.vue` specifier and resolve two ways:
your **type**checker reads the source, your **bundler** loads the build. That
split is what removed Quasar from your `package.json` without changing a single
import of yours —
[ADR 0011](../../docs/explanation/adr/0011-admin-ui-bundles-quasar.md). The
source is still yours to compile for types, so the floor below still holds
([ADR 0005](../../docs/explanation/adr/0005-ship-sfc-source-not-dist.md)).

### The shipped source has a language floor

The last row is not a build output: those subpaths hand out `.vue` and `.ts`
straight from `src/`, so **your** `tsconfig` compiles them, not ours. Anything
they reach — which includes `src/client/` and `src/vue/` — therefore has to
compile under the oldest language level a consumer uses.

That floor is **ES2021** (`lib: ES2021, DOM`), with **TypeScript 5.0** as the
minimum compiler. The language level is checked rather than promised:
`pnpm --filter @saasicat/ui-vue test:shipped-source` compiles the closure
reachable from every source-shipping subpath at that level, with
`isolatedModules`, `useDefineForClassFields` and `strictPropertyInitialization`
set the way a Vite app sets them, and CI runs it. The directories come from the export map, so a new source subpath
is covered the day it is added. The compiler version is not checked — `satisfies`
in the shipped source needs 4.9 or newer whatever `lib` says, and testing that
would mean installing old compilers.

Practically this rules out a handful of ES2022 conveniences in shipped code —
`new Error(msg, { cause })` and `Object.hasOwn` are the two that have come up.
Use `attachCause()` from `src/client/attach-cause.ts` and
`Object.prototype.hasOwnProperty.call()` instead. Code that only ever runs from
`dist/` is unaffected.

Rules of thumb when contributing:

- New page/business logic starts as a composable in `src/vue/` (or, if
  framework-free, in `src/client/`); the `.vue` file renders it.
- Quasar imports in `.ts` files are only allowed under `src/quasar/`.
- A few framework-free type/i18n modules stay co-located with their SFCs
  (`components/dialogs/types.ts`, `components/bundle-editor/catalog-i18n.ts`,
  `internal/platform-email/platform-email.types.ts`,
  `internal/email-history/email-history.types.ts`, `pages-tenant/default-i18n.ts`)
  and are whitelisted in the ESLint rules — they must not grow framework
  imports.

### Notify port

Standard pages emit toasts through a single seam instead of calling
`$q.notify` directly: the `UiNotify` port (`SUPER_ADMIN_NOTIFY_KEY`).
`createSuperAdminApp()` provides a Quasar-backed default; apps with their
own notification center override it:

```ts
createSuperAdminApp({
    // ...
    notify: (kind, message, options) => myToasts.push({ kind, message, ...options }),
});
```

### Confirm port

A second seam, `UiConfirm` (`SUPER_ADMIN_CONFIRM_KEY`), works the same way:
`createSuperAdminApp()` provides a Quasar `Dialog` default, and an app with its
own modal system replaces it.

It is available to your own pages today. The standard pages do **not** use it
yet — `UsersPage`, `PilotsPage`, `PromoCodesPage` and `PlatformEmailPage` still
call `q.dialog()` directly, so replacing the port does not change what they show.
Moving them onto it belongs to the page migration.

```ts
createSuperAdminApp({
    // ...
    confirm: (request) => myModals.ask(request),
});
```

A request may ask for a value as well as a yes — an audit reason before a
password reset, the date a pilot is extended to — so the port resolves
`{ ok, value? }` rather than a bare boolean. An implementation must actually
ask: one that resolves `{ ok: true }` outright turns every guarded action into
an unguarded one.

Dialogs that collect a form, and the one that displays a generated one-time
password, are not confirmations and stay as they are.

## Usage

```bash
pnpm add @saasicat/ui-vue
```

```ts
import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import App from './App.vue';
import { routes } from './router/routes';

const { mount } = createSuperAdminApp({
    rootComponent: App,
    brand: { name: 'MyApp', logoText: 'MA' },
    endpoints: { apiBase: '/api/v1/admin' },
    appRoutes: routes,
});
mount('#app');
```

The fastest way to a running admin app is the scaffolder:

```bash
pnpm create saasicat-admin admin --project-key=myapp
```

See the [quickstart](https://github.com/uelker70/saasicat/blob/main/docs/quickstart.md) (step 9) for the full setup
and the [architecture](https://github.com/uelker70/saasicat/blob/main/docs/explanation/architecture.md)
for how the pieces fit.

## Language

The UI ships German (reference) and English catalogs — plain typed objects, no
`vue-i18n` dependency. German is the default:

```ts
createSuperAdminApp({
    // …
    i18n: { locale: 'en' },
});
```

Users switch languages themselves through the shell's `LocaleSwitcher` (header
and login page); the pick is remembered. Which languages an app offers is its
own call: `i18n.locales` narrows the set, `i18n.additionalLocales` adds
languages the platform does not ship, `i18n.overrides` replaces individual
strings, and `i18n.switcher: false` drops the control entirely. Components read
the catalog via `useSaMessages('<namespace>')` / `useSuperAdminI18n()`.
See [UI language](https://github.com/uelker70/saasicat/blob/main/docs/guides/build-the-admin-frontend.md#ui-language-i18n).

## Build

```bash
pnpm --filter @saasicat/ui-vue build
```

Two builders. tsup (`tsup.config.ts`) produces
`dist/{index,client/index,vue/index,quasar/index}.{js,cjs,d.ts}`; Vite
(`vite.build.config.ts`) compiles the components, one entry each, and copies
Quasar's stylesheet and the icon font beside them. `vue`, `vue-router` and
`pinia` stay external in both; `quasar` is external too and travels as a
dependency of this package.

## Next

- [Build the admin frontend](../../docs/guides/build-the-admin-frontend.md) — wiring it into an app
- [Design guide](../../docs/explanation/design-guide.md) — the page recipe and the colour roles
- [Pages take resources, not callbacks](../../docs/explanation/adr/0008-resource-ports-over-props.md)
