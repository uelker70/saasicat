<!-- naming-history: this guide names the pre-1.0 identifiers on purpose — they are what it tells
you to replace. project-key-history: `projectKey` is one of them. -->

# Migrating to 1.0

1.0 is the one deliberate break in SaaSiCat's history: phase 4 cut the UI surface to one name
per thing, and phase 5 renamed what had two spellings. Everything below is mechanical, and one
command does almost all of it:

```bash
npx @saasicat/cli@latest codemod v1 --dir=.
```

It runs `v1-imports` (the surface cut), then `v1-rename` (the names), then `v1-project-key` (the
column that left the model), is idempotent, skips `node_modules/` and `dist/`, and **reports rather
than guesses** the cases it cannot decide — they are listed at the end. Run it with `--dry-run`
first if you want to see the count.

One step is **not** in there, because no codemod can do it: your database still has the column.
[The migration below](#projectkey-is-gone-from-the-database) is a SQL file you run once.

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

### A bundle now runs in step with the plan that pays for it

A booked bundle used to have no period of its own. It was billed alongside the plan by
convention, which held for as long as every bundle was billed in the plan's rhythm — and stopped
holding the moment one was not. Three columns on `subscription_bundles` give it a period it can
state:

```prisma
model SubscriptionBundle {
    // …
    billingCycle       String?     // new: the rhythm this booking is billed in
    currentPeriodStart DateTime?   // new: the window it is billed for
    currentPeriodEnd   DateTime?
}
```

```sql
ALTER TABLE "subscription_bundles"
    ADD COLUMN "billingCycle"       TEXT,
    ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
    ADD COLUMN "currentPeriodEnd"   TIMESTAMP(3);
```

The rule those columns carry is one sentence: **a bundle's periods end on the day the plan's do.**
The first one is short — from the booking to the next occurrence of the plan's billing day — and is
charged pro rata for exactly that stretch. Every period after it runs anchor to anchor, in step with
the plan for as long as both live, and the last one lands on the day the plan ends.

That is arithmetic at the start rather than a repair at the end, and the difference matters: a
bundle whose period outlives its plan has to be trimmed, and a trimmed period is one somebody was
committed to more of than they received. Aligning at booking means the case never arises.

Two consequences follow from the rule rather than from the code:

- **A bundle may run in a shorter rhythm than its plan, never a longer one.** A monthly bundle
  beside a yearly plan lands on the plan's day every month, and on the plan's own boundary in the
  month the plan ends. A yearly bundle beside a monthly plan has no boundary to meet — the plan
  ends twelve times before the bundle's first period does, and each of those is a moment the plan
  could stop and leave the bundle committed with nothing to grant. Booking one is refused with
  `BUNDLE_CYCLE_EXCEEDS_PLAN`, and the preview reports it as a blocker rather than quoting a price.
- **Ending with the plan is not a cancellation.** No notice is given and none is needed, and the
  period the bundle is in when it happens is not refunded. The tenant preview states both before
  the booking is confirmed: the first period's end, the plan's end where there is one, and the
  no-refund rule in words.

**A backfill is required if you have bookings**, and unlike the anchor above it is not cosmetic.
A row with all three columns null is read as "billed with the plan", which is what every existing
booking was — so nothing breaks on the next request. What the null costs is the next renewal: the
booking has no window of its own to advance. Adopting the plan's window is the identity migration,
and from there the arithmetic keeps them aligned:

List what it will touch before running it:

```sql
SELECT sb."id", sb."subscriptionId", s."plan", s."billingCycle", s."currentPeriodEnd"
  FROM "subscription_bundles" AS sb
  JOIN "subscriptions" AS s ON s."id" = sb."subscriptionId"
 WHERE sb."billingCycle" IS NULL
   AND sb."canceledEffectiveAt" IS NULL;
```

```sql
UPDATE "subscription_bundles" AS sb
   SET "billingCycle"       = s."billingCycle",
       "currentPeriodStart" = s."currentPeriodStart",
       "currentPeriodEnd"   = s."currentPeriodEnd"
  FROM "subscriptions" AS s
 WHERE s."id" = sb."subscriptionId"
   AND sb."billingCycle" IS NULL
   AND sb."canceledEffectiveAt" IS NULL;
```

Bookings that have already ended are left alone deliberately: they are history, and rewriting a
period a tenant was billed for changes what the record says happened.

**Your renewal job gains one call.** The platform decides, your cron reads and writes — the same
division of labour `computeNextPeriod` already has for the plan. `computeNextBundlePeriod` answers
with the window a booking should hold now, or `null` when there is nothing to do.

```ts
import { computeNextBundlePeriod } from '@saasicat/nest';

const next = computeNextBundlePeriod(
    booking, // currentPeriodEnd, billingCycle, canceledAt, canceledEffectiveAt
    {
        billingCycle: sub.billingCycle,
        billingAnchorDay: sub.billingAnchorDay,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        endsAt: sub.canceledEffectiveAt ?? sub.canceledAt,
    },
    now,
);
if (next) await bookings.update(booking.id, next);
```

It answers two questions your job cannot tell apart from the outside, because both look like a
booking whose window is not current. The ordinary one is rolling the next period, anchor to anchor.
The other is opening the **first** one: a bundle booked while its plan had no period — during a
trial, or before sales finished — was stored without a window, because there was nothing to align
to. Once the plan has a paid period the booking joins it. Skip that and a monthly bundle booked on
a yearly trial keeps granting its features and never acquires a window to bill them in.

Pass the plan's own window for that reason; without it the first case cannot be answered and such
bookings wait forever. `endsAt` is the plan's end — `canceledEffectiveAt ?? canceledAt`, the same
reading every other platform reader applies — and without it a booking outlives the plan that pays
for it, the one state the alignment exists to prevent. A job that never calls this at all leaves
every booking on the period it was made in; nothing breaks visibly, and the second period is never
billed.

The window it returns already accounts for both dates that can end a booking — the plan's end and
the booking's own declared cancellation, whichever comes first — and it advances to the first
boundary **after** `now` rather than by one cycle, so a job that has not run for three months
catches up in a single write.

**`addBundle` and `previewAddBundle` take an options object.** The second parameter was
`minimumTermMonths?: number`; it is now `{ minimumTermMonths?, billingCycle? }`, because a third
positional optional is how a signature stops being readable. `billingCycle` is the rhythm to bill
the bundle in — omitted means the plan's, and it may never be longer than the plan's:

```ts
// before
await billing.addBundle(bundleVersionId, 12);
// after
await billing.addBundle(bundleVersionId, { minimumTermMonths: 12 });
// and the case that was unreachable until now
await billing.addBundle(bundleVersionId, { billingCycle: 'MONTHLY' });
```

`useTenantSubscriptionBundles().add()` takes the same field. Until it did, no shipped client could
ask for a rhythm, so a bundle priced monthly only read as unpriced to every tenant on a yearly
plan — the headline case the alignment exists for could not be completed with the composables this
package ships. `TenantBundleStore`'s `buy` event carries an optional cycle for the same reason, and
`TenantPlanSection` sends the same one to the preview and to the confirmation, so the two cannot
describe different contracts.

**A plan change can no longer strand an add-on.** A bundle may run in a shorter rhythm than its
plan, never a longer one, and that rule used to be checked only where a bundle is booked. A yearly
add-on bought beside a yearly plan survived a move to a monthly one. Moving to a shorter cycle is
now blocked with `BUNDLE_CYCLE_EXCEEDS_PLAN` while such a booking is active, naming the date it
runs to; cancelling the add-on first lets the change through. It is refused rather than converted
or ended, because ending it early owes the customer the difference and converting it invents a
price nobody agreed to. The check is skipped entirely for a consumer that has not registered the
bundle module.

**A bundle version can no longer be published without a price.** Neither a base price nor any plan
override resolving one is refused with `BUNDLE_VERSION_NO_PRICE`. A priceless published bundle was
bookable and handed over its features for nothing, and no reader downstream could tell that from a
deliberate free add-on. If your catalog holds one, publishing it again is what surfaces it:

```sql
SELECT bv."id", b."bundleKey"
  FROM "bundle_versions" AS bv
  JOIN "bundles" AS b ON b."id" = bv."bundleId"
 WHERE bv."publishedAt" IS NOT NULL
   AND bv."monthlyNet" IS NULL
   AND bv."yearlyNet" IS NULL;
```

Rows it returns still need checking against their pricing overrides — an override that resolves a
price is enough, and the gate accepts it.

**If you implement the ports yourself**, `SubscriptionBundleRecord` gained the three fields and
`CreateSubscriptionBundleData` accepts them. They are optional, and an adapter that omits them
leaves every booking on the pre-1.0 reading.

### The settings that cost money live in `config/saas.yaml`

Two module options are **gone**, and they are gone rather than deprecated:
`cancellationNoticeDays` and `selfServiceBlockedPlans` are now required sections of
`config/saas.yaml`. Passing either one to `TenantBillingModule.forRoot()` refuses the boot with a
sentence saying where it went.

```ts
// before
TenantBillingModule.forRoot({
    cancellationNoticeDays: 30,
    selfServiceBlockedPlans: { asTarget: ['ENTERPRISE'] },
});
// after — nothing here
TenantBillingModule.forRoot({/* … the rest of your wiring … */});
```

```yaml
# config/saas.yaml — after
tenantBilling:
    cancellationNoticeDays:
        monthly: 30
        yearly: 30
    selfServiceBlockedPlans:
        asTarget: [ENTERPRISE]
        asSource: []
```

**Every existing `config/saas.yaml` stops loading until you add the block**, and the loader names
the field it is missing — `tenantBilling.cancellationNoticeDays`, not a schema path. That break is
the point. A fallback would be a second place the value can come from, and an operator reading the
file has to be reading the value that is running, with no "unless somebody passed it in code"
attached.

**Both members of each are required**, and there is no default. A silent `0` is a commercial
decision too, just an invisible one; the same is true of a missing `asTarget`, which would quietly
say that self-service reaches every plan. Write `0` and `[]` where that is what you mean — spelled
out, they are a decision rather than an omission.

Two things follow for the wiring:

- On the **static path** (`planCatalog: loadPlanCatalogFromFile(…)`) there is nothing to do beyond
  editing the file.
- On the **database path** the settings are not in the database and never will be. `dbCatalog`
  names the file and the platform reads them from it — see
  [`dbCatalog` names the file](#dbcatalog-names-the-file).

`saasicat codemod v1` names every place a moved option is still passed, with its file and line. It
does **not** remove them: the value is a term somebody agreed, and deleting it from the code
without writing it into the file would leave the application running on whatever the file happens
to say — the very failure this move exists to prevent. The boot refusal makes sure the report
cannot be acted on halfway.

`saasicat init` writes the block with defaults and prints what it wrote, with the values and the
path, so a new integrator learns where their settings live on the first run rather than from a
boot failure six weeks later.

### A notice period belongs to a rhythm, not to a platform

`cancellationNoticeDays` was also one number for every subscription. It is now one per rhythm,
`monthly` and `yearly`, both required.

One number could not be right for both. A fortnight of notice on a yearly contract is unusual;
three months on a monthly one is void against a consumer under §309 Nr. 9 BGB. **No ceiling is
enforced** — the platform does not know whether an installation serves consumers or businesses, so
the number is yours to choose and this paragraph is what says what it costs.

The rhythm that decides is the **subscription's**, not the plan's: a customer on a yearly
subscription is owed the yearly notice even where the same plan is also sold monthly. Neither
inherits the other, which is why both are required: a file naming only `yearly` is refused rather
than read as `monthly: 0`.

**A notice longer than the period is now served rather than approximated.** It used to be neither
reachable nor honoured: the deadline it computed had always passed, so every declaration was
classified as late, and the remedy was exactly one period — which for 60 days of notice on a
monthly cycle gave the customer between 31 and 60 days depending on the day they happened to
declare. A cancellation now lands on the first period end that actually serves the notice, so a
misconfiguration costs a longer wait instead of a promise the software cannot keep.

**An add-on has no notice period at all.** Cancelling one takes effect at the end of the booking's
own period, or at its minimum term where that runs longer, or at the plan's end where that comes
first — whenever it is declared, including on the last day. That was already the behaviour and is
now the decision: an add-on hangs off the plan that pays for it, its commitment is the minimum
term, and a second waiting period on top is one nobody could explain to a customer. A test refuses
any reference to the notice machinery from the bundle path, so the rule cannot drift back in.

### A contract line records the currency and the tax it was booked with

`ContractLineItem` gains three required columns: `currency`, `taxRate` and `taxAmount`. An
installation configures one currency and one rate at a time, so a line never chooses them — but a
row has to keep meaning what it meant after either is changed, and changing a currency once
contracts exist is a migration rather than an edit precisely because it must not relabel history.

`taxRate` is stored even though net and gross both are, because the ratio between them is not the
rate: it cannot be reproduced for a gross that was rounded, it cannot express an exempt or a
reverse-charge line, and it does not survive a rate change. `taxAmount` is the gap between the
line's own net and gross, so the row cannot disagree with itself and no reader has to round a
second time.

```prisma
model ContractLineItem {
    // …
    currency  String                        // new: ISO 4217, as booked
    taxRate   Decimal @db.Decimal(5, 2)     // new: per cent, as applied
    taxAmount Decimal @db.Decimal(10, 2)    // new: priceGross − priceNet
}
```

**Run the migration once, against your database**, and before `db push` — the columns are NOT NULL,
which `db push` cannot add to a table that already holds rows:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-line-items-record-their-money.postgres.sql
```

It adds the columns, fills them from each line's own contract — `priceSnapshot` already records the
currency and the VAT rate that were agreed, written in the same moment as the lines — and only then
makes them required. It will not invent a currency or a rate: a contract whose snapshot does not
state one, or states a rate that is not a number from 0 to 100, or a rate between 0 and 1 — the
shape of a fraction — **stops the migration and is named**, with nothing half-applied. Running it
again does nothing, and on a database whose schema already has the columns it does nothing at all.

**List what it would refuse, before you run it.** An empty result means it will go through. Run it
against the database as it stands, before the columns exist:

```sql
WITH snapshot AS (
    SELECT c."id", c."tenantId", c."priceSnapshot" AS s,
           jsonb_typeof(c."priceSnapshot" -> 'currency') = 'string'
               AND c."priceSnapshot" ->> 'currency' <> '' AS has_currency,
           CASE WHEN jsonb_typeof(c."priceSnapshot" -> 'vatRate') = 'number'
               THEN (c."priceSnapshot" ->> 'vatRate')::numeric END AS rate
      FROM "subscription_contracts" c
     WHERE EXISTS (SELECT 1 FROM "contract_line_items" li WHERE li."contractId" = c."id")
)
SELECT id, "tenantId", s -> 'currency' AS currency, s -> 'vatRate' AS rate
  FROM snapshot
 WHERE has_currency IS NOT TRUE
    OR rate IS NULL
    OR rate < 0
    OR rate > 100
    OR (rate > 0 AND rate < 1)
 ORDER BY id;
```

Every tax rate in SaaSiCat is a percentage: `19` means 19 %. The migration records the rate a
snapshot states as it stands and converts nothing, so a contract whose `rate` is between 0 and 1 —
a fraction such as `0.19` — is reported and refused. If your application stored rates as fractions,
convert those snapshots to percentages before you run the migration. A line the migration fills
that already carries a `taxRate` of its own, which this query does not read, is held to the same
rule. The query answers for contracts that have line items, which are the ones the
migration fills; to find every snapshot that still states a fraction, run it without its
`WHERE EXISTS` line.

Repair those snapshots to say what was actually agreed — they are the record the lines are filled
from, so a wrong value here becomes a wrong value on every line of that contract.

**Every tax rate is a percentage, and nothing reads it another way.** `config/saas.yaml`,
`priceBreakdown.vatRate` on a checkout offer, `SubscriptionContractPriceSnapshot.vatRate` and
`ContractLineItemRecord.taxRate` all state 19 for 19 %.

- **A `vatRate` between 0 and 1 in `config/saas.yaml`** does not load; it is the shape of a
  fraction.
- **`SubscriptionContractService`** refuses a contract whose `priceSnapshot.vatRate` or any line's
  `taxRate` is not a percentage, with `SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT`, whichever way it
  is created. An offer the server priced always passes; create a new offer for one that does not.
- **`vatPercentFromOfferRate` is gone** from `@saasicat/nest/subscription-contract`. Code that
  called it reads the rate as it stands.

**`SubscriptionContractService.create` now refuses a line that disagrees with its contract** —
`SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH` where `taxAmount` is not exactly
`priceGross - priceNet`, and `SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH` where the line's
currency is not the one the contract was priced in. Both platform paths satisfy them, so these only
reach you if you build line items yourself and hand them to `create` — a contract is append-only,
and an invoice stating one currency in its total and another on every line is a record nobody can
correct afterwards.

**If you implement the ports yourself, your build breaks here, on purpose.**
`ContractLineItemRecord`
and `InvoiceLineItemSnapshot` require the three fields, so a repository adapter stops compiling
until it reads and writes them. `NewContractLineItemData` requires them too — but the one port a
consumer supplies lines through, `ContractFreezeSourcePort.loadBookedBundles`, deliberately does
**not**: its `lineItems` are `PricedContractLineItem`, which is the same shape without the three.
A source prices what it sells; the platform records the installation's currency and rate. If your
adapter annotates its result as `NewContractLineItemData[]`, drop the annotation or change it:

```ts
import type { ContractFreezeBundleSnapshot } from '@saasicat/nest';

async loadBookedBundles(…): Promise<ContractFreezeBundleSnapshot> {
    const lineItems = booked.map((booking) => ({ …, priceNet, priceGross }));
    return { lineItems, bundleVersionIds };
}
```

### The platform records the configuration it applied

Two tables arrive, both additive: `applied_settings` holds the one row that says which settings the
installation applied at its last start — the resolved values, a fingerprint over them, when they
took effect and from which file — and `settings_changes` holds one row per start that found the
fingerprint moved. `GET /admin/settings` shows both. No setting is ever read out of them: the
record is a mirror of `config/saas.yaml`, never a source of settings. From 1.0 it is read for
one thing that is not a setting — which legal entity the installation last ran as — and there it
decides only whether the start continues (see the issuer section below).

```prisma
model AppliedSettings {
    id          String   @id @default("installation")
    fingerprint String
    settings    Json
    source      String
    appliedAt   DateTime

    @@map("applied_settings")
}
```

**Run `sql/1.0-the-applied-settings-are-recorded.postgres.sql`** once, before `db push` where you
use one — the same way as the other files in this directory:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-the-applied-settings-are-recorded.postgres.sql
```

It creates both tables and the index only where they are missing, and adds the `CHECK` that holds
`applied_settings` to one row. Safe to run again; on a database created from the reference schema it
does nothing at all. Nothing to list beforehand: it changes no rows.

**Run `sql/1.0-a-settings-change-carries-its-order.postgres.sql`** as well, the same way:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-a-settings-change-carries-its-order.postgres.sql
```

It adds `seq` to `settings_changes`: the order the changes were recorded in, numbered by the
database at each write, which is what the list is read by. Rows already there are numbered in the
order they were listed until now, so nothing changes place; where the column exists the file does
nothing. On the Prisma path the `SettingsChange` model carries
`seq Int @unique @default(autoincrement())`.

**A page appears:** `SettingsPage` at `/admin/settings`, under _System_ in the sidebar, mounted
by `standardAdminChildren()` like the others. It shows what is running, since when and from
where, and what changed at the last start, with the one action of marking a change as seen; it
edits nothing. The sidebar entry stays whoever serves the route: an app that passes
`includeSettingsController: false` answers `GET /admin/settings` itself and keeps the page.

**A route appears:** `GET /admin/settings`, behind `controller.guards` and `SuperAdminGuard` like
the manifest and discovery, answers the resolved settings and the absolute path of
`config/saas.yaml`. An app that already serves that path, or does not want the platform to, passes
`includeSettingsController: false` — the record is kept and compared at boot either way, only the
endpoint is left out.

On the Prisma path, `saasicat schema check` reports the two models until you copy them from
`prisma-fragments/12-applied-settings.prisma` into your `schema.prisma`. An installation whose
persistence adapter provides no `core.appliedSettings` port still starts — the platform says once,
at
boot, that it is not recording — so a custom adapter is not broken by this, only silent until it
implements `AppliedSettingsPort`.

### `dbCatalog` names the file

On the database path, `dbCatalog` **takes the path of `config/saas.yaml`** and nothing else. It
used to take the settings as values — `app`, `currency`, `vatRate`, `tenantBilling`, `marketing`
and `notifications` — and every application forwarded them from the file it had loaded anyway:

```ts
// before
dbCatalog: {
    app: SAAS_CONFIG.app,
    currency: SAAS_CONFIG.currency,
    vatRate: SAAS_CONFIG.vatRate,
    tenantBilling: SAAS_CONFIG.tenantBilling,
    marketing: SAAS_CONFIG.marketing,
},
// after
dbCatalog: { path: 'config/saas.yaml' },
```

The platform reads the file itself. The settings come from it, the plans and the features come
from the read sink, and a `plans:` block still in the file — the seed for `saasicat catalog
import` — is not read on this path. `${NAME}` references resolve from `process.env` unless
`dbCatalog` passes an `env` of its own, exactly as `loadPlanCatalogFromFile` does.

Why: forwarding by hand held "the file defines, nothing else does" by agreement rather than by
construction. Nothing stopped an application typing a notice period straight into the block, and
the record of the applied settings had no file to name on this path, only a sentence saying the
values came in as code. Now there is nothing in the option to type a setting into, and the record
names the file on both paths.

**A `dbCatalog` that still carries the values refuses the boot** —
`catalog.db-catalog-names-the-file`,
naming what the option takes now — rather than being read: the values it carries are the ones the
operator believes are running. So does one that names the path and still carries a value beside
it, and that refusal names the value: an upgrade that stopped halfway must not run on the file
while looking as if it ran on the value. `saasicat codemod v1` names every such block with its
file and line — the values it carries, or the ones left beside the path — and does not rewrite
it: which file the values were forwarded from is a variable in another module more often than a
literal, and a guess would be wrong quietly. An application that loads the file for its own use
keeps doing so; the platform reads it once more, which costs a parse at start and nothing after.

### Every operator route requires the platform administrator

`SaaSiCatModule.forRoot` runs `SuperAdminGuard` after `controller.guards` on every operator route
it mounts: the administration, the catalogue, discovery, the admin manifest, the settings endpoint,
promo codes and statistics. `controller.guards` establishes who is calling, so it holds
`[JwtAuthGuard]` or its equivalent and not a role check — the tenant manifest falls back to the same
list, and a role check there would lock tenants out of their own manifest.

- **`SuperAdminGuard` listed in `controller.guards`** keeps working; the check runs twice. Drop it
  from there.
- **`controller: { guards: [] }`** no longer leaves these routes without a check. A test that calls
  one needs a signed-in platform administrator on the request.
- **Low-level modules wired by hand** — `CatalogModule`, `DiscoveryModule`, `AdminManifestModule`,
  `SettingsModule`, `PlanCatalogImporterModule` — take their whole guard chain from you as before.
  Make sure it ends in `SuperAdminGuard`.

### Lasting operator actions require the second factor

Publishing a plan or bundle version, ending a plan version, purging a plan, importing a catalogue,
and suspending or reactivating a tenant require a one-time code in the `X-Mfa-Code` header. The
check sits on those handlers rather than in a guard list, so neither `controller.guards`, an
`adminResources.guards` override nor the chain of a module wired by hand can leave it out.

- **Every platform administrator who takes these actions** needs a second factor set up, as the
  setup wizard or the `admin mfa-setup` command from [Extend your CLI](extend-your-cli.md) enrolls
  one. Without it the request is refused with `MFA_NOT_SET_UP`.
- **The shipped plans and bundles pages** ask for the code before each action, and the tenant pages
  already did. A tenant-action handler you register for `tenants.suspend` or `tenants.reactivate`
  has to pass the `mfaCode` it receives on: `suspendTenant(slug, reason, mfaCode)`,
  `reactivateTenant(slug, mfaCode)`, and the same last argument on the `tenants` resource.
- **Your own calls** to `usePlans().hardDelete`, `usePlanVersions().publish`,
  `usePlanVersions().terminateVersion`, `useBundleVersions().publish` or the matching resource
  operations ask for the code first and pass it as the new last argument. `mfaHeader(code)` builds
  the header, and sends nothing for an empty code.
- **`request.user`** is read as `id` or `userId` by `MfaGuard`, the same pair the admin controllers
  read the actor from.
- **Low-level modules wired by hand** that carry one of these routes — `CatalogModule`,
  `AdminResourcesModule`, `PlanCatalogImporterModule` — need `MfaService` resolvable, which
  `AdminModule` provides; without it the application does not start.

### A checkout offer is priced from the catalogue

`POST /public/checkout-offer`, `PATCH /public/checkout-offer/:id`, `CheckoutOfferService.create` and
`CheckoutOfferService.update` take a selection and nothing else: `planKey`, `billingCycle`,
`bundleVersionIds`, `promoCode`, `locale` and `validUntil`, typed as `CheckoutOfferSelection` and
`CheckoutOfferSelectionUpdate`. The server computes the plan price from the plan version on sale,
each add-on's price for that plan, the promotion the public catalogue picks, the promo code
discount, and the currency and VAT rate from `config/saas.yaml`.

- **A pricing page that posts amounts** drops `priceBreakdown`, `lineItems`,
  `promotionSnapshots`, `promoCodeSnapshot`, `planVersionId`, `promotionId` and `bundles`, and reads
  the amounts back from the offer the route returns. With the usual `ValidationPipe`
  (`whitelist: true`) the old fields are stripped, so nothing breaks at the route; the amounts the
  page computed are simply not used.
- **Code that calls the service with line items**, such as a registration step that builds its own
  plan line, passes the selection instead. The TypeScript types refuse the old input.
- **A promo code** is part of the selection. Rewriting an offer's breakdown after redeeming a code
  is no longer possible and no longer needed: the offer already carries the discount the promo
  module accepts.
- **`priceBreakdown.vatRate`** is a percentage (`19`), as every tax rate is. Code that multiplied by
  `1 + vatRate` computes `1 + vatRate / 100`, and a contract created from an offer takes the rate
  as it stands.
- **Consuming an offer** computes its amounts again from the plan and bundle versions it froze and
  refuses one whose stored amounts differ, or that names no plan version, with
  `CHECKOUT_OFFER_PRICE_NOT_CURRENT`. An offer created before the upgrade can hit this; create it
  again from the same selection. Its promo code is checked with the promo module as it stands at
  consumption, because a code is redeemed when the contract is concluded: a code that expired or ran
  out of redemptions since the offer was priced refuses the offer with
  `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED`. Conclude the offer rather than consuming it, so a
  refusal leaves nothing half-created (next section).
- **New refusals:** `CHECKOUT_OFFER_PLAN_NOT_OFFERED`, `CHECKOUT_OFFER_BUNDLE_NOT_OFFERED` (with a
  `reason`) and `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED`.
- **Wiring `CheckoutOfferModule` by hand** needs `planRepository`, and `promotionRepository` for
  promotions; the plan catalogue module has to be registered for the currency and VAT rate, and the
  promo module has to be visible for a promo code. `SaaSiCatModule.forRoot` does all of that itself.

### A checkout offer is concluded with its contract in one step

An application completing a sign-up consumed the offer, started its own subscription and created
the contract, one after the other. A contract refused in the last step, for a tax rate that is not a
percentage or a plan not sold in the rhythm, left a consumed offer and a started subscription with
nothing agreed, and a second attempt skipped the consume and failed the same way.
`CheckoutOfferService.conclude(offerId, options, within)` does all three on one transaction:

```ts
const { contract } = await checkoutOffers.conclude(
    offerId,
    { tenantId, effectiveFrom },
    async (tx, { offer }) => {
        const subscription = await subscriptions.start(tenantId, offer, tx);
        if (offer.promoCode) {
            await promoCodes.redeemInTransaction(
                { code: offer.promoCode, subscriptionId: subscription.id, tenantId, email },
                tx,
            );
        }
    },
);
```

- **What can refuse is asked first**: everything `consume` checks, and the checks the contract is
  held to. Then the offer is consumed, the contract written and `within` run; an error in any of
  them undoes the rest, and the offer stays open for another attempt.
- **Redeem the promo code in `within`**, on `tx`. Before the transaction the code is checked only as
  pricing checks it, and nothing checks it again afterwards, so a redemption that takes the last
  slot no longer refuses the offer it was redeemed for, and one that is refused, for a customer who
  is not new or a code already exhausted, undoes the conclusion.
- **An offer concluded already** answers with its contract when it was concluded for the same
  tenant, and `within` does not run again; for another tenant it is refused with
  `CHECKOUT_OFFER_ALREADY_CONSUMED`. An offer changed after its checks, by another tab on the same
  link, is refused with the new `CHECKOUT_OFFER_CHANGED` and nothing is written: load it and
  conclude again.
- **`SaaSiCatModule.forRoot` wires it** where the persistence bundle has a subscription contract
  repository and a transaction runner. By hand, pass `conclusion: { subscriptionContractRepository,
transactionRunner }` to `CheckoutOfferModule.forRoot`. Without it, `conclude` refuses to run.
- **Your `CheckoutOfferRepository`** writes `consume` on `tx` when one is passed, and only while the
  offer is `open`, refusing it otherwise — one condition on the write, not a read before it. Wire
  it into your persistence contract harness as `checkoutOfferRepository`, which holds both; a
  harness without it declares `gaps: ['checkoutOffers']`.
- **A `SubscriptionContractRepository` of your own** takes `tx` on `create` and implements
  `findByOriginalOfferId`. Both shipped adapters do.

### The configurator's yearly price is the plan version's

The sign-up configurator showed a yearly price of the monthly price times
`ConfiguratorCatalog.cycleDiscount`, while the offer and the contract charge the yearly price the
plan version carries. Where the two differed, say 9.99 a month and 99.00 a year, the configurator
showed 99.90 and a promo code preview worked on that figure. `computeBreakdown` now takes each
model's `yearlyNet`, and the saving it reports is twelve monthly prices minus that, never below
zero.

- **`ConfiguratorCatalog.cycleDiscount` and `ConfiguratorMarketingProvider.getCycleDiscount()` are
  gone.** Delete `getCycleDiscount` from your marketing provider; an object literal typed as the
  provider no longer compiles with it.
- **A registration page that computed a yearly price or a saving from `cycleDiscount`** displays
  the breakdown the server returns, or reads `model.yearlyNet`.
- **A promo discount is taken off in net.** `RegistrationPromoPreview.discountAmount` is the gross
  discount against `subtotalGross`, which is what `PromoCodesService.preview` reckons and what an
  adapter wrapping it returns; `computeBreakdown` converts it at `vatRate` before taking it off,
  as the offer does, and `ConfiguratorPriceBreakdown.discountAmount` is that net figure. An adapter
  that returned a net amount returns the gross one.

### A plan is sold only in a rhythm it carries a price for

A plan without a yearly price is a monthly plan, and one without any price is sold on request. The
tenant's pages showed such a plan at ten monthly prices a year, the plan change accepted it, and
the contract recorded its plan line at 0.00.

- **`PLAN_NOT_SOLD_IN_CYCLE`** is a new plan-change blocker, with `planName`, `planKey` and
  `billingCycle`. The plan change and the onboarding choice refuse such a plan through it, and
  `SubscriptionContractFreezeService.freezeOnPlanChange` refuses it before the contract in force is
  closed. A plan that is not marketed is sold under a special contract and is not affected.
- **A subscription already in such a rhythm is not moved.** Only a catalogue in `config/saas.yaml`
  can hold a marketed plan without a price for a rhythm, because a stored plan version carries
  both, so an installation on the database catalogue has none. With a YAML catalogue, take its
  marketed plans without `yearlyNet`, and those without any price, and find their tenants before
  upgrading:

    ```sql
    SELECT "tenantId", "plan", "billingCycle" FROM "subscriptions"
    WHERE ("plan" IN ('BASIC') AND "billingCycle" = 'YEARLY')  -- plans without yearlyNet
       OR "plan" IN ('CUSTOM');                                -- plans without any price
    ```

    Give each plan the price for the rhythm its tenants are on, or move them to a rhythm it is
    priced for. Until then every contract freeze for them — an add-on booked or cancelled — is
    refused, and its callers only log the refusal, so the contract stops following their bookings.

- **`DEFAULT_YEARLY_FACTOR` and the `yearlyFactor` option of `useSubscriptionDraft` are gone.**
  `DraftPricing.planPriced` says whether the selected plan carries a price for the cycle; a bundle
  without one is neither charged nor sent while that cycle is chosen.
- **`PlanGrid`, `PublicBundleGrid` and `OnboardingConfigurator` take `notSoldInCycle`** in their
  `i18n`, beside `priceOnRequest`; `TenantPlanSectionI18n` gains `wizardNotSoldInCycle`, which the
  shipped German and English maps carry. A card without a price for the cycle says so and cannot be
  chosen.
- **The configurator's promo discount is the server's.** `PromoPreviewValidResponse.price` carries
  `discountNet`, the preview's gross discount on the plan price converted at the installation's VAT
  rate, and `useSubscriptionDraft` takes it off the plan — not off the bundles beside it. Changing
  the plan or the cycle sets the promo state back to `idle`; `OnboardingConfigurator` asks the
  preview again by itself, and a page built on the composable does the same.
- **`PlanCatalogImporterService` skips a plan without `yearlyNet`** with a warning, as it skips one
  without `monthlyNet`, instead of storing ten monthly prices as its yearly price. A stored plan
  version carries both prices; give the plan a yearly price in `saas.yaml`, or publish its version
  in the administration.

### A port the harness leaves out fails the persistence contract

`persistenceAdapterContract` from `@saasicat/persistence-testing` used to report a scenario group
as skipped when the harness did not provide its port or seed writer, so a suite could pass with a
whole group unchecked. That group now fails and names the part. Groups that the adapter's
`capabilities` rule out, such as the lock scenarios with `pessimisticLocking: false`, still skip.

- **A harness that wires every port its adapter ships** changes nothing. What a port ships can
  follow its options: `@saasicat/adapter-prisma` adds `findActivePlanVersion` only with
  `planVersionFields.catalog.validityWindows`, `findActiveBundleVersion` only with the bundle
  repository's `validityWindows`, and `applyOnboardingSelection` only with
  `tenantSubscription.atomicOnboardingSelection` — all off by default, for a 0.6 schema. Without
  them `planLifecycle`, `bundleValidity` and `atomicOnboarding` are gaps, and with them they are
  not, so derive `gaps` from the same options instead of writing a constant:
  `gaps: validityWindows ? [] : ['planLifecycle', 'bundleValidity']`.
- **A gap name that is not a part of the contract** fails the suite as unknown.
- **A harness that leaves a part out on purpose** lists it in the new `gaps` option:
  `gaps: ['appliedSettings']`. Its scenarios report as skipped, as before. `ContractGap` lists the
  names.
- **A gap listed there that the harness does provide** fails the suite, so the list cannot outlive
  the port it excused.
- **`checkoutOffers` is a gap for both shipped adapters**, which ship no `CheckoutOfferRepository`.
  An application that implements one wires it as `checkoutOfferRepository`; the contract then
  checks that an offer is consumed once and that a consume on a rolled-back transaction leaves it
  open.

### `projectKey` is gone from the database

One installation serves one application. A plan key, a bundle key, a feature key and a quota key
are unique for the whole installation, and nothing carries a project above them.

The column never had a second value to hold. Nothing in the platform could configure a second
project — `config/saas.yaml` names one, `compose/base.ts` resolves it once at boot, and there is no
per-request switch — while `subscriptions.tenantId` is unique installation-wide, so a customer of
two applications in one database could not exist. What the column did do was contradict the schema
beside it: `plan_versions.planId` holds the plan **key** and no project, so two plans sharing a key
shared one version lineage, and `plan_versions_draft_per_plan` then stopped the second one from
opening a draft at all.

**Ten tables lose it:** `plans`, `bundles`, `capability_catalog_entries`,
`feature_catalog_entries`, `quota_catalog_entries`, `marketing_projections`, `marketing_settings`,
`promotions`, `checkout_offers`, `subscription_contracts`. Every `(projectKey, <key>)` unique index
becomes `(<key>)`, and the composite lookup indexes lose their first column.

**Run the migration once, against your database:**

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-remove-project-key.postgres.sql
```

**If your dev setup uses `prisma db push`**, run the file before it, not instead of it. `db push`
refuses a change that would drop a column holding data — `Use the --accept-data-loss flag` — and it
is right to: it cannot know whether those rows still matter. Do not add the flag; it would arm every
future schema change to discard data without being asked. Run the migration, which checks the rows
first, and `db push` then has nothing destructive left to do.
`examples/notesapp/docker-entrypoint.sh` does exactly that, in that order.

It opens a transaction and starts with a guard: if those tables between them hold rows under more
than one project key, it **stops and names which table held which** rather than merging rows nobody
meant to merge — two `STANDARD` plans would collide on the new unique index, and which of them
survives is not a decision a migration should take. Delete the rows that do not belong to this
installation, then run it again. It is a one-way door — the values are dropped, not archived — but
running it twice is safe: a table whose column has already gone is skipped, so a second run does
nothing rather than failing.

It is also safe on a **partial** schema. The Prisma fragments are adopted à la carte, and each
table's changes are made only where that table exists — an app that never took `bundles` migrates
the tables it does have instead of rolling the whole thing back.

One thing the migration adds rather than removes: a `CHECK` that keeps `marketing_settings` to a
single row. It used to be a convention resting on a default, and a default does not apply to a
caller that supplies the value.

**In your code**, `v1-project-key` removes what it can decide:

| before                                                          | after                                     |
| --------------------------------------------------------------- | ----------------------------------------- |
| `projectKey: myapp` in `config/saas.yaml`                       | gone — `app.name` is now required instead |
| `dbCatalog: { projectKey, currency, vatRate }`                  | `dbCatalog: { path: 'config/saas.yaml' }` |
| `{ apiBase: '…', projectKey: 'myapp' }` (`SuperAdminEndpoints`) | `{ apiBase: '…' }`                        |
| `?projectKey=…` on a `/catalog/` URL                            | gone — those endpoints no longer read it  |
| `plans.create({ projectKey, planKey, … })`                      | `plans.create({ planKey, … })`            |
| `usePlans({ adminEndpoint, projectKey, http })`                 | `usePlans({ adminEndpoint, http })`       |

**It rewrites two of those and prints the rest.** The two it rewrites need no grammar to decide: a
`?projectKey=` on a `/catalog/` URL — the prefix every endpoint that read it sat under — and the key
in `config/saas.yaml`, a file whose schema this platform owns.

**Your `schema.prisma` it prints too, and does not touch.** If you copied the platform's models
into it — the documented path — it declares `projectKey` fields and `@@unique([projectKey, …])`
indexes of its own. Those have to go, or the generated client queries columns the database no longer
has and the next `db push` tries to put them back. Which fields your models still need is yours to
say, so the codemod names the lines and leaves the edit to you.

**Every object member it prints, by file and line.** Not because the shapes are unclear, but because
telling one apart from a declaration of your own is not something a text scan can do: in TypeScript
`{ projectKey: 'app', apiBase: string }` is a valid _type_ and `{ projectKey: 'app', apiBase: '/a'
}`
is a valid _value_, and they are the same tokens. A codemod that guessed would occasionally delete a
member of your own interface, and you would find out later. So it errs towards leaving work for you
rather than removing yours.

The list it prints is the work: the table above says what each shape becomes, and one editor pass
per shape does it — `projectKey: 'myapp',` appears identically in most places it appears at all.
`old_projectKey` and `projectKeys` are not reported; they are not this identifier.

**Three more things move with it.** `app.name` is now **required** in `config/saas.yaml`: it is the
one place the application names itself, and it is what the manifest and the login page display.
`PublicMarketingCatalogResponse` no longer carries `projectKey`. And four error messages lost the
phrase — `PLAN_ALREADY_EXISTS` now reads `Plan 'STANDARD' already exists`, and its `params` no
longer carry the key. Nothing in the admin UI, the tenant UI, the CLI or the example app read that
parameter, so a message you render from the catalogue is unaffected.

**`saasicat init` renamed its flag** to match: `--project-key` is `--app-key`, and so is
`pnpm create saasicat-admin`'s. It is now what it always did — the slug of the application, used
for the npm package name, the storage prefix and the generated identifiers — and it is no longer
written into `config/saas.yaml`.

### A plan key no plan has reads as nothing

`@saasicat/persistence-testing` checks two reads of `PlanRepository` it did not check before. A key
no plan row has answers `listVersions`, `findCurrentDraft`, `findLatestLivePlanVersion`,
`findActivePlanVersion`, `PlanVersionRepository.findLatestLive` and
`PlanVersionRepository.findActive`
with an empty list or `null`,
not an error: a plan can go between listing the catalogue and reading its versions. A retired plan
keeps its versions readable, because the guard that decides whether a plan may be deleted counts
them.

- **`@saasicat/adapter-prisma` and `@saasicat/adapter-drizzle`** behave that way; nothing to do.
- **An adapter of your own** that throws for an unknown key, or filters retired plans out of those
  reads, fails the new scenario until it answers the same way.

### A contract names the subscriber it is concluded with

A contract hung on the tenant and said nothing about whom it was concluded with, and the fragment
suggested a cascade from the tenant, so deleting a tenant deleted the record of what it had agreed
to. A tenant now holds the application's data, and the **subscriber** is the party to the contract:
a customer number and the master data a contract names ([ADR
0012](../explanation/adr/0012-the-subscriber-owns-the-commercial-record.md)).
A contract belongs to its subscriber and copies both parties on the day it is concluded, and no
contract is written, no plan changed and no add-on booked for a tenant without one.

```prisma
model Subscriber { /* new — 13-subscriber.prisma, with SubscriberTenant and SubscriberCorrection */ }

model SubscriptionContract {
    // …
    subscriberId       String                    // new: the party the contract is with
    subscriberSnapshot Json                      // new: that party, as it stood
    issuerSnapshot     Json?                     // new: the issuer, as config/saas.yaml named it
    partiesMigrated    Boolean @default(false)   // new: the copies were made by the migration
    subscriber Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Restrict)
    // tenant Tenant @relation(…, onDelete: Cascade)   <- remove this line and Tenant's back-relation
}
```

**Remove the relation from `SubscriptionContract` to your `Tenant` model**, and the list of
contracts on `Tenant`. `tenantId` stays as a trace of the tenant the contract was concluded for. A
cascade there deletes the tax record with the tenant, and a restriction keeps the tenant from ever
being deleted. `saasicat schema check` fails while it cascades.

**Run the migration once, against your database**, and before `db push`:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-a-contract-names-its-subscriber.postgres.sql
```

It creates the three subscriber tables and the new contract columns, gives every tenant that has a
subscription or a contract a subscriber of its own, numbered from 10001 in the order the tenants
came in and marked `migrated`, attaches each contract to it with a copy marked `partiesMigrated`,
and makes the link required. It copies no issuer: it cannot read `config/saas.yaml`. Once the link
is required, a later run by a role that owns the tables does nothing, under row-level security too,
and on a database whose schema already has the tables it does nothing at all. That includes a tenant
created since without a subscriber: your application gives it one, and a tenant created while the
migration was already in place but your application's upgrade was not gets its subscriber from the
statement under "When the migration cannot name a tenant".

Where `subscription_contracts`, `subscriptions` or your tenant table is under row-level security,
run the migration as a role that bypasses it; a role that would see only some of their rows is
stopped before a subscriber is created, with the table named. The three new tables carry no
policy: `subscribers` has no `tenantId`, so a tenant policy for it goes through
`subscriber_tenants`.

The legal name comes from your own tenant table, which the migration finds through the foreign key
you declared on `subscriptions."tenantId"` — or on `subscription_contracts."tenantId"` — and its
`name` column. To number the migrated subscribers with the prefix your installation will use, set
it for the session:

```bash
psql "$DATABASE_URL" -c "SET saasicat.customer_number_prefix = 'K-'" \
     -f node_modules/@saasicat/spec/sql/1.0-a-contract-names-its-subscriber.postgres.sql
```

**List what it will create, before you run it.** Replace `tenants` and `name` with your tenant
table and the column it takes the legal name from:

```sql
SELECT t."tenantId", a."name" AS "legalName"
  FROM (SELECT "tenantId" FROM "subscriptions"
        UNION
        SELECT "tenantId" FROM "subscription_contracts") t
  LEFT JOIN "tenants" a ON a."id" = t."tenantId"
 ORDER BY t."tenantId";
```

A row without a `legalName` is one the migration refuses: it will not name a subscriber after an
identifier.

**When the migration cannot name a tenant.** Without such a foreign key, without a `name` column,
or for a tenant whose row is gone or whose name is empty, the migration stops and names the
tenants. The tables are in place by then. Create those subscribers with this statement, adapted to
where your application keeps the legal name — and for a tenant whose row is gone, with the name from
your own records — then run the migration again:

```sql
CREATE TEMP TABLE saasicat_subscriber_source AS
SELECT t."id" AS tenant_id, btrim(t."name") AS legal_name, gen_random_uuid()::text AS subscriber_id
  FROM "tenants" t
 WHERE (EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."tenantId" = t."id")
        OR EXISTS (SELECT 1 FROM "subscription_contracts" c WHERE c."tenantId" = t."id"))
   AND NOT EXISTS (SELECT 1 FROM "subscriber_tenants" l
                    WHERE l."tenantId" = t."id" AND l."unlinkedAt" IS NULL);

INSERT INTO "subscribers" ("id", "customerNumberPrefix", "legalName", "migrated", "updatedAt")
SELECT subscriber_id, '', legal_name, true, CURRENT_TIMESTAMP
  FROM saasicat_subscriber_source ORDER BY tenant_id;

INSERT INTO "subscriber_tenants" ("id", "subscriberId", "tenantId")
SELECT gen_random_uuid()::text, subscriber_id, tenant_id FROM saasicat_subscriber_source;
```

Put your prefix in place of `''`.

**Create the subscriber wherever your application creates a tenant**, on the same transaction.
SaaSiCat creates no tenants, so it cannot do it for you:

```ts
import { SubscriberService } from '@saasicat/nest/subscriber';

await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: dto.companyName /* … */ } });
    await subscribers.createForTenant(
        tenant.id,
        { legalName: dto.companyName, vatId: dto.vatId, country: dto.country },
        tx,
    );
});
```

Only the legal name is required; the address, the country (ISO 3166-1 alpha-2), the VAT id, the tax
number and the invoice email are recorded where given. The customer number is assigned then, behind
the prefix `config/saas.yaml` names, and never changes. `SubscriptionContractModule` provides
`SubscriberService`; `SubscriberModule` does on its own.

- **A sign-up** creates the subscriber in `ActivationOrchestrator.activate`, before any contract,
  and returns it: `FinalActivationResult` gains `subscriberId`. Concluding an offer, pass
  `subscriber: subscriberFromRegistration(pending)` to `CheckoutOfferService.conclude`, which
  creates it on the transaction it concludes the offer on; otherwise call `createForTenant` on your
  transaction. See [self-registration](self-registration.md).
- **Refused without a subscriber, with `SUBSCRIBER_REQUIRED`**: `SubscriptionContractService.create`
  and `replaceActiveContract`, `CheckoutOfferService.conclude`, the contract freeze, and — where the
  contract freeze is wired — a plan change and booking or reactivating an add-on, before anything
  is written. Cancelling stays open. `conclude` refuses a `subscriber` for a tenant that has one
  with
  `SUBSCRIBER_ALREADY_EXISTS`.
- **Wiring.** `prismaPersistence` and `drizzlePersistence` supply
  `entitlement.subscriberRepository`, and `SaaSiCatModule.forRoot` wires it wherever contracts are
  written. By hand, `SubscriptionContractModule.forRoot`, the `conclusion` of
  `CheckoutOfferModule.forRoot` and `tenantBilling.contractFreeze` each take `subscriberRepository`
  beside `subscriptionContractRepository`, and refuse to start without it. `SubscriberService` reads
  the prefix and the issuer from `PLAN_CATALOG_SETTINGS_TOKEN`, so a `SubscriptionContractModule`
  wired by hand needs a `PlanCatalogModule` in scope, which `SaaSiCatModule.forRoot` provides
  globally.
- **`ContractFreezePort`** gains `assertPartyFor(tenantId)`, which the plan-change and add-on routes
  call before they write. An implementation of your own bound to `CONTRACT_FREEZE_PORT_TOKEN` adds
  it: refuse a tenant without a subscriber, as `SubscriptionContractService.assertPartyFor` does.
- **`SubscriptionContractRecord`** gains `subscriberId`, `subscriber` and `issuer` — the parties as
  copied at conclusion, the issuer `null` where none was named — and `partiesMigrated`. A
  `SubscriptionContractRepository` of your own writes `data.parties` on `create`.
- **`config/saas.yaml`** takes an optional `issuer` — `legalName`, and optionally `addressLine1`,
  `addressLine2`, `postalCode`, `city`, `country`, `vatId`, `taxNumber` — which every contract
  copies
  from then on, and `subscribers.customerNumberPrefix`.
- **Your persistence contract harness** wires `subscriberRepository` and the seed writer
  `createSubscriber({ legalName })`, which the contract scenarios need for the party a contract
  names; a harness without the port declares `gaps: ['subscribers']`, and one without the seed
  writer `gaps: ['subscriptionContracts']`.
- **A copy the migration made says so**, with `partiesMigrated`: either party may have changed
  since the contract was concluded, so such a copy is never shown as what was agreed.

### A payment method is taken through a gateway

A payment method is entered in the payment gateway's own form now, and SaaSiCat keeps the gateway's
reference to it for the subscriber. Self-registration activates once the gateway confirmed the
payment method, and the confirmation is claimed and activated on one transaction. How to wire it is
[payment methods through a gateway](wire-the-backend.md#payment-methods-through-a-gateway); what
changes for an application that already runs:

**Run the migration once, against your database**, after
`1.0-a-contract-names-its-subscriber.postgres.sql` and before `db push`:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-a-payment-method-is-a-gateway-reference.postgres.sql
```

