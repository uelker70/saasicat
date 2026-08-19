# @saasicat/ui-vue

Vue 3 components + composables for the SuperAdmin UI shell. Provides the
boot loader, manifest loader (ETag cache), nav builder, action registry,
standard pages (Dashboard, Tenants, Plans, Discovery, …) and the tenant
self-service building blocks (`FeatureGate`, `useTenantManifest`,
`PlanChangeWizard`).

Peer dependencies: `vue` (required); `vue-router`, `pinia`, `quasar`
(optional — see the layers below for what actually needs them).

## Layers

The package is layered so that each entry only loads what it names.
Lower layers never import upward; ESLint (`no-restricted-imports`, repo
root config) enforces the boundaries in CI.

| Entry                                                                   | Source                           | May import                               | Contents                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@saasicat/ui-vue/client`                                               | `src/client/`                    | `@saasicat/types` only                   | Framework-free core: `BootLoader`, `ManifestLoader` (ETag cache), nav builder, action registry, batch column fetcher, the `HttpClient`/`KvStore` contract with its `fetch` and axios adapters, `AdminError`. Usable from any framework or plain Node/TypeScript. |
| `@saasicat/ui-vue` (main)                                               | `src/vue/` (+ client re-exports) | Vue, `vue-router`, Pinia — **no Quasar** | Composables (`useTenants`, `usePlanEditor`, …), router guards, injection keys + shell contract, notify-port type, optional Pinia store factory.                                                                                                                  |
| `@saasicat/ui-vue/quasar`                                               | `src/quasar/`                    | everything above + Quasar                | `createSuperAdminApp()` bootstrap and the Quasar notify-port implementation.                                                                                                                                                                                     |
| `@saasicat/ui-vue/pages-standard/*`, `/pages-tenant/*`, `/components/*` | SFC directories                  | everything                               | The Quasar reference UI, shipped as raw `.vue` from `src/` (compiled by the consumer's Vite).                                                                                                                                                                    |

### The shipped source has a language floor

The last row is not a build output: those subpaths hand out `.vue` and `.ts`
straight from `src/`, so **your** `tsconfig` compiles them, not ours. Anything
they reach — which includes `src/client/` and `src/vue/` — therefore has to
compile under the oldest language level a consumer uses.

That floor is **ES2021** (`lib: ES2021, DOM, DOM.Iterable`). It is checked, not
promised: `pnpm --filter @saasicat/ui-vue test:shipped-source` compiles the
closure reachable from every source-shipping subpath at that level, and CI runs
it. The directories come from the export map, so a new source subpath is covered
the day it is added.

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
  `pages-standard/platform-email.types.ts`,
  `pages-standard/email-history.types.ts`, `pages-tenant/default-i18n.ts`)
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
and the [handbook](https://github.com/uelker70/saasicat/blob/main/docs/handbook.md) for the architecture.

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
See [handbook §8.7](https://github.com/uelker70/saasicat/blob/main/docs/handbook.md#87-ui-language-i18n).

## Build

```bash
pnpm --filter @saasicat/ui-vue build
```

Produces `dist/{index,client/index,quasar/index}.{js,cjs,d.ts}` via tsup
(`tsup.config.ts`); `vue`, `vue-router`, `pinia` and `quasar` stay external.
