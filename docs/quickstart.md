# SaaSiCat — Quickstart

Take one feature through the complete SaaSiCat loop in **10 steps**:

```text
Capability → Discovery → Packaging → Contract → Enforcement
```

The result is a NestJS application whose code-declared features and quotas
are discovered automatically, packaged for customers and enforced at
runtime. The quickstart takes about 30 minutes and requires fewer than 100
lines of app-owned platform code.

> Assumes a **NestJS app with Prisma + PostgreSQL + JWT auth** that already
> has a `tenantId` concept (e.g. a `Tenant` table + RLS, or `tenantId` as a
> foreign key). If you are starting completely from scratch, implement tenant
> separation first — this guide _extends_ a multi-tenant app with SaaS
> functionality.
>
> Its `tsconfig.json` needs `"moduleResolution": "nodenext"` (or `node16` /
> `bundler`) — the setting `nest new` writes. The platform packages are
> reached through subpath exports (`@saasicat/nest/platform`), and the old
> `"node"` resolution does not see those. `saasicat init` checks and says so.
>
> A full explanation of every step lives in the [SaaSiCat handbook](handbook.md).
> The quickstart shows the fastest path — if you need different schemas,
> databases or more control, continue in the handbook.

**Example app used in this guide:** a NestJS app `notesapp` with:

- a `Notes` module (CRUD over notes per tenant),
- a `User` table with `tenantId`,
- JWT login.

We declare note creation and export in code, let SaaSiCat discover them,
package them as Starter and Pro, and enforce the resulting feature and quota
rules per tenant.

For the reasoning behind each stage, read
[From Capability to Contract](capability-to-contract.md).

---

## Step 1 — Install packages

```bash
cd notesapp/backend
pnpm add \
    @saasicat/core \
    @saasicat/spec \
    @saasicat/nest \
    @saasicat/adapter-prisma \
    @saasicat/cli
```

> All SaaSiCat packages are versioned in lockstep — always keep them on the
> same version.

### Or: let the CLI write steps 2, 4, 5 and 6 for you

```bash
pnpm exec saasicat init --project-key=notesapp --quota=notes:Note
```

That writes `config/saas.yaml`, the persistence bundle, the feature-UI
registry, the manifest contribution, the admin module and one quota provider
per `--quota` — and adds `SaaSiCatModule.forRoot(...)` to your
`src/app.module.ts`. Add `--dry-run` first to see the list, `--skip-hasher` if
your app already hashes passwords. It refuses to overwrite a file that already
exists.

Two things stay yours, because nothing can guess them: what each quota actually
counts (one line in the generated provider) and your auth guard.

**The generated code does not compile until you name that guard**, and that is
deliberate. An empty `guards: []` is how this platform is told an endpoint
should be auth-free — so a placeholder would publish `GET /admin/discovery`,
your entire capability inventory, along with the manifest routes. A name that
does not resolve is the one failure nobody ships past.

The rest of this page is what those files contain and why — worth reading once,
whether or not you generated them.

## Step 2 — Create the app identity config

`backend/config/saas.yaml`:

```yaml
schemaVersion: 1
projectKey: notesapp
app:
    name: NotesApp
    label: NotesApp Cockpit

currency: EUR
vatRate: 19.0

marketing:
    availableLocales: [en]

plans:
    - id: STARTER
      name: Starter
      monthlyNet: 9
      yearlyNet: 90
      features: [NOTES]
      quotas: { notesMax: 25 }
    - id: PRO
      name: Pro
      monthlyNet: 29
      yearlyNet: 290
      features: [NOTES, NOTES_EXPORT]
      quotas: { notesMax: 1000 }
```

This first run keeps plans in YAML so the backend can enforce them before the
catalog has been populated. In a live setup, use `dbCatalog` instead of
`planCatalog`; plans and bundles then live only in the database. Capabilities
and quota definitions always come from code.