It creates `subscriber_payment_methods` and `subscriber_payment_method_setups`, makes a gateway
event unique per account in
`"PaymentEventLog"` — an event recorded before carries its `provider` as its account — and adds the
billing details, `checkoutGatewayAccount` and `gatewayCustomerRef` to `"PendingRegistration"`. Each
part is skipped where its table is missing, and a second run does nothing. A sign-up whose checkout
started before the migration has no account beside its session and repeats step 4.

Two things that catch people here. The backfill writes `gatewayAccount = provider`, which is right
for the first run — every row came from the one account — and wrong for any down-migration you write
afterwards, where it turns an account name back into a provider name. And **`constraints.postgres.sql`
grows between releases**: it gained
`subscriber_payment_methods_active_per_subscriber` and `payment_event_log_confirmation_per_session`
here. The migration above creates the first itself and the second only where `"PaymentEventLog"`
already exists, so an installation without self-registration never gets it. Run
`constraints.postgres.sql` after every jump, not once at set-up; it is written to be re-run.

**`persistenceAdapterContract` gains two gaps**, `subscriberPaymentMethods` and `paymentEventLog`. An
adapter that provides neither declares both and skips their scenarios; one that provides them
declares nothing and runs all of them. The harness names the gap in its failure message, so the
eighteen red scenarios tell you which line to add.

