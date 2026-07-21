# @saasicat/ui-vue

Vue 3 components + composables for the SuperAdmin UI shell. Provides the
boot loader, manifest loader (ETag cache), nav builder, action registry,
standard pages (Dashboard, Tenants, Plans, Discovery, …) and the tenant
self-service building blocks (`FeatureGate`, `useTenantManifest`,
`PlanChangeWizard`).

Peer dependencies: `vue`, `vue-router`, `pinia`, `quasar`.

## Usage

```bash
pnpm add @saasicat/ui-vue
```

```ts
import { createSuperAdminApp } from '@saasicat/ui-vue';
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

Produces `dist/index.{js,cjs,d.ts}` via tsup; `vue`, `vue-router`, `pinia`
and `quasar` stay external.