## Step 3 — Prisma schema + migration in one command

```bash
pnpm exec saasicat schema migrate --name=add_saasicat --all
pnpm prisma generate
```

`schema migrate` does four things: it idempotently inserts the platform models
from the selected Prisma fragments into your `schema.prisma`, it calls
`prisma migrate dev --create-only` to write the migration, it appends the
constraints Prisma's DSL cannot express — the partial unique indexes and the
subscription CHECK — and only then applies it. The order matters: a migration
that has already been applied cannot take an edit, and Prisma would see its
recorded checksum change and offer a reset. Those constraints are part of the
canonical schema, not optional hardening: the adapter contract tests run against
a database that has them (details: [data model](data-model.md)). Running the
command again does not append them twice.

`--all` gives the standard module its catalog, subscription, contract, bundle,
audit and SuperAdmin tables.

The `@relation` lines from the platform tables to your own `Tenant` and `User`
ship commented out — a fragment cannot know what those models are called, or
whether they exist. Name them and the command enables them:

```bash
pnpm exec saasicat schema migrate --name=add_saasicat \
    --tenant-model=Tenant --user-model=User
```

A name the schema does not declare is refused, with the list of models it does
declare. Without the flags the pointers stay commented and the command says how
many and how to enable them — nothing fails in that state, which is the reason
it is easy to leave: the columns exist, the queries work, and referential
integrity is simply absent until somebody deletes a tenant.

A Prisma relation has two sides, and only your model can carry the other one. If
your `Tenant` has no `auditLogs AuditLog[]`, that pointer stays commented and the
command prints the exact line to add — writing it anyway would produce a schema
Prisma refuses with P1012, in a file the tool had already changed.

## Step 4 — Declare a countable product capability

This is where you declare **what is countable and how to count it**. For each
countable dimension, one class that fulfils `QuotaProvider` and is decorated
with `@DefinesQuota({...})` — the decorator is the single source of truth for
the quota's key, label and unit.

> **What does `@DefinesQuota` do?** The discovery scanner reads the decorator
> at boot and writes an entry into `var/discovery-snapshot.json`. That becomes
> a reviewable quota in the SuperAdmin UI — including its link to the
> `Feature` that contains this quota. **In addition, the
> `EnforceQuotaInterceptor` from step 6 uses the provider at runtime to count
> the tenant's current usage.**

`backend/src/saas-adapters/notes-quota.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DefinesQuota } from '@saasicat/nest/discovery';
import type { QuotaProvider } from '@saasicat/core';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@DefinesQuota({
    key: 'notesMax', // camelCase; referenced by @EnforceQuota and plan limits
    label: 'Notes count',
    unit: 'count',
    policy: 'hardCap', // 'hardCap' blocks at the limit; 'continuous'/'monthlyReset' describe usage semantics
    feature: 'NOTES', // links the quota to the feature declared in step 7
})
export class NotesQuotaProvider implements QuotaProvider {
    readonly key = 'notesMax';
    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<number> {
        return this.prisma.note.count({ where: { tenantId } });
    }
}
```

## Step 5 — Build the persistence bundle

One factory call replaces the hand-written adapter module:
`prismaPersistence({ client })` bundles every shipped Prisma adapter (MFA,
audit incl. query/stats, RLS bypass, transactions, catalog repositories,
subscription read/write, contracts, add-on bundles, promo repositories,
SuperAdmin bootstrap and plan-catalog sinks) plus the declared
**capabilities** of the adapter+database combination.

```ts
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { PrismaService } from '../prisma/prisma.service';
import { Argon2Hasher } from '../auth/argon2.hasher'; // your PasswordHasher

export const persistence = prismaPersistence({
    client: PrismaService,
    passwordHasher: Argon2Hasher, // enables the SuperAdmin setup wizard
    // Optional app relation counters shown on tenant pages.
    adminResources: { tenantMetrics: ['notes', 'users'] },
});
```

