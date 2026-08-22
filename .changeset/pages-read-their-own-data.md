---
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': major
'@saasicat/cli': minor
---

**Every standard page reads its own data.** Twelve pages took sixty-one callback
props between them — `loadTenants`, `submitCreate`, `reviewFeature`,
`classifyDiff` — and every consumer app wrote them all again. They now ask the
platform's resource registry by name. Function props in pages: **64 → 2**, and
`tests/pages-take-no-callbacks.test.js` now holds that number: it resolves each
prop's type through the compiler, so a callback reached through a type alias
fails the build the same way an inline one does.

An app that mounted a standard page with the standard wiring can delete that
wiring. An app that needs one call diverted passes `:resources` to that page,
or `resourceOverrides` to `createSuperAdminApp()`, and keeps the rest — the
property
a prop-based page cannot offer, because its props are all or nothing.

The example's glue shows the size of it: `AdminBundlesPage` went from 145 lines
to 16, `AdminDiscoveryPage` from 72 to 16.

The two remaining function props are on `AdminManifestErrorPage`, deliberately:
that page renders when the manifest failed to load, so pointing it at the
registry would point it at the thing whose absence put it on screen. Each says
so in its own JSDoc, which is what the guard reads — an exception is declared
where the prop is, not collected in a list somewhere else.

**`DashboardPage` joins them.** It kept `loadManifest`, `http` and `formatKpi`
after the other twelve moved. The manifest comes from the shell's guard, the
client from the registry, and the third is now a resource:

```diff
-<DashboardPage :manifest="m" :load-manifest="load" :http="client"
-                :format-kpi="myFormat" :distributions="rows" />
+<DashboardPage :options="{ distributions: rows }" />
```

An app whose KPI endpoints answer in a shape the default reader does not
recognise overrides `dashboard.kpi` once, instead of threading a formatter to
the one page that took it. `subtitle`, `distributions`, `shortcuts` and
`shortcutDescriptions` moved into `options`.

**Pages no longer take `adminEndpoint`, `projectKey`, `http` or
`getAuthToken`.** They come from the shell, which already knew them.
`BundlesPage` in particular
took a `projectKey` prop while its resources read a different one from the
context — two answers to one question.

**Four resources are new**, and none of them invents an endpoint. The platform
ships pages for pilots, SMTP providers and the send log but serves no route for
any of them: those belong to your backend. The descriptors record the paths
every consumer already calls, so the pages need no callbacks and you override
an operation instead of supplying one.

**Fixed: `auditResource` sent parameters the endpoint ignores.** It spoke
`AuditQuery` (`actorTag`, `from`, `to`, paginated) at `GET /admin/audit`, which
accepts `actor`, `action`, `entity`, `since`, `limit` and answers with a bare
array. Filtering the audit list by actor would have returned an unfiltered list
that looked filtered. `AuditListFilter` is now `AdminAuditListFilter`, and
`useResourceList('audit')` no longer compiles — call
`useResource('audit').list(filter)`.

**A fully redeemed promo code no longer renders red.** Both copies of the page's
status-to-colour function fell through to `negative` for `EXHAUSTED`, so the
campaign that worked best looked like a fault.

---

**The plan editor and review are their own routes.**
`/admin/plans/version/edit` and `/admin/plans/version/review` — deep-linkable,
and children of the plans route so the unsaved draft survives moving between
them. Nothing is written to the server until you publish or save, which is the
point of the review step.

---

**`pages-tenant/*` moved to `@saasicat/ui-vue-tenant`.**

```diff
-import TenantPlanSection from '@saasicat/ui-vue/pages-tenant/TenantPlanSection.vue';
+import TenantPlanSection from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';
```

`saasicat codemod v1-imports` rewrites these for you along with the rest of the
1.0 import moves.

**Fixed while splitting it: the package's export map answered no `.ts` file.**
It read `"./*": "./src/*"`, and the package ships source, so
`import { … } from '@saasicat/ui-vue-tenant/tenant-i18n.js'` resolved to a
`.js` that is not there. `./*.js` now maps to `./src/*.ts`, `./*.vue` to
`./src/*.vue`.

Why: different audience, different release schedule. Those components render
inside your customers' product under their branding and in their language, and
folding them into the admin package meant every breaking change in the admin
forced a migration in the middle of a customer-facing product. It also shipped
4,300 lines to every admin consumer who never renders a tenant page.

Add the package alongside the platform one:

```bash
pnpm add @saasicat/ui-vue-tenant
```

It takes `@saasicat/ui-vue` as a peer and reads the same design tokens, so
`import '@saasicat/ui-vue/theme.css'` still covers both.

---

**Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`.
It is also the fallback for `Intl`, so an app that names no locale now formats
dates and currency the English way. German remains a complete catalog — pass
`createSuperAdminApp({ i18n: { locale: 'de' } })`.
