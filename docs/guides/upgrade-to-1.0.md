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
[CONTRIBUTING.md](../../CONTRIBUTING.md).

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

### The admin package brought its framework with it (phase 8)

`@saasicat/ui-vue` ships its components built, and carries `quasar` as its own dependency. Remove
`quasar`, `@quasar/vite-plugin` and `sass` from your admin app — you were installing them to compile
an application you only mount.

**Your imports do not change.** `@saasicat/ui-vue/pages/UsersPage.vue` still resolves: your
typechecker reads the source, your bundler loads the build.

What you do change:

1. **The Quasar plugin leaves your Vite config**, and with it `sassVariables`:

    ```ts
    // before
    plugins: [vue(), quasar({ sassVariables: './src/styles/theme.scss' })],
    // after
    plugins: [vue()],
    ```

2. **Four stylesheet imports** in your entry, replacing the two you had:

    ```ts
    import '@saasicat/ui-vue/quasar.css'; // was: 'quasar/src/css/index.sass'
    import '@saasicat/ui-vue/icons.css'; // was: '@quasar/extras/material-icons/…'
    import '@saasicat/ui-vue/theme.css'; // unchanged
    import '@saasicat/ui-vue/style.css'; // new — the components' own styles
    ```

    Without the last one the pages render unstyled. It exists because the components are compiled
    now: their `<style>` blocks used to be compiled by your build along with everything else.

3. **Your brand colour moves out of Sass.** `$primary` was resolved by your build, and the
   stylesheet is no longer compiled there:

    ```ts
    createSuperAdminApp({
        brand: { logoText: 'na', name: 'NotesApp', color: '#1e40af' },
    });
    ```

    One value moves both namespaces — it writes `--q-primary`, and `--sa-color-accent` reads it.

4. **Delete `src/styles/theme.scss`.** Nothing compiles it any more, and only `$primary` was ever
   yours. `$secondary` and `$accent` were read by nothing. The four status colours are the
   platform's own roles, and asking you to restate them is how they drifted — the scaffolded
   `$warning: #f59e0b` sat beside a `--sa-color-warning` that resolves to `#b45309`, so
   `color="warning"` painted 2.15:1 on white next to a role painting 4.8:1. The platform now points
   Quasar's `--q-positive`, `--q-negative`, `--q-warning` and `--q-info` at `--sa-color-*-solid`
   through `var()`. If you had changed one, change that role — not the one without the suffix:

    | Sass variable you had | Role to override now        |
    | --------------------- | --------------------------- |
    | `$positive`           | `--sa-color-positive-solid` |
    | `$negative`           | `--sa-color-negative-solid` |
    | `$warning`            | `--sa-color-warning-solid`  |
    | `$info`               | `--sa-color-info-solid`     |

    ```css
    :root {
        --sa-color-warning-solid: #b45309;
    }
    ```

    **Write it on `:root`, not on `body`.** The package sets
    `--q-warning: var(--sa-color-warning-solid, …)` inline on `<html>`, and a `var()` inside a
    custom-property declaration is substituted on the element that declaration sits on — so only
    `:root` is in reach. This is the one role you override on a single selector rather than on both
    of the theme's, and it works because the value is the same in either scheme.

    The suffix is the whole point, and it is the one thing to read twice. `--sa-color-warning` is a
    foreground: text and icons, measured against the page, so it goes lighter in the dark theme.
    Quasar uses its variable the other way round — as a background, with white text of its own on
    top — so `--sa-color-warning-solid` carries the same value in both themes. White on the dark
    foreground rung reads 1.67:1. Whatever you put here, keep white legible on it; the shipped
    values run 4.83:1 to 5.48:1.

5. **`resolve.dedupe` loses `quasar`** unless your own application uses Quasar too. If it does, keep
   it: two Quasar instances mean `Dark.set()` in one leaves the other light. It is your singleton
   now rather than this package's peer.

Quasar's stylesheet stays an import you write rather than one the bundle hides, and that is
deliberate: measured against a page that styles itself, it changes 76 computed properties on every
element — the body font, `h1` from 40px to 96px, `box-sizing` globally. You accept that today by
importing it; bundling it would mean you could no longer decline.

### The tenant components dropped their UI framework (phase 7)