The bundle is a convenience over the public ports, not a closed abstraction.
For a custom schema or another database, provide the same bundle slices or
wire the individual modules. `@saasicat/persistence-testing` verifies the
behavior expected from a persistence adapter.

> **RLS bypass:** In your `PrismaService`, check `rls.isBypassActive()` (e.g.
> in a Prisma middleware) and set `SET LOCAL row_security = off` for the
> current transaction when it is active — then pass `rlsIntegration: true`.
> Snippet in the README of `@saasicat/adapter-prisma`.

## Step 6 — Wire the AppModule (incl. auto-enforcement)

`SaaSiCatModule` is the high-level path. It builds discovery, catalog,
entitlements, tenant billing, add-on bundles and the admin APIs from one
configuration. `defineSaaSiCat(...)` is a typed identity helper for editor
completion.

`backend/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { defineSaaSiCat, SaaSiCatModule } from '@saasicat/nest/platform';
import { prismaPersistence } from '@saasicat/adapter-prisma';
import type { FeatureUiRegistry } from '@saasicat/core';

import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { Argon2Hasher } from './auth/argon2.hasher';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TenantGuard } from './auth/tenant.guard';
import { NotesModule } from './notes/notes.module';
import { NotesQuotaProvider } from './saas-adapters/notes-quota.provider';

const featureUiRegistry: FeatureUiRegistry = {
    NOTES: { label: 'Notes', icon: 'sticky_note_2' },
    NOTES_EXPORT: { label: 'Notes export', icon: 'file_download' },
    notesMax: { label: 'Notes limit', icon: 'tag' },
};

@Module({
    imports: [
        PrismaModule,
        AuthModule,

        SaaSiCatModule.forRoot(
            defineSaaSiCat({
                planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
                controller: { guards: [JwtAuthGuard] },
                imports: [AuthModule, PrismaModule],
                persistence: prismaPersistence({
                    client: PrismaService,
                    passwordHasher: Argon2Hasher,
                }),
                entitlement: {
                    resolutionConfig: { defaultTrialEntitlementPlan: 'STARTER' },
                },
                catalog: {
                    featureUiRegistry,
                    strictModeCheckMode: 'warn-only',
                },
                tenantBilling: {
                    authGuards: [JwtAuthGuard, TenantGuard],
                },
                subscriptionBundles: true,
                setup: true,
                subscriptionContract: true,
                // Keep the complete standard SuperAdmin API available.
                adminResources: true,
                promoCodes: true,
                quotaProviders: [NotesQuotaProvider],
                tenantManifest: true,
            }),
        ),

        NotesModule,
    ],
})
export class AppModule {}
```

For larger applications, keep the app-specific object in
`saasicat.config.ts` and leave the root module with a single platform line:

```ts
SaaSiCatModule.forRoot(MY_APP_SAASICAT_CONFIG);
```

`SaaSiCatModule` owns the composition of the platform modules. The client
configuration only supplies facts the library cannot know: auth guards,
branding and app-specific persistence adapters.

> **Auth ordering:** register your `JwtAuthGuard` as a **global** guard
> (`{ provide: APP_GUARD, useClass: JwtAuthGuard }`) in a module imported
> **before** `SaaSiCatModule.forRoot`. The platform's feature guard and
> quota interceptor are global and read `request.user` — controller-level
> `@UseGuards` runs after global guards and would be too late for them.
>
> The global guard must allow SaaSiCat's intentionally public endpoints. Use
> the exported marker helper before authenticating the request:
>
> ```ts
> import { isSaaSiCatPublicRoute } from '@saasicat/nest/platform';
>
> if (isSaaSiCatPublicRoute(this.reflector, context)) return true;
> ```
>
> Here, `this.reflector` is Nest's injected `Reflector` and `context` is the
> guard's `ExecutionContext`. SaaSiCat applies the marker to setup, public
> catalog, public promo and checkout endpoints itself.