**Take the new fragment, and drop the old model once nothing writes to it.**
`SubscriptionPaymentMethod` and the enum `SubscriptionPaymentType` are gone from
`01-subscription.prisma`, with `Subscription.paymentMethod`; `SubscriberPaymentMethod` and
`SubscriberPaymentMethodSetup` and `PaymentEventLog` are in `14-payments.prisma`, and `Subscriber`
gains `paymentMethods` and `paymentMethodSetups`. The
migration leaves the old table and its rows alone, because they are your application's. Once your
application no longer writes there:

```sql
DROP TABLE IF EXISTS "subscription_payment_methods";
DROP TYPE IF EXISTS "SubscriptionPaymentType";
```

Nothing here copies those rows into `subscriber_payment_methods`: they hold what a form typed, not a
reference a gateway can charge, so each subscriber gives its payment method again.

**Wiring.**

- **`config/saas.yaml`** takes a `payments` block: the gateway accounts by name, and which one takes
  new payment methods with the `methods` it offers, and the `returnUrlOrigins` a success or cancel
  URL has to be at. `SaaSiCatModule.forRoot` takes
  `payments: { gateways }`, one adapter per account, and `prismaPersistence` and
  `drizzlePersistence` supply the new `persistence.payments` slice. By hand,
  `PaymentsModule.forRoot`
  from `@saasicat/nest/payments` takes the same pieces.