`@saasicat/ui-vue-tenant` no longer lists `quasar` as a peer dependency, and its components render
plain elements on the theme's CSS custom properties instead of Quasar's. If you installed Quasar
only to embed a plan section, you can remove it along with `@quasar/vite-plugin` and the Sass
setup that came with it — nothing else in the tenant package needs them.

What that costs you if you had styled around the old markup:

- **The class names changed.** Rules written against `.q-card`, `.q-card-section`, `.q-btn` or
  `.q-badge` inside the tenant surface no longer match. The package's own classes are prefixed
  `sp-`, and the values they read are the `--sa-*` role tokens — overriding a token moves every
  component at once, which is the seam meant for this.
- **`TenantPlanCardHeader` takes `statusTone`, not `statusColor`**, and the values are badge tones
  (`neutral` / `positive` / `negative` / `warning` / `info`) rather than Quasar colour names. Only
  an app that renders that component directly is affected; `TenantPlanSection` passes it itself.
- **The feature matrix no longer draws the registry's icon.** `FeatureUiMeta.icon` is a Quasar icon
  name, so drawing it needed Quasar's icon font. It is handed to a slot instead, and an app that
  wants those glyphs draws them:

    ```vue
    <TenantPlanSection show-feature-matrix>
        <template #feature-icon="{ feature }">
            <YourIcon :name="feature.icon" />
        </template>
    </TenantPlanSection>
    ```

- **Dark mode no longer goes through the `quasar` entry.** `bindSaThemeAttribute(createSaTheme())`
  from `@saasicat/ui-vue` writes the one attribute the role tokens key off.
  `bindSaThemeToDocument` from `@saasicat/ui-vue/quasar` still exists and still adds the second
  half, keeping Quasar's own `Dark` in step — which an app without Quasar has no need of.

The admin package is unchanged here: `@saasicat/ui-vue` still uses Quasar, and still asks for it.

### Defaults that moved

- `DEFAULT_SA_LOCALE` is `'en'`. An app that wants German says so:
  `createSuperAdminApp({ i18n: { locale: 'de' } })`.
- **`createSuperAdminApp({ http })` is required once you mount a standard page.** The pages read
  their data through the resource registry, and the registry is installed only when the app names
  its HTTP client — a bare `fetch` would send every request without your Authorization header and
  fail silently, so the bootstrap refuses to guess. Without `http` the first standard page throws
  `useResource("…"): no resource registry in scope` in its `setup()`; until 0.27 the same app
  worked, because the pages took their loaders as props.

### The subscription table gained two columns

`Subscription` needs `canceledEffectiveAt` and `minimumTermUntil`, both nullable. Add them before
deploying 1.0 — they are what the cancellation rules are read from, and an app whose schema lacks
them fails when someone cancels.

```prisma
model Subscription {
    // …
    canceledAt          DateTime?
    canceledEffectiveAt DateTime?   // new: when the cancellation lands
    minimumTermUntil    DateTime?   // new: the end of what was committed to
}
```

```sql
ALTER TABLE "subscriptions"
    ADD COLUMN "canceledEffectiveAt" TIMESTAMP(3),
    ADD COLUMN "minimumTermUntil"    TIMESTAMP(3);
```

A third column arrives with the billing anchor:

```prisma
model Subscription {
    // …
    billingAnchorDay Int?   // new: the day of the month this is billed on, 1–31
}
```

```sql
ALTER TABLE "subscriptions" ADD COLUMN "billingAnchorDay" INTEGER;
```

`saasicat schema check --prisma-schema=path/to/schema.prisma` compares your schema against the
shipped fragments and names what is missing; run it before the deploy rather than after.

**No backfill is required.** On a row written before the split, `canceledAt` holds the effective
date and `canceledEffectiveAt` is null, and every reader in the platform applies
`canceledEffectiveAt ?? canceledAt` for exactly that reason — the renewal decision, the cancel
route, the usage projection and entitlement resolution alike. Backfilling is still tidier if you
want one column to mean one thing:

```sql
UPDATE "subscriptions"
   SET "canceledEffectiveAt" = "canceledAt"
 WHERE "canceledAt" IS NOT NULL
   AND "canceledEffectiveAt" IS NULL;
```