**What happens automatically here:**

- The active plan is resolved from the subscription repository. No
  app-specific `PlanResolver` class is needed.
- `StaticFeatureGuard` is registered as `APP_GUARD` — `@RequireFeature(...)`
  now automatically throws 403 when the feature is missing from the plan.
- `EnforceQuotaInterceptor` is registered as `APP_INTERCEPTOR` —
  `@EnforceQuota(...)` automatically throws `LimitExceededError` as soon as
  `provider.count(tenantId) + delta > planLimit`.
- The same quota providers feed `GET /billing/usage`; no second usage adapter
  repeats the counters.
- Catalog, public catalog, tenant billing, subscription bundles and the tenant
  manifest are mounted from the persistence bundle.
- Setup and subscription-contract services are mounted from the same central
  module when enabled; their repositories are derived from persistence.
- The standard Admin API serves tenant list/detail/actions, users, audit,
  subscriptions and promo-code CRUD. Enabling it does not hide or trim Admin
  pages; it removes their repeated app-owned controllers and database queries.

This is the standard path. The individual `CatalogModule`,
`TenantBillingModule`, `EntitlementModule` and port options remain public for
applications that need different schemas or behavior.

## Step 7 — Declare and enforce the feature in code

Four decorators marry your code to the platform:

| Decorator                                      | Where                              | Effect                                                                                                        |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@DefinesQuota({ key, feature, ... })`         | Class implementing `QuotaProvider` | "This quota exists, and I can count it." → discovery UI + interceptor source.                                 |
| `@ImplementsCapability(key, { feature, ... })` | Endpoint method                    | "This endpoint realizes the capability." → discovery UI, can be included in plans.                            |
| `@RequireFeature(...keys)`                     | Endpoint method                    | The platform `StaticFeatureGuard` checks per request: is at least **one** of the features in the active plan? |
| `@EnforceQuota(quotaKey)`                      | Endpoint method                    | The platform `EnforceQuotaInterceptor` calls the `QuotaProvider` and compares `count + delta ≤ planLimit`.    |

`backend/src/notes/notes.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ImplementsCapability, EnforceQuota } from '@saasicat/nest/discovery';
import { RequireFeature } from '@saasicat/nest/billing';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
    constructor(private readonly notes: NotesService) {}

    @Post()
    @ImplementsCapability('notes.create', {
        label: 'Create note',
        feature: 'NOTES',
        kind: 'endpoint',
        owner: 'notes',
    })
    @RequireFeature('NOTES') // 403 if the plan does not include the feature
    @EnforceQuota('notesMax') // 402 LimitExceeded when count(tenantId) >= 25 (Starter)
    create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
        return this.notes.create(user.tenantId, dto);
    }
}
```

Both checks now run **automatically** — you no longer have to build anything
into your service code. For race-critical operations (e.g. a large file
upload against a storage-GB quota), the transactional path
`EntitlementService.enforceLimit({ tenantId, dimension, currentUsage, insert })`
is still the cleaner option; see the [handbook](handbook.md), §6.

## Step 8 — Start the backend + create the first SuperAdmin

```bash
pnpm start:dev
```

Check at boot:

```bash
jq '.capabilities[].capabilityKey' var/discovery-snapshot.json
#   → "notes.create"
```

Create the first SuperAdmin + MFA via the **first-run setup wizard** in the
Admin UI (set `SETUP_TOKEN`; the login page then shows the wizard as long as
no SUPER_ADMIN exists). See the [handbook](handbook.md), §6.10.

> Prerequisite: `prismaPersistence({ passwordHasher })` is set (step 5) —
> that activates the shipped `PrismaSuperAdminBootstrapAdapter` against the
> `super_admin_users` table (fragment `10`). For the app CLI, register
> `AdminBootstrapCommand` as a `nest-commander` subcommand and pass
> `persistence.core.superAdminProvisioning` to
> `CliContextModule.forRoot({ superAdminBootstrapPort })`.

Optional but recommended: `notesapp doctor` for a platform self-check (plan
catalog loaded, discovery snapshot, UserPort reachable, AdminManifest
buildable). Enable it with `defaultDoctorChecks: true` in
`CliContextModule.forRoot()`.

## Step 9 — Admin frontend in one command

```bash
cd notesapp
pnpm create saasicat-admin admin \
    --project-key=notesapp \
    --brand-name=NotesApp \
    --logo-text=NA \
    --api-base=/api/v1/admin
