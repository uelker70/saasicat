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

| Entry | Source | May import | Contents |
| --- | --- | --- | --- |
| `@saasicat/ui-vue/client` | `src/client/` | `@saasicat/types` only | Framework-free core: `BootLoader`, `ManifestLoader` (ETag cache), nav builder, action registry, batch column fetcher, `HttpClient`/`KvStore` contract. Usable from any framework or plain Node/TypeScript. |
| `@saasicat/ui-vue` (main) | `src/vue/` (+ client re-exports) | Vue, `vue-router`, Pinia — **no Quasar** | Composables (`useTenants`, `usePlanEditor`, …), router guards, injection keys + shell contract, notify-port type, optional Pinia store factory. |
| `@saasicat/ui-vue/quasar` | `src/quasar/` | everything above + Quasar | `createSuperAdminApp()` bootstrap and the Quasar notify-port implementation. |
| `@saasicat/ui-vue/pages-standard/*`, `/pages-tenant/*`, `/components/*` | SFC directories | everything | The Quasar reference UI, shipped as raw `.vue` from `src/` (compiled by the consumer's Vite). |

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

Confirm dialogs inside the reference pages intentionally keep using Quasar's
`Dialog` — the pages *are* the Quasar layer.

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

## Build

```bash
pnpm --filter @saasicat/ui-vue build
```

Produces `dist/{index,client/index,quasar/index}.{js,cjs,d.ts}` via tsup
(`tsup.config.ts`); `vue`, `vue-router`, `pinia` and `quasar` stay external.
