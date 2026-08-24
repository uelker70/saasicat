# @saasicat/ui-vue-tenant

## What this is

The tenant-facing half of SaaSiCat's Vue UI: the plan section a customer sees in
their own application, the plan-change wizard, the onboarding configurator and
the bundle store.

## What this is not

Not the admin UI. These components render inside **your** application, under
your branding and in your customer's language — the plan section, the
plan-change wizard, the onboarding configurator, the bundle store.

Not a build output. The package ships source only, so your Vite and TypeScript
configuration compiles it; there is no `dist/` to import from.

## Why this is not part of `@saasicat/ui-vue`

Different audience, and everything else follows from that.

`@saasicat/ui-vue` renders the **operator's** admin — one shell, the operator's
language and branding, released whenever the platform is. These components
render **inside the customer's product**, under the customer's branding, in the
customer's language, on the customer's release schedule. Folding them together
would mean every breaking change in the admin forces a migration in the middle
of a customer-facing product.

It also makes i18n a different contract. The admin has one catalog the operator
picks a language from; here the strings belong to the host app, which is why
`provideTenantI18n()` takes them rather than `useSaMessages()` supplying them. A
tenant's subscription page inheriting the operator's German default is the bug
that shape prevents.

## Entry points

| Entry     | What is in it                                                       |
| --------- | ------------------------------------------------------------------- |
| `./*.vue` | The components, straight from `src/` — your build compiles them.    |
| `./*.js`  | The `.ts` beside them: `tenant-i18n`, the shared types and helpers. |

There is no root entry and no `dist/`: a package that ships source has nothing
to re-export.

## Installation

```bash
pnpm add @saasicat/ui-vue-tenant
```

`vue`, `@saasicat/ui-vue` and `@saasicat/core` are peer dependencies. **No UI
framework** — these components are built from plain elements and the theme's CSS
custom properties, so embedding a plan section costs you Vue and a stylesheet,
not a framework decision you already made differently.

`@saasicat/ui-vue` is here for types, composables and the theme, not for
components. Its own `quasar` peer is declared optional, so installing this
package does not ask you for it either. The reasoning is
[ADR 0010](../../docs/explanation/adr/0010-tenant-ui-without-quasar.md), and
`tests/the-tenant-package-needs-no-quasar.test.js` keeps it true — including the
utility classes a prefix check would miss.

## Usage

```vue
<script setup lang="ts">
import TenantPlanSection from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';
</script>

<template>
    <TenantPlanSection :usage="usage" />
</template>
```

Import the platform theme once in your app so these components pick up the
design tokens:

```ts
import '@saasicat/ui-vue/theme.css';
```

## Source, not a build

Like `@saasicat/ui-vue`'s page subpaths, this package hands out `.vue` and `.ts`
from `src/` — here because your bundler already compiles Vue components and a
build step would only add one. Your `tsconfig` therefore compiles these files,
so they stay within **ES2021** — the same language floor the platform package
documents.

## License

[PolyForm Shield 1.0.0](./LICENSE) — source-available, not OSI open source.

## Next

- [Build the admin frontend](../../docs/guides/build-the-admin-frontend.md) — the admin side of the same stack
- [Design guide](../../docs/explanation/design-guide.md) — the tokens these components read