- **Create the application with `rawBody: true`**, and let a global authentication guard return
  early for `isSaaSiCatPublicRoute(reflector, context)`: the gateway's callbacks arrive at
  `POST /webhooks/payment/<account>` without a session and are verified against the exact bytes they
  arrived as.
- **Remove your own payment webhook route.** `PaymentWebhookDto` and
  `PendingRegistrationService.handlePaymentEvent` are gone, with `HandlePaymentEventInput`,
  `HandlePaymentEventResult` and `HandlePaymentEventReason`.
- **`RegistrationModule.forRoot`** no longer takes `paymentProvider` or `paymentEventLog`, and does
  not start without the payments module beside it. `PaymentProvider`, `CheckoutSession` and
  `PaymentEventStatus` are gone from `@saasicat/core`; a gateway adapter implements `PaymentGateway`
  instead, and `DevPaymentGateway` stands in for a dev stub of your own.
- **`ActivationOrchestrator.activate(pending)`** becomes `activate(pending, { tx })`. Write every
  row
  on `tx` and open no transaction of your own; pass `tx` to `CheckoutOfferService.conclude`, which
  now takes it, and to `SubscriberService.createForTenant`.
- **`PendingRegistrationRepository`**: `findByCheckoutSession(sessionId)` becomes
  `findByCheckoutSession(gatewayAccount, sessionId)`, `delete(id, tx)` deletes on the transaction it
  is handed — the activation deletes the sign-up there — and `findOpenCheckoutAccounts(now)` is new.
  Use the transaction: an implementation that ignores it still compiles, and then the sign-up
  survives a rollback it should not have survived. It also means the deletion is now part of the
  activation, so anything in your schema that can make it fail — a foreign key to
  `PendingRegistration`, a trigger — fails the whole activation, and every gateway retry repeats it.
  `PendingRegistration` gains `addressLine1`, `addressLine2`, `postalCode`, `city`, `country`,
  `vatId`, `taxNumber`, `checkoutGatewayAccount` and `gatewayCustomerRef`.
