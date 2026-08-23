<!-- naming-history: this guide names the pre-1.0 identifiers on purpose — they are what it tells you to replace. -->

# Migrating to 1.0

1.0 is the one deliberate break in SaaSiCat's history: phase 4 cut the UI surface to one name
per thing, and phase 5 renamed what had two spellings. Everything below is mechanical, and one
command does almost all of it:

```bash
npx @saasicat/cli@latest codemod v1 --dir=.
```

It runs `v1-imports` (the surface cut) and then `v1-rename` (the names), is idempotent, skips
`node_modules/` and `dist/`, and **reports rather than guesses** the two cases it cannot decide —
both are listed at the end. Run it with `--dry-run` first if you want to see the count.

## What changed, and what it becomes

### The module class and its option types

| before                                   | after                        |
| ---------------------------------------- | ---------------------------- |
| `SaasPlatformModule`                     | `SaaSiCatModule`             |
| `SaasPlatformModuleOptions`              | `SaaSiCatModuleOptions`      |
| `SaasPlatformAdapters`                   | `SaaSiCatAdapters`           |
| `SaasPlatform<Feature>Options` (11 more) | `SaaSiCat<Feature>Options`   |
| `createSaasPlatformTestModule`           | `createSaaSiCatTestModule`   |
| `SaasicatPersistenceAdapter`             | `SaaSiCatPersistenceAdapter` |
| `SaasicatPersistence<Slice>` (6 types)   | `SaaSiCatPersistence<Slice>` |

`SaaSiCatModule` already existed as an alias; it is now the definition, and the old name is
gone. The codemod rewrites the stem wherever it appears in an identifier.

### The package that stopped being only types

`@saasicat/types` is `@saasicat/core`. It always carried the pure domain logic both sides run —
the error catalogues, `classifyPlanDiff`, the promo arithmetic — and the name promised less than
that; pricing and proration are planned to consolidate there. Every import moves as-is:

| before                                | after                                |
| ------------------------------------- | ------------------------------------ |
| `import { … } from '@saasicat/types'` | `import { … } from '@saasicat/core'` |

The codemod rewrites the specifier **and the dependency in every `package.json` it meets** —
under pnpm an import a manifest does not declare fails to resolve. The range becomes
`^<the CLI's own version>`: a 0.x range like `^0.27.0` names a line `@saasicat/core` was never
on. A `workspace:`, `file:` or `link:` range is reported instead, because it points at a location
only you know. **Then regenerate your lockfile** (`pnpm install`, `npm install` or `yarn install`,
whichever owns it): the codemod changes `package.json` and leaves the lockfile alone, and a CI that
installs with `--frozen-lockfile` refuses the checkout until the two agree. `@saasicat/types` stays
on npm at `0.27.0` for the 0.x line and gets no 1.0.

### Registry keys

Every `Symbol.for` key is `saasicat/<package>/<Name>` now. Four prefixes became one:

| before                            | after                   |
| --------------------------------- | ----------------------- |
| `saas-platform/<Name>`            | `saasicat/nest/<Name>`  |
| `saas-platform-nest/<Name>`       | `saasicat/nest/<Name>`  |
| `saas-platform-cli/<Name>`        | `saasicat/cli/<Name>`   |
| `@saasicat/ui-vue/<KEY>` (inject) | `saasicat/ui-vue/<KEY>` |

If you inject through the exported constants (`MFA_PORT_TOKEN`, `SUPER_ADMIN_HTTP_KEY`, …)
nothing changes for you. If you wrote a key string yourself — `Symbol.for('saas-platform/MfaPort')`
in your own provider — the codemod rewrites it; left alone, that injection would resolve to
nothing at boot. The keys will not be renamed again: see the `Symbol.for` section of
[CONTRIBUTING.md](../CONTRIBUTING.md).

### One token that meant two things

`FEATURE_UI_REGISTRY_TOKEN` named the public-catalog registry in `@saasicat/nest/billing` and the
SuperAdmin catalog registry in `@saasicat/nest/catalog`. They are
`BILLING_FEATURE_UI_REGISTRY_TOKEN` and `CATALOG_FEATURE_UI_REGISTRY_TOKEN`. The codemod decides
by the entry you imported from; an import from anywhere else is **reported**, because the text
does not say which registry you meant.