`minimumTermUntil` stays null on existing rows and should: null means "no commitment beyond the
period", which is what those subscriptions were sold under. Each renewal sets it from then on.

**If you implement the ports yourself, your build breaks here, on purpose.** Three records require
`canceledAt` and `canceledEffectiveAt` now — `SubscriptionRecord` (entitlement resolution ends a
subscription by reading them), `SubscriptionUsageRecord` (the tenant billing route refuses a plan
change on a subscription that has ended) and `DuePendingPlanChange` (materialisation declines a
change that came due after the end). Each stops compiling until it returns them:

```ts
return {
    // …
    canceledAt: row.canceledAt ?? null,
    canceledEffectiveAt: row.canceledEffectiveAt ?? null,
};
```

They are required rather than optional because the alternative is silent: a record without them
cannot distinguish a subscription that ends next January from one that ended last January, and the
quiet answer is that it keeps everything.

### A subscription is billed on a day, and February no longer takes it

Period boundaries used to read their day from the previous boundary, and the previous boundary had
already been clamped to fit a shorter month. A subscription starting on the 31st was billed on the
28th from its first February onwards — and on the 28th for the rest of its life. Three days lost
once, silently, with every later date measured from the wrong one: the renewal window, the notice
deadline, and the contract end a customer is told about.

`billingAnchorDay` holds the day, is written when a period window opens, and is never rewritten by
a renewal — reading its own previous result is precisely the drift it exists to stop. The anchor is
a **day number**, clamped down where the month is too short and not consumed by that clamp: an
anchor of 31 gives 28 February and then **31** March; an anchor of 30 gives **30** October, not the
31st. It is "the 30th", not "the end of the month".

**Nothing changes for a row without the column.** `computeNextPeriod` falls back to the day of the
period end, which is today's behaviour, so the migration is additive and an app that does not read
the column keeps exactly what it has. **A backfill is optional and cosmetic**, and only correct
where a subscription has never had its window reopened by a plan change:

```sql
UPDATE "subscriptions"
   SET "billingAnchorDay" = EXTRACT(DAY FROM "currentPeriodStart")
 WHERE "billingAnchorDay" IS NULL
   AND "currentPeriodStart" IS NOT NULL;
```

Leaving it null and letting the next plan change set it is the safer default.

### A cancellation that has taken effect now ends the entitlements

Until 1.0 nothing on the entitlement path read a cancellation. A subscription whose cancellation
had landed — last month, last year — was granted exactly what it was granted while active: same
plan, same features, same quotas. `FeatureGuard` let it through, and no repository filtered it out.

From 1.0 a landed cancellation grants **nothing**: no features, no quotas. A cancellation that is
merely _declared_ still changes nothing at all, which is the same rule as before — a subscription
cancelled in month three of a year runs, is billed and keeps everything until the term ends.

Two consequences to plan for.

**Some tenants lose access on the day you deploy.** Every subscription whose cancellation has
already landed is affected, and there may be more of them than anyone remembers, because until now
the state had no effect. List them before deploying:

```sql
SELECT "tenantId", "plan", "status",
       COALESCE("canceledEffectiveAt", "canceledAt") AS ended
  FROM subscriptions
 WHERE COALESCE("canceledEffectiveAt", "canceledAt") <= NOW()
 ORDER BY ended;
```

If that list holds a tenant who should still have access, the cancellation is the thing to correct —
not this rule.

**You may keep a floor instead of nothing.** `canceledEntitlementPlan` names a plan a subscription
falls back to once its cancellation lands: a read-only tier a former customer can export from, or a
free plan. It is resolved through the catalog like any other plan and needs an active version;
bundle bookings and custom limits are not added to it, because those belonged to the subscription
that ended.

```ts
EntitlementModule.forRoot({
    resolutionConfig: { canceledEntitlementPlan: 'FREE' },
    // …
});
```

**If you implement the ports yourself**, `SubscriptionRecord` now requires `canceledAt` and
`canceledEffectiveAt`. They are required rather than optional on purpose: an adapter that omits
them cannot tell a subscription that ends next January from one that ended last January, and the
silent answer is the wrong one. `@saasicat/adapter-prisma` and `@saasicat/adapter-drizzle` both
supply them.

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