- **`startCheckout`** takes `billingDetails`: `addressLine1`, `postalCode`, `city` and `country` are
  required, and a missing one is refused with `SUBSCRIBER_DETAIL_INVALID`.
  `StartRegistrationCheckoutDto` validates them, and its URLs now require `http` or `https`.
  `subscriberFromRegistration(pending)` copies them onto the subscriber.
- **`PaymentEventLog`** is `claim(claim, tx)` instead of `tryClaim(eventId, payload)`, and the
  adapters implement it; a duplicate answers `false` without raising. So is a confirmation of a
  session the account has confirmed already, whatever its event identifier — the migration adds the
  partial unique index that holds it. `releaseSession(gatewayAccount, eventId, tx)` is the second
  method: it takes the session off a claim whose event changed nothing, so the event that does
  belong to that session is handled rather than answered as a duplicate. `RegistrationAuditEventType`
  loses `PAYMENT_DUPLICATE_IGNORED`: a duplicate callback is handled before any registration code
  sees it, and is logged rather than audited.
- **The tenant's plan page** shows the payment method in use to whoever holds the billing
  permission, and `GET`/`POST /billing/payment-method` require it: the tenant's administrator,
  unless `payments.billingPermissionGuards` names others.

**One refusal that needs nothing from you to arrive.** A start refuses when a payment method in use
is held at a gateway account `config/saas.yaml#payments.accounts` no longer names — and until 1.0
that check read `subscriber_payment_methods` without the RLS bypass, so on an installation with a
policy on that table it read nothing and passed. It reads through the bypass now. If you have such a
policy and a stored reference to a retired account, the first restart after this upgrade refuses:
list that account again with its gateway bound, until its subscribers have a payment method at
another one. Nothing in your file or your database has to change for this to be the restart that
finds it.