cd admin
pnpm install
pnpm dev   # http://localhost:9100/admin/login
```

This produces a runnable Vue 3 + Quasar + Vite project with:

- `createSuperAdminApp(...)` bootstrap (Quasar + Pinia + Router + auth guard + manifest guard)
- an HTTP client with token handling
- routes for all standard pages (Dashboard, Tenants, Plans, Discovery, …)
- branding variables in `src/styles/theme.scss`
- German and English ship with the shell; the header switcher changes it per
  user. Which languages you offer, and whether you add your own, is set in
  `main.ts` via `i18n` (see [handbook §8.7](handbook.md#87-ui-language-i18n))

The only thing left to do is adapt **`src/services/http.ts#adminLogin`** to
your backend auth.

Standard pages need no loaders. They read the platform's resource registry,
which `createSuperAdminApp({ http })` installs — the same `http` you passed
above, so every request carries your auth:

```vue
<template>
    <PlatformUsersPage subtitle="All users across tenants." />
</template>
```

What stays in your wrapper is what your app decides: the wording, which flows
your operators get, which plans a promo code may apply to. Nothing to wire.

When one call has to go somewhere else — a legacy host, an approval recorded
around a publish — override that one operation and keep the rest:

```ts
createSuperAdminApp({
    http: platformHttp,
    resourceOverrides: {
        bundleVersions: {
            ops: {
                publish: async (next, versionId, options) => {
                    await recordApproval(versionId);
                    return next(versionId, options);
                },
            },
        },
    },
});
```

`next` is the platform's own implementation, so the wrapper decides what happens
around it rather than replacing it. Every other operation is untouched.

`createAdminResourceClient` is still exported for an app that wants to call the
admin API from its own code rather than through a page.

### Frontend feature gate (tenant UI)

For your app's own tenant UI (not the SuperAdmin), the platform provides
three building blocks that work together:

```ts
// main.ts of the tenant app
import { provideEntitlement, useTenantManifest } from '@saasicat/ui-vue';

const manifest = useTenantManifest({ endpoint: '/api/v1/tenant/manifest' });
// manifest.value → { planId, features, quotas, navigation }
// manifest.hasFeature('NOTES') → boolean

// If you keep using the older useEntitlement:
provideEntitlement(app, manifest); // FeatureGate + router guard use it
```

Then control visibility declaratively in templates:

```vue
<template>
    <FeatureGate feature="NOTES">
        <RouterLink to="/notes">Notes</RouterLink>
        <template #fallback>
            <span class="muted">Upgrade to Pro for notes</span>
        </template>
    </FeatureGate>
</template>

<script setup>
import FeatureGate from '@saasicat/ui-vue/ui/entitlement/FeatureGate.vue';
</script>
```

And block routes:

```ts
import { buildFeatureRouterGuard } from '@saasicat/ui-vue';

router.beforeEach(
    buildFeatureRouterGuard({
        getEntitlement: () => manifest,
        redirectTo: '/upgrade',
    }),
);

// Route meta:
{ path: '/notes', component: NotesPage, meta: { requiresFeature: 'NOTES' } }
```

> **Security note:** the frontend feature gate is **convenience, not
> protection**. The actual protection lives in the backend
> (`@RequireFeature` + `@EnforceQuota`, step 7). The frontend only hides
> buttons the backend would reject anyway.

