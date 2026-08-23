---
'@saasicat/nest': major
'@saasicat/core': major
'@saasicat/cli': major
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/spec': patch
'create-saasicat-admin': patch
---

**One name for everything — and a codemod that applies it.** Phase 5 of the 1.0 cut.

`npx @saasicat/cli@latest codemod v1 --dir=.` does the surface cut from the previous
candidates and everything below in one run. `docs/guides/upgrade-to-1.0.md` is the written
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