### The operator's own legal identity changes only as a declared correction

`config/saas.yaml#issuer` names the legal entity on your side of every contract, and a contract
copies it the day it is concluded. Its address and contact details still move freely and take effect
at the next start. Its `legalName`, `vatId` and `taxNumber` are the party a contract names, so a
start that finds one of them different from the one the installation recorded refuses, unless the
file declares the change a correction of that same entity:

```yaml
issuer:
    legalName: Example Software AG
    correctionOf:
        legalName: Example Software GmbH
        reason: Change of legal form, registered 2026-07-01
```

`correctionOf` names, for each identity field that moves, the value the record holds — `null` where
it holds none, which is how a tax number assigned later is declared. It is needed only for the start
that carries the change. The refusal names the contracts still running and what each was concluded
under; `<app> doctor` asks the same question before a deploy, as the new
`platform.issuer-identity` check.

**Two things you may not have had to think about before.** Taking the `issuer` block away once an
identity is recorded is refused the same way a changed one is, and it is the one shape a declaration
cannot rescue — `correctionOf` lives inside the block that is gone. That refusal prints the issuer
as the installation recorded it, address included, to write back. And `issuer.legalName`, `vatId`,
`taxNumber` and `correctionOf.reason` no longer accept a value made of whitespace: `vatId: "   "`
validated before 1.0 and now fails at schema validation, before the application assembles.

Nothing else is required of you unless you change that identity — but three things moved with it:

- **`SubscriptionContractRepository` gains `listRunningIssuers(limit, asOf?)`**: how many contracts
  are concluded and not yet over, and the first `limit` of them, oldest first, each with the legal
  name on its issuer copy or `null` where it names none. Running means `active` or `scheduled` and
  not ended at `asOf` — status alone would not do, because an ordinary cancellation writes only
  `effectiveUntil` and nothing flips the status when that day arrives. Both shipped adapters
  implement it; an implementation of your own adds it. The persistence contract covers it.
- **`SUBSCRIBER_IDENTITY_FIELDS` is `LEGAL_IDENTITY_FIELDS`, and `SubscriberIdentityField` is
  `LegalIdentityField`** — the same three fields, now named for what they are: both parties to a
  contract have a legal identity, and the issuer is not a subscriber.
