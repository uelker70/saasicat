# saasicat — Quickstart

Make a NestJS app SaaS-capable in **10 steps**: tenants, plans, features,
quotas, automatic backend enforcement and a SuperAdmin UI. Goal: a working
SuperAdmin on top of an existing CRUD backend in ~30 minutes, with < 100
lines of app-owned code.

> Assumes a **NestJS app with Prisma + PostgreSQL + JWT auth** that already
> has a `tenantId` concept (e.g. a `Tenant` table + RLS, or `tenantId` as a
> foreign key). If you are starting completely from scratch, implement tenant
> separation first — this guide _extends_ a multi-tenant app with SaaS
> functionality.
>
> A full explanation of every step lives in the [saasicat handbook](handbook.md).
> The quickstart shows the fastest path — if you need different schemas,
> databases or more control, continue in the handbook.

**Example app used in this guide:** a NestJS app `notesapp` with:

- a `Notes` module (CRUD over notes per tenant),
- a `User` table with `tenantId`,
- JWT login.

We turn it into a SaaS app with two plans (Starter / Pro), a quota on notes
per tenant, and a SuperAdmin UI.

---

## Step 1 — Install packages

```bash
cd notesapp/backend
pnpm add \
    @saasicat/types@^0.1.0 \
    @saasicat/spec@^0.1.0 \
    @saasicat/nest@^0.1.0 \
    @saasicat/prisma@^0.1.0 \
    @saasicat/cli@^0.1.0
```

> All saasicat packages are versioned in lockstep — always keep them on the
> same version.

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
```

> **Why so small?** The YAML only carries the app identity — everything else
> has exactly one source of truth: **features and quotas** are declared in
> code (`@ImplementsCapability`, `@DefinesQuota`, steps 4 + 7) and picked up
> by discovery; **plans** are created in the SuperAdmin UI and live in the
> DB.

## Step 3 — Prisma schema + migration in one command

```bash
pnpm exec saas-platform schema migrate --name=add_saas_platform --fragments=04,06
pnpm prisma generate
```

`schema migrate` does two things: it idempotently inserts the platform models
from the selected Prisma fragments into your `schema.prisma`, and it directly
calls `prisma migrate dev` for the DB migration. For the quickstart scope,
fragments `04` (AuditLog) and `06` (CatalogEntries) are enough; `--all`
additionally loads bundles, subscriptions and promo codes.

Before migrating, briefly review `schema.prisma` to check whether FK pointers
to your `User`/`Tenant` tables need to be enabled manually (commented-out
`@relation` lines in the fragments).

## Step 4 — Write a quota provider

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
import type { QuotaProvider } from '@saasicat/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@DefinesQuota({
    key: 'notesMax', // camelCase; referenced by @EnforceQuota and plan limits
    label: 'Notes count',
    unit: 'count',
    policy: 'hard', // 'hard' = blocks, 'soft' = warns only
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

## Step 5 — Create the adapter module

Instead of writing 3 Prisma adapters yourself, you import them from
`@saasicat/prisma` and bind your `PrismaService` to the platform token.

| Class                        | Implements port |
| ---------------------------- | --------------- |
| `PrismaMfaAdapter`           | `MfaPort`       |
| `PrismaAuditAdapter`         | `AuditPort`     |
| `AsyncLocalRlsBypassAdapter` | `RlsBypassPort` |

> **Why not everything inside the platform?** The platform ships the
> **adapters**; you bind **your own PrismaService** as `PRISMA_CLIENT_TOKEN`.
> If you use Drizzle, TypeORM or a diverging schema, you still write your own
> adapters — the platform ports stay identical.

`backend/src/saas-adapters/saas-adapters.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import {
    AsyncLocalRlsBypassAdapter,
    PrismaAuditAdapter,
    PrismaMfaAdapter,
    PrismaSuperAdminBootstrapAdapter,
    PRISMA_CLIENT_TOKEN,
} from '@saasicat/prisma';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotesQuotaProvider } from './notes-quota.provider';