## Step 10 — Verify

```bash
# 1. Backend serves the admin + tenant manifest
curl -H "Authorization: Bearer <admin-token>" \
     localhost:3000/api/v1/admin/manifest | jq '.navigation.standardPages | keys'

curl -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/api/v1/tenant/manifest | jq '.features, .quotas'

# 2. Quota enforcement (test user on the starter plan, limit = 25)
for i in {1..30}; do
  curl -X POST -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
       -d '{"title":"test '$i'"}' localhost:3000/notes
done
#   → 25 ok, from #26 → 402 limit reached for notesMax: 25/25

# 3. Check the feature gate (an endpoint with @RequireFeature for a feature not in the plan)
curl -X POST -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/notes/export
#   → 403 feature EXPORT not included in the current plan
```

Admin UI: `http://localhost:9100/admin/login` → log in → MFA code →
dashboard. The **Discovery page** shows `notes.create` as "discovered", the
**Plans page** lists `starter` and `pro`.

**You are SaaS-ready.**

---

## What next?

Add these in this order:

1. **Switch the runtime catalog to the database:** replace `planCatalog` with
   `dbCatalog: { projectKey, currency, vatRate, app, marketing }`. The
   persistence bundle already supplies the read sink and catalog repositories.

2. **Manifest contributions** for your own SuperAdmin KPI cards, tenant
   actions and project pages. **Tenant navigation** contributions via
   `TenantManifestService.registerNavItem(...)` in `OnModuleInit`.
   → [handbook](handbook.md), §6.6

3. **Extend the CLI**: `notesapp manifest hash` (CI pinning),
   `notesapp audit tail`. Plus `defaultDoctorChecks: true` for the 4
   platform health checks.
   → [handbook](handbook.md), §9

4. **Tests:** `createSaaSiCatTestModule({ planCatalog, defaultPlanId, quotaProviders })`
   from `@saasicat/nest/testing` for integration tests without your own
   adapter setup.

5. **Payments:** add a payment-provider adapter when the integration is
   available. Keep capability packaging, contracts and enforcement independent
   of provider-specific payment state.

---

## Common quickstart failures

| Symptom                                                 | Cause                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `saasicat: command not found`                           | Use `pnpm exec saasicat ...` or install globally: `pnpm i -g @saasicat/cli`.                        |
| `prisma-fragments/` directory not found                 | `@saasicat/spec` is missing from the backend deps. Repeat step 1.                                   |
| `Nest can't resolve dependencies of X (?, ...)`         | Put the module exporting the injected adapter/client in the top-level `imports` option.             |
| Boot hangs with `P2028 "Unable to start a transaction"` | The RLS bypass did not take effect — `PrismaService` does not check `isBypassActive()`.             |
| `discovery-snapshot.json` is empty                      | The module holding the decorators (e.g. `NotesModule`) is missing from `AppModule.imports[]`.       |
| `@RequireFeature` lets everything through               | Enable `tenantBilling`, or provide `defaultPlanId`/`adapters.planResolver` for a lightweight setup. |
| `@EnforceQuota` never blocks                            | The `QuotaProvider` class is not listed in `quotaProviders: [...]`.                                 |
| `@RequireFeature('NOTES')` throws 403                   | The tenant has no active/trial subscription, or its plan does not include `NOTES`.                  |
| Discovery tabs stay empty                               | Vite cache holding a stale build. `rm -rf node_modules/.vite && pnpm dev`.                          |
| Setup wizard does not appear / `403 SETUP_DISABLED`     | The `SETUP_TOKEN` env variable is not set, or a SUPER_ADMIN already exists (self-disable).          |
| `tenantManifest` throws at boot                         | Enable `tenantBilling`, or provide `defaultPlanId`/`adapters.planResolver`.                         |

For deeper troubleshooting, see the [handbook](handbook.md), §11.