- **`IssuerIdentityInspector` and `IssuerIdentityCheck`** are exported from `@saasicat/nest` and
  `@saasicat/nest/platform`, and both are registered for every configuration. The inspector answers
  the question and acts on nothing — `inspect()` is what `<app> doctor` and a health endpoint of
  your own call, and it is settled once per process. The check is the module hook that turns a
  refusing answer into a boot that does not happen; it has no `inspect()`.

One limit worth stating: the comparison needs the `core.appliedSettings` port, which both shipped
persistence bundles provide. Without it the boot log says once that the issuer is compared with
nothing, and the identity is not guarded. A contract whose party copy the subscriber migration made
names no issuer at all; those neither block a change nor are blocked by one, and are confirmed
against the contract before they are invoiced.

### The plan catalogue is read when it is asked for

`PLAN_CATALOG_TOKEN` is gone. It carried the whole catalogue, read once when the application
started, so a plan the operator published afterwards was unknown to everything that read it until
the next restart: a promo code for it was refused with `PLAN_MISMATCH`, a plan change to it with
`PLAN_NOT_IN_CATALOG`, and a contract frozen after a price change named the new version with the old
one's price. The catalogue is two tokens now, because its two halves move differently:

- **`PLAN_CATALOG_SETTINGS_TOKEN`** is a `PlanCatalogSettings`: the blocks of `config/saas.yaml` —
  app, currency, VAT rate, tenant billing, issuer, payments and the rest. They are fixed while the
  process runs. A class that reads only settings injects this one, and nothing else changes for it.
- **`PLAN_CATALOG_SOURCE_TOKEN`** is a `PlanCatalogSource`. `await source.current()` answers the
  settings with the plans and features as the database holds them at that moment. Read it once per
  operation and hand the value on, so every check of that operation sees the same plans. `findPlan`,
  `getPlanPriceNet`, `getPlanPriceGross` and `getMarketedPlans` take the value as before.

```ts
// before
constructor(@Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog) {}
priceOf(planId: string) {
    return getPlanPriceGross(this.catalog, planId, 'MONTHLY');
}

// after
constructor(@Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource) {}
async priceOf(planId: string) {
    return getPlanPriceGross(await this.catalogs.current(), planId, 'MONTHLY');
}
```

The old import fails to compile rather than carrying on with the plans from the start, and that is
the point: a token that kept its name and lost its plans would compile, and hand every
`catalog.plans ?? []` an empty list. An application that resolves the old registry key by hand fails
at start.

Four more things moved with it:

- **`AdminManifestConfig` has no `planCatalogSnapshot` any more.** `AdminManifestService` fills it
  on every request from the source — plans, features, currency, VAT rate and a hash over them, with
  `source` saying `database` or `given`. A config factory of your own drops the block, and whatever
  it computed the hash with.
- **`AdminManifestService.getManifest()` and `rebuild()` return a `Promise`**, and so does
  `ManifestAccessPort.getManifest()`. A manifest controller of your own awaits it before it reads
  `build.manifestHash` for the ETag. `ManifestCliFlow` awaits the port, so a `manifestAccessPort`
  that delegates to the service needs no change. The service reads `PLAN_CATALOG_SOURCE_TOKEN`, so
  an `AdminManifestModule` wired by hand needs a `PlanCatalogModule` in scope, which
  `SaaSiCatModule.forRoot` provides globally.
- **`PlanCatalogModule.forRootWithCatalog(catalog)`** provides both tokens from the catalogue it is
  given. A test that builds a service by hand passes `givenPlanCatalogSource(catalog)` where it
  passed the catalogue.
- **A contract records the plan version its subscription is bound to.** It priced the plan line from
  the version on sale, so a tenant on v1 who booked an add-on after v2 was published got a contract
  at v2's price with v1's entitlements. `ContractFreezeSourcePort.findLivePlanVersionId(planId)` is
  replaced by `findBoundPlanVersion(tenantId)`, which returns the row the subscription's
  `planVersionId` points at — price, features and quotas from one row:

    ```ts
    // before
    findLivePlanVersionId(planId: string) {
        return this.prisma.planVersion
            .findFirst({ where: { planId, publishedAt: { not: null }, supersededAt: null } })
            .then((row) => row?.id ?? null);
    }

    // after
    async findBoundPlanVersion(tenantId: string) {
        const sub = await this.prisma.subscription.findUnique({
            where: { tenantId },
            include: { planVersion: true },
        });
        // The fields your schema carries for the version's validity, as in your read sink.
        const fields = { validityWindows: false, endsAt: false };
        return sub ? toPlanVersionRow(sub.planVersion, sub.plan, fields) : null;
    }
    ```

    The freeze therefore relies on the write binding `planVersionId` on a plan change, and refuses a
    plan the subscription is not bound to. Both shipped adapters bind by default, and each says so
    on `TenantSubscriptionWritePort.bindsPlanVersion`; a contract freeze beside a write that says
    `false` stops the start and names the option. `@saasicat/adapter-prisma` used to bind only with
    `tenantSubscription.synchronizePlanVersion: true` — it is the default now, and `false` opts out.
    The default needs a schema that carries it: a `planVersionId` column on the subscription model,
    the plan-version model, and a published, live version for every plan a tenant can change to.
    The adapter resolves the plan-version model when it is constructed, so a schema without one
    stops the start; a missing column is named by the first plan change that tries to write it.
    A write port of your own either sets `bindsPlanVersion` or is taken on trust: if it does not
    bind, every plan change's freeze is refused and logged, and the tenant stays under the contract
    they had.

What it costs: a read of the three catalogue tables for each operation that needs plans — a price, a
promo code, a plan change, a contract, the public plan list, an entitlement the cache does not
answer, the manifest. `enforceLimit` reads before it opens its transaction, so the lock it takes on
the subscription row does not wait for a second connection.

**Check your row-level security before you upgrade.** The catalogue used to be read once, before any
request; now it is read inside tenant requests, through whatever client your read sink resolves
there. The shipped schema has no policy on `plans`, `plan_versions` or `feature_catalog_entries`. If
you added one, a tenant request sees a smaller catalogue, and that shows up as
`PLAN_NOT_IN_CATALOG`, `PLAN_MISMATCH` or a plan priced at `0.00` — never as a policy.

### A contract's lines add up to its totals

A contract's total was converted to gross once, from its net total, and each line on its own, so the
lines could miss the total by a cent — 10.02 + 10.02 net at 19 % came to 11.92 + 11.92 = 23.84 under
a total of 23.85. The tax is now computed once on the net of the charges billed together, every line
of one rhythm, and each line carries its share of it. What a customer pays does not change for a
contract of one rhythm; a yearly plan with monthly add-ons now states what one yearly charge and
twelve monthly ones come to.

**`SubscriptionContractService.create` refuses a contract whose lines do not add up** to
`subtotalNet`, `discountNet`, `totalNet` and `totalGross`, each line counted as often as it falls due
in one period, with `SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP` and the total it names in
`params.field`. A negative discount, or a promotion or promo code snapshot resolved below zero, is
refused with `SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE`. Both platform paths always pass. If you build
contract lines yourself, record them all at once and take the totals from them:

```ts
import { contractTotalsOf, recordContractLinesMoney } from '@saasicat/nest/subscription-contract';

// before: each line converted on its own, the total once
const lineItems = [plan, ...bundles, discount].map((line) =>
    recordLineItemMoney(line, currency, vatRate),
);
const totalGross = round(totalNet * (1 + vatRate / 100));

// after: lines priced in net, the gross shared out, the totals read off the lines
const lineItems = recordContractLinesMoney([plan, ...bundles, discount], {
    currency,
    taxRate: vatRate,
});
const priceSnapshot = {
    currency,
    billingCycle,
    vatRate,
    ...contractTotalsOf(lineItems, billingCycle),
};
```

`recordLineItemMoney` is gone, and `PricedContractLineItem` carries no `priceGross`: a line is priced
in net and the platform records the rest. The order you pass the lines in is the order the shares
are taken in, so put the discount last, as the platform does. A line's `priceNet` is what the line
costs over its billing period with its `quantity` already in it, not a unit price: the totals take
the lines as they stand, so three seats at 10.00 are one line of 30.00 with `quantity: 3`.

**`loadBookedBundles(tenantId, cycle)` on `ContractFreezeSourcePort` takes no `vatRate`**, and the
lines it returns carry no `priceGross`. An adapter that still declares the third parameter stops compiling;
remove it, and the gross the adapter computed with it:

```ts
// before
async loadBookedBundles(tenantId: string, cycle: 'monthly' | 'yearly', vatRate: number) {
    …
    return { …, priceNet, priceGross: round2(priceNet * (1 + vatRate / 100)) };
}

// after
async loadBookedBundles(tenantId: string, cycle: 'monthly' | 'yearly') {
    …
    return { …, priceNet };
}
```

**A catalogue promotion is saved only with a value its type can take**, on creation and on change:
a percentage above 0 and at most 100, an amount above 0, an intro price of at least 0 for a whole
number of months, a whole number of free months. Anything else is refused with
`PROMOTION_VALUE_INVALID`. A stored promotion outside those bounds keeps working, held between 0 and
the price it meets, but it cannot be saved again until its value is corrected. `applyPromo` from
`@saasicat/core` answers `null` where a promotion takes nothing off the price it is given — an intro
price above it, a percentage of 0 — and the public catalogue shows no badge for a promotion that
lowers neither rhythm's price.

**A plan's own price for a bundle version is held to two fraction digits**, like the version's own
prices: `pricingOverrides` refuses `"9.995"` with `pricingOverrides.monthlyNet must be a decimal with
at most 2 fraction digits`. Such a price could not be concluded anyway — its contract's lines would
never add up to its total. One stored before the upgrade stays in the row, keeps every offer on that
plan and add-on from being concluded, and is refused when the admin copies it forward into a new
draft. Find and correct them before you upgrade:

```sql
SELECT id, "bundleId", version, "pricingOverrides"
FROM bundle_versions
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements("pricingOverrides") AS o
    WHERE o->>'monthlyNet' LIKE '%.___%' OR o->>'yearlyNet' LIKE '%.___%'
);
```

### A sign-up holds its promo code from step 4 to the payment

A sign-up concluded its offer when the gateway confirmed the payment method, and redeemed the
offer's promo code there. When the code's last redemption went to somebody else in between, the
redemption refused, the conclusion was undone, and the customer had entered a payment method for
nothing. Now a slot of the code is held from the start of the checkout until the checkout
concludes, or until a confirmation of its payment form can no longer arrive.

**Every schema that adopts `PromoCode` carries `heldCount`**, whether or not the installation keeps
holds: the column belongs to the model, and `saasicat schema check` reports it missing otherwise.
What else to run depends on the holds.

**An installation that keeps holds** — the shipped adapters, or a `PromoCodeHoldRepository` of your
own — runs `sql/1.0-a-promo-slot-is-held-through-checkout.postgres.sql` once, before `db push` where
you use one:

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-a-promo-slot-is-held-through-checkout.postgres.sql
```

It adds `heldCount` to `promo_codes` and creates `promo_code_holds`, and does nothing on a second
run or on an installation without promo codes. `examples/notesapp/prisma/schema.prisma` shows the
two models as they are now.

**An installation that keeps no holds** — a `PromoCodeRepository` of your own and no hold
repository — adds the column alone and leaves `PromoCodeHold` out of its schema, which
`schema check` lists as not adopted. The whole file would create a table the schema does not
declare, and Prisma would then want to drop it again:

```sql
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "heldCount" INTEGER NOT NULL DEFAULT 0;
```

- **Name the offer at step 4.** `startCheckout` — and `StartRegistrationCheckoutDto` — take
  `checkoutOfferId`, the offer the sign-up concludes on activation. With it, the offer's code is
  held before the gateway's form opens; a code that cannot be held refuses the step with
  `PROMO_CODE_NOT_REDEEMABLE` and its `reason`, and no form is opened. A
  check of your own before `startCheckout` that previews the code can go: the hold asks everything
  the preview asks. Without `checkoutOfferId` nothing is held, as before.
- **Nothing changes in your activation.** Conclude the offer and redeem its code in `within`, on
  `tx`, as the previous section shows: the conclusion hands the held slot to that redemption, which
  redeems the code on it — also when the code was paused or ran past its validity in the meantime,
  because the customer was promised it when the checkout started. A slot the redemption does not
  take is given back when the conclusion commits.
- **What the operator sees.** `PromoCodeRecord.heldCount`, and `heldCount` in the admin list beside
  the redemptions: a code whose remaining slots are all held refuses new checkouts with `EXHAUSTED`
  while its status stays `ACTIVE`, and gets the slots back as the checkouts conclude or their
  holds run out. A sign-up's slot is held until a confirmation of the form it opened can no longer
  arrive — at Stripe the form's 24 hours plus the three days Stripe goes on retrying a webhook, so
  at most four days — so a form abandoned at the gateway gives its slot back once nobody can pay on
  it and nothing is left to arrive; a gateway that reports no end holds it for the checkout's
  `PENDING_CHECKOUT_TTL_DAYS`. Size `maxRedemptions` for a campaign with that in mind: a slot an
  abandoned form holds comes back after those four days, not at once. A code a checkout holds a
  slot of is not deleted, with `PROMO_CODE_HAS_REDEMPTIONS` and `held` in its `params`.
- **An offer changed at step 4** keeps its slot while its code stays on it, and gives it back when
  the code is changed or removed.
- **A `PromoCodeRepository` of your own** reports `heldCount` on every record — 0 when it keeps no
  holds — and the TypeScript types say where. Holds are a port of their own,
  `PromoCodeHoldRepository`, which both shipped adapters provide as `promo.holdRepository` in their
  persistence bundle; wired by hand, pass it to `PromoCodesModule.forRoot` as `holdRepository`. An
  installation without one holds nothing, and a sign-up that names an offer with a code is refused
  with an error saying so. If you provide holds, your `claimSlot` counts `heldCount`, and your
  persistence contract harness wires `promoCodeHoldRepository`; a harness without it declares
  `gaps: ['promoCodeHolds']`.
- **A `PaymentGateway` of your own** states `confirmableUntil` on the `PaymentMethodSetupSession`
  it returns: the end of its form plus the time it goes on retrying a confirmation it could not
  deliver, or `null` where it states neither, which holds the slot for the checkout's
  `PENDING_CHECKOUT_TTL_DAYS`. The TypeScript types say where; `StripePaymentGateway` states it for
  you.

### A promo code takes off no more than the price

`PromoCodesService.update` holds a change to the rules `create` holds, for the fields the change
names: a percentage between 0 and 100, an amount above 0, an amount below the lowest price it can
apply to unless `allowZeroInvoice` is set, a one-off discount without a duration, a validity that
ends after it begins, and no plan that is not discountable. A change that only pauses a code is not
asked about its value, so an operator can stop any code.

Redeeming refuses where the preview refuses — `PROMO_CODE_NOT_REDEEMABLE` with the reason
`WOULD_PRODUCE_ZERO_INVOICE` for a code that would leave an invoice of zero it does not allow — and
the redemption records at most the price it is redeemed against: a percentage above 100 is recorded
as 100, an amount above the plan's gross price as that price.

- **A code changed before this release** can carry a value these rules refuse — 150 %, or an amount
  above every price. It still redeems, at the price, where it allows an invoice of zero, and is
  refused where it does not. Find such codes with the admin list and correct them.
- **An admin page of your own** that switches a code to a one-off discount sends
  `durationValue: null` with it; the shipped dialog does.

### A bundle booking's rhythm is `MONTHLY` or `YEARLY`

The platform writes a booking's `billingCycle` only as `MONTHLY` or `YEARLY`, and prices the booking
by asking whether it is `YEARLY`. `SubscriptionBundleRecord` typed the field as any string, so a
repository that handed back `'yearly'` had the booking priced monthly. The field is now
`BillingCycle | null` on `SubscriptionBundleRecord` and `CreateSubscriptionBundleData`, and both
shipped adapters refuse a stored value other than the two when they read it, with an error naming
the row. Null still means a booking made before the column existed, billed in the plan's rhythm.

- **A `SubscriptionBundleRepository` of your own** returns `BillingCycle | null`; the TypeScript
  types say where. Map each row with `toSubscriptionBundleRecord` from `@saasicat/core`, which is
  what the shipped adapters do, rather than casting the column.
- **Code of your own** that calls `resolveBundlePriceNet` or `listForSubscription` on
  `SubscriptionBundlesService`, or builds a `SubscriptionBundlePreviewContext`, passes a
  `BillingCycle` where it passed a string.
- **Rows already stored.** The column is text. This lists the rows that would now be refused, and on
  an installation the platform alone has written it lists none:

    ```sql
    SELECT "id", "billingCycle" FROM "subscription_bundles"
    WHERE "billingCycle" IS NOT NULL AND "billingCycle" NOT IN ('MONTHLY', 'YEARLY');
    ```

    Set each row it returns to the rhythm the booking is actually billed in.

- **Your persistence contract harness** gains a seed writer, `setBookingCycle`, which takes a
  booking's id and a value and overwrites the booking's `billingCycle` with it — the shipped
  harnesses do it with one update. A harness without it declares
  `gaps: ['foreignBookingCycleSeed']`.

## What the codemod leaves to you

1. **`FEATURE_UI_REGISTRY_TOKEN` imported from `@saasicat/nest`** — pick the entry you mean.
2. **A `components/*` import with no public successor** — copy the component.
3. **Your own `tests-e2e/` directory** — yours to keep or rename; only the platform helper's
   import path changed.
4. **A `file:` override that points into this repository** — the package directories are their
   npm names now (`packages/nest`, not `packages/saas-platform-nest`). The codemod does not scan
   `package.json`; update the path by hand.
5. **An object literal with a `projectKey` the codemod could not place** — see above; it prints
   the file and line. Delete the ones that addressed the platform catalogue, keep your own.
6. **A feature guard of your own.** With `globalFeatureGuard: false`, 1.0 refuses to boot when a
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

7. **`SUBSCRIBER_IDENTITY_FIELDS` and `SubscriberIdentityField`** — now `LEGAL_IDENTITY_FIELDS` and
   `LegalIdentityField`. Not in the codemod on purpose: its stems match anywhere in an identifier,
   so a `SubscriberIdentity → LegalIdentity` rule would also rewrite `SubscriberIdentityValues`,
   `SubscriberIdentityDelta` and `SubscriberIdentityCorrection`, which keep their names. Two
   identifiers, by hand.

8. **`listRunningIssuers` on a `SubscriptionContractRepository` of your own** — the contracts
   concluded and not yet over, oldest first, with the legal name on each one's issuer copy. Both
   shipped adapters have it; the persistence contract fails an implementation without it. See the
   section above for what "not yet over" means, and why status alone is not it.

9. **`PLAN_CATALOG_TOKEN`** — two tokens now, and which one a class needs depends on whether it reads
   plans: a class that reads only settings takes `PLAN_CATALOG_SETTINGS_TOKEN`, one that reads plans
   or features takes `PLAN_CATALOG_SOURCE_TOKEN` and awaits `current()`. That is a decision about
   each class, not a rename, so the compiler lists the places and the section above says how.

## Order for a workspace with several apps

Run the codemod from the repository root once; it walks every package. Bump every `@saasicat/*`
dependency to the same version — the packages are released in lockstep, and a mixed set will
fail at the registry keys. Then boot the app and read the log: a `SaaSiCatConfigurationError`
lists every configuration problem at once.

**Write the version, not `@rc`.** A dist-tag moves when the next candidate is published, so a
manifest that names one stops saying which version this commit was built against — the lock file
records what was installed, the manifest records what was meant, and only the second survives being
read a year later. Pinning every package exactly also means a jump touches every one of them, which
is the point: a mixed set is the failure this paragraph opens with.