@Global()
@Module({
    imports: [PrismaModule],
    providers: [
        { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
        PrismaMfaAdapter,
        PrismaAuditAdapter,
        AsyncLocalRlsBypassAdapter,
        PrismaSuperAdminBootstrapAdapter,
        NotesQuotaProvider,
    ],
    exports: [
        PrismaMfaAdapter,
        PrismaAuditAdapter,
        AsyncLocalRlsBypassAdapter,
        PrismaSuperAdminBootstrapAdapter,
        NotesQuotaProvider,
    ],
})
export class SaasAdaptersModule {}
```

> **RLS bypass:** In your `PrismaService`, check `rls.isBypassActive()` (e.g.
> in a Prisma middleware) and set `SET LOCAL row_security = off` for the
> current transaction when it is active. Snippet in the README of
> `@saasicat/prisma`.

## Step 6 — Wire the AppModule (incl. auto-enforcement)

`SaasPlatformModule` bundles PlanCatalog + Discovery + Admin + AdminManifest
in a single call **and automatically activates the feature guard + quota
interceptor** as soon as you pass `defaultPlanId` (quickstart path) or
`adapters.planResolver` (V3 path).

| Field               | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `planCatalog`       | App identity (branding, currency, locales) from the YAML.                                  |
| `controller.guards` | Mandatory guards for `/admin/manifest` + `/admin/discovery` (typically `[JwtAuthGuard]`).  |
| `adapters`          | The Prisma adapters from step 5 via `useExisting`.                                         |
| `defaultPlanId`     | Fallback plan for all tenants when no `planResolver` is set — dev/smoke.                   |
| `quotaProviders`    | `QuotaProvider` classes from step 4 — `EnforceQuotaInterceptor` uses them for `count()`.   |
| `tenantManifest`    | Activates `GET /tenant/manifest` (features + quotas + filtered navigation).                |

`backend/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { SaasPlatformModule } from '@saasicat/nest/platform';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { NotesModule } from './notes/notes.module';
import { SaasAdaptersModule } from './saas-adapters/saas-adapters.module';
import {
    PrismaMfaAdapter,
    PrismaAuditAdapter,
    AsyncLocalRlsBypassAdapter,
} from '@saasicat/prisma';
import { NotesQuotaProvider } from './saas-adapters/notes-quota.provider';

@Module({
    imports: [
        PrismaModule,
        AuthModule,
        SaasAdaptersModule,

        SaasPlatformModule.forRoot({
            planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
            controller: { guards: [JwtAuthGuard] },
            imports: [AuthModule],
            adapters: {
                mfa: { useExisting: PrismaMfaAdapter },
                audit: { useExisting: PrismaAuditAdapter },
                rlsBypass: { useExisting: AsyncLocalRlsBypassAdapter },
                // For V3 (real contracts), additionally:
                //   planResolver: { useExisting: MyTenantPlanResolver },
                // As long as it is omitted, defaultPlanId applies.
            },
            defaultPlanId: 'starter',
            quotaProviders: [NotesQuotaProvider],

            tenantManifest: { guards: [JwtAuthGuard] }, // GET /tenant/manifest
        }),

        NotesModule,
    ],
})
export class AppModule {}
```

**What happens automatically here:**

- `StaticEntitlementService` is registered — per tenant, it reads features +
  quotas from the plan catalog (via `planResolver` or `defaultPlanId`).
- `StaticFeatureGuard` is registered as `APP_GUARD` — `@RequireFeature(...)`
  now automatically throws 403 when the feature is missing from the plan.
- `EnforceQuotaInterceptor` is registered as `APP_INTERCEPTOR` —
  `@EnforceQuota(...)` automatically throws `LimitExceededError` as soon as
  `provider.count(tenantId) + delta > planLimit`.
- `TenantManifestService` + controller are registered if `tenantManifest`
  is set.

## Step 7 — Declare capability + feature + quota in code

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
    @EnforceQuota('notesMax') // 429 LimitExceeded when count(tenantId) >= 25 (Starter)
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

> Prerequisite: your app CLI registers `AdminBootstrapCommand` as a
> `nest-commander` subcommand, and `PrismaSuperAdminBootstrapAdapter` is
> registered in `CliContextModule.forRoot({ superAdminBootstrapPort })`.

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

The only thing left to do is adapt **`src/services/http.ts#adminLogin`** to
your backend auth.

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
import FeatureGate from '@saasicat/ui-vue/components/FeatureGate.vue';
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
#   → 25 ok, from #26 → 429 limit reached for notesMax: 25/25

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

1. **V3 contracts** instead of `defaultPlanId`: implement
   `SubscriptionRepository`, `PlanVersionRepository`, `TransactionRunner` →
   activate `entitlement: { ... }` in `SaasPlatformModule.forRoot()`.
   Schema templates in `prisma-fragments/01-subscription.prisma` and
   `prisma-fragments/03-plan-versions.prisma`.

2. **Catalog adapters** (`PlanRepository`, `BundleRepository`,
   `MarketingProjectionRepository`, `CatalogEntryRepository`) + wire
   `CatalogModule` — so the SuperAdmin UI can edit plans live.
   → [handbook](handbook.md), §6.3

3. **Manifest contributions** for your own SuperAdmin KPI cards, tenant
   actions and project pages. **Tenant navigation** contributions via
   `TenantManifestService.registerNavItem(...)` in `OnModuleInit`.
   → [handbook](handbook.md), §6.6

4. **Extend the CLI**: `notesapp manifest hash` (CI pinning),
   `notesapp audit tail`. Plus `defaultDoctorChecks: true` for the 4
   platform health checks.
   → [handbook](handbook.md), §9

5. **Tests:** `createSaasPlatformTestModule({ planCatalog, defaultPlanId, quotaProviders })`
   from `@saasicat/nest/testing` for integration tests without your own
   adapter setup.

---

## Common quickstart failures

| Symptom                                                 | Cause                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `saas-platform: command not found`                      | Use `pnpm exec saas-platform ...` or install globally: `pnpm i -g @saasicat/cli`.                              |
| `prisma-fragments/` directory not found                 | `@saasicat/spec` is missing from the backend deps. Repeat step 1.                                              |
| `Nest can't resolve dependencies of X (?, ...)`         | `SaasAdaptersModule` is not listed **before** `SaasPlatformModule.forRoot()` in `imports[]`.                   |
| Boot hangs with `P2028 "Unable to start a transaction"` | The RLS bypass did not take effect — `PrismaService` does not check `isBypassActive()`.                        |
| `discovery-snapshot.json` is empty                      | The module holding the decorators (`NotesModule`, `SaasAdaptersModule`) is missing from `AppModule.imports[]`. |
| `@RequireFeature` lets everything through               | Neither `defaultPlanId` nor `adapters.planResolver` is set → no static entitlement active.                     |
| `@EnforceQuota` never blocks                            | The `QuotaProvider` class is not listed in `quotaProviders: [...]` of `SaasPlatformModule.forRoot()`.          |
| `@RequireFeature('NOTES')` throws 403                   | The test tenant is not on a plan that includes `NOTES` — with `defaultPlanId` all tenants are equal.           |
| Discovery tabs stay empty                               | Vite cache holding a stale build. `rm -rf node_modules/.vite && pnpm dev`.                                     |
| Setup wizard does not appear / `403 SETUP_DISABLED`     | The `SETUP_TOKEN` env variable is not set, or a SUPER_ADMIN already exists (self-disable).                     |
| `tenantManifest` throws at boot                         | `tenantManifest` is active, but neither `defaultPlanId` nor `adapters.planResolver` is set.                    |

For deeper troubleshooting, see the [handbook](handbook.md), §11.
