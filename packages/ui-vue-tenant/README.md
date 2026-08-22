# @saasicat/ui-vue-tenant

The tenant-facing half of SaaSiCat's Vue UI: the plan section a customer sees in
their own application, the plan-change wizard, the onboarding configurator and
the bundle store.

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

## Installation

```bash
pnpm add @saasicat/ui-vue-tenant
```

`@saasicat/ui-vue`, `vue` and `quasar` are peer dependencies — this package
consumes the platform's primitives and design tokens rather than shipping its
own.

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
from `src/`: consumers need the source for Quasar and Sass theming. Your
`tsconfig` therefore compiles these files, so they stay within **ES2021** — the
same language floor the platform package documents.

## License

[PolyForm Shield 1.0.0](./LICENSE) — source-available, not OSI open source.