### The UI surface (phase 4)

| before                                            | after                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| `@saasicat/ui-vue/pages-standard/*`               | `@saasicat/ui-vue/pages/*.vue`                   |
| `@saasicat/ui-vue/components/<primitive>`         | `@saasicat/ui-vue/ui/<group>/<primitive>.vue`    |
| `@saasicat/ui-vue/components/plan/<tenant part>`  | `@saasicat/ui-vue-tenant/plan/<tenant part>.vue` |
| `@saasicat/ui-vue/components/<admin domain part>` | not published — copy what you need               |
| `@saasicat/ui-vue/pages/AdminLayout.vue`          | `@saasicat/ui-vue/layouts/AdminLayout.vue`       |
| `@saasicat/ui-vue/pages/SuperAdmin*.vue`          | `@saasicat/ui-vue/auth/SuperAdmin*.vue`          |
| `@saasicat/ui-vue/pages-tenant/*`                 | `@saasicat/ui-vue-tenant/*`                      |
| `@saasicat/ui-vue/sa-theme.css`                   | `@saasicat/ui-vue/theme.css`                     |
| `@saasicat/ui-vue/testing-e2e/*`                  | `@saasicat/ui-vue/testing/*`                     |

A domain or page-private component that `components/*` used to hand out has no new home on the
surface; `v1-imports` lists each one it meets. Pages no longer take callback props — they read
the resource registry — so the wiring an app wrote for them can be deleted; `resourceOverrides`
on `createSuperAdminApp()` is the seam for the one call you want diverted. The
`@saasicat/ui-vue` CHANGELOG for the 1.0 candidates carries the full account.

### Defaults that moved

- `DEFAULT_SA_LOCALE` is `'en'`. An app that wants German says so:
  `createSuperAdminApp({ i18n: { locale: 'de' } })`.
- **`createSuperAdminApp({ http })` is required once you mount a standard page.** The pages read
  their data through the resource registry, and the registry is installed only when the app names
  its HTTP client — a bare `fetch` would send every request without your Authorization header and
  fail silently, so the bootstrap refuses to guess. Without `http` the first standard page throws
  `useResource("…"): no resource registry in scope` in its `setup()`; until 0.27 the same app
  worked, because the pages took their loaders as props.

## What the codemod leaves to you

1. **`FEATURE_UI_REGISTRY_TOKEN` imported from `@saasicat/nest`** — pick the entry you mean.
2. **A `components/*` import with no public successor** — copy the component.
3. **Your own `tests-e2e/` directory** — yours to keep or rename; only the platform helper's
   import path changed.
4. **A `file:` override that points into this repository** — the package directories are their
   npm names now (`packages/nest`, not `packages/saas-platform-nest`). The codemod does not scan
   `package.json`; update the path by hand.
5. **A feature guard of your own.** With `globalFeatureGuard: false`, 1.0 refuses to boot when a
   `@RequireFeature` route has no feature guard in front of it — and it recognises a guard only by
   `FEATURE_GUARD_MARKER`, which `StaticFeatureGuard` and `FeatureGuard` carry. A guard you wrote
   yourself enforces the annotation just as well and is still reported, route by route. Mark it:

    ```ts
    import { FEATURE_GUARD_MARKER } from '@saasicat/nest';

    @Injectable()
    export class FeatureGuard implements CanActivate {
        static readonly [FEATURE_GUARD_MARKER] = true;
        // …
    }
    ```

    Only a guard that really enforces `@RequireFeature` may carry the marker: it is the claim the
    check trusts. A guard bound globally as an `APP_GUARD` is the other shape the check cannot see;
    there, `enforcementChainCheck: false` turns the check off and nothing else.

## Order for a workspace with several apps

Run the codemod from the repository root once; it walks every package. Bump every `@saasicat/*`
dependency to the same version — the packages are released in lockstep, and a mixed set will
fail at the registry keys. Then boot the app and read the log: a `SaaSiCatConfigurationError`
lists every configuration problem at once.
