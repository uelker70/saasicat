# Wire the backend

The long form of the backend half of the [quickstart](../quickstart.md): what
the platform needs from your NestJS application, and what each option in
`defineSaaSiCat` decides. Work through it once; afterwards
[the options reference](../reference/options.md) is the faster lookup.

- **Node.js 24+**, **pnpm 10+**.
- **NestJS 11+** with Fastify or Express adapter.
- **PostgreSQL** (the platform is PostgreSQL-first: transactions, row locks
  and optional RLS are part of the persistence contract — see
  [data model](../explanation/data-model.md)). The ready-made adapter package is
  `@saasicat/adapter-prisma` (Prisma 6) or `@saasicat/adapter-drizzle`
  (drizzle-orm, driver-independent); other ORMs/schemas plug in through
  the same ports and are held to the same semantics by
  `@saasicat/persistence-testing`.
- **Authentication**: JWT-based is recommended; a `JwtAuthGuard` equivalent
  must exist (passed into `controller.guards` of the platform modules).
- **Vue 3 + Quasar 2** for the admin frontend; Vite as the build tool.

## Installing Packages

```bash
# Backend
pnpm add @saasicat/spec @saasicat/core @saasicat/nest \
         @saasicat/adapter-prisma @saasicat/cli

# Admin frontend
pnpm add @saasicat/core @saasicat/ui-vue
```

For local development against a checkout of this repo, use
`pnpm.overrides` with `link:` paths (not `file:` — see the note below).

> **Important:** `file:` dependencies are **copied** by pnpm into `node_modules/.pnpm/...`,
> not symlinked. After a platform build you have to run `pnpm install` in the consumer
> so the new state is picked up. In the container setup, a
> helper script (e.g. `scripts/ensure-container-deps.cjs`) or a manual
> `pnpm install` in the container helps; afterwards **you must clear the Vite dev cache
> (`.vite/deps`) and restart the admin container**, otherwise Vite serves the
> old bundled version.

## The canonical schema

The data model has one normative source: the
[logical data model](../explanation/data-model.md) plus the SQL artifacts in
[`@saasicat/spec/sql/`](../../packages/spec/sql/)
(`reference-schema.postgres.sql` — full DDL, generated from the fragments;
`constraints.postgres.sql` — the invariants Prisma cannot express: partial
unique draft indexes, the subscription CHECK). The
[Prisma fragments](../../packages/spec/prisma-fragments/) are the
derived Prisma-DSL rendering of that model; `saasicat schema apply`
splices them into your `schema.prisma` (see the [quickstart](../quickstart.md)).
The JSON Schemas in `@saasicat/spec/schemas/` govern **wire formats**, not
tables.

`saasicat schema migrate` runs `apply`, then `prisma migrate dev --create-only`,
appends `constraints.postgres.sql` to the migration that produced, and applies
it — so the invariants Prisma cannot express arrive with the tables rather than
as a step to remember. `--create-only` is what makes that work: an applied
migration cannot take an edit, and Prisma would see its checksum change. It is
idempotent: a migration that already carries them is left alone.

`schema apply` only ever adds: it brings each fragment's enums and models, and
never touches a block you already have. So a field added to an existing model
in a later release does not arrive on its own, and after a package upgrade your
schema falls behind silently. `saasicat schema check` reports that gap:

```bash
pnpm exec saasicat schema check          # exit 1 on drift — gate CI on it
pnpm exec saasicat schema check --fragments=01,03
```

It fails on fields and enum values missing from declarations you **do** carry,
and on type/optionality changes, because platform code reads those with the
spec's type. A model or enum you do not carry at all is reported as
information, not as a failure — not adopting a fragment is a decision. Fields
you added on top of a platform model are never reported: extending them is
supported.

Ownership stays with the app: the platform ships the canonical tables and
constraints, while FK relations to your `Tenant`/`User` models and all RLS
policies remain app-specific (the fragments carry them as commented-out
examples). Canonical `@@map` table names (`subscriptions`, `plan_versions`,
`audit_logs`, `super_admin_users`, …) must not be renamed — the shipped
adapters and CLI commands rely on them.

Whether a schema/adapter combination actually delivers the required
semantics (row locks, atomic promo claims, rollback, tenant isolation) is
verified by the executable contract in `@saasicat/persistence-testing` —
CI runs it for `@saasicat/adapter-prisma` against a real PostgreSQL.

## App-Identity YAML

Create `config/saas.yaml` (schema:
`@saasicat/spec/schemas/plan-catalog.schema.json`). The file carries **only**
the app identity (branding + version) and the app-global marketing config —
source-of-truth separation:

- **App identity** (name, branding, version) → this file.
- **Features / quotas / capabilities** → code (`@ImplementsCapability`,
  `@DefinesQuota`), published via discovery.
- **Plans / bundles** → DB tables `plan` + `catalogPlanVersion` + `bundles`.
  The single source of truth is the SuperAdmin UI alone.

```yaml
schemaVersion: 1
app:
    name: MyApp
    label: MyApp Cockpit
currency: EUR
vatRate: 19.0
marketing:
    availableLocales: [de, en]
```

> `features:` and `plans:` are still allowed as optional blocks in the schema —
> only for static setups without an admin UI (tests, smoke environments).
> In production they are deliberately NOT maintained in the YAML.

## Loading the Plan Catalog at Boot

```ts
// app.module.ts
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';

const SAAS_CONFIG_PATH = process.env.MYAPP_SAAS_CONFIG_PATH ?? 'config/saas.yaml';
const SAAS_CONFIG = loadPlanCatalogFromFile({ path: SAAS_CONFIG_PATH });
```

`loadPlanCatalogFromFile` validates the YAML against the schema from
`@saasicat/spec` — errors throw early at boot.

## Standard Persistence Bundle (Prisma)

On the canonical schema, do not write one forwarding provider per repository.
`prismaPersistence()` already supplies the standard slices:

- core admin persistence, audit, MFA, RLS bypass and transactions;
- subscriptions, plan versions, contracts and booked bundles;
- plan, bundle, discovery-review, marketing and promotion repositories;
- tenant subscription read/write adapters;
- promo-code repositories and plan-catalog import/read sinks;
- the standard Tenant/User/Audit/Subscription resource adapter.

```ts
const persistence = prismaPersistence({
    client: PrismaService,
    passwordHasher: Argon2Hasher,
    adminResources: { tenantMetrics: ['users', 'storageItems'] },
});
```

The application still owns authentication and product logic. In particular,
each quota needs one `QuotaProvider` because only the application knows how to
count users, notes, storage or API calls. That same provider is reused for
runtime enforcement and the tenant usage response.

A custom schema or database can implement `SaaSiCatPersistenceAdapter` with
the same named slices. The fine-grained ports and individual modules remain
public; the bundle does not remove the extension points.

## Wiring the Standard AppModule

```ts
import { defineSaaSiCat, SaaSiCatModule } from '@saasicat/nest/platform';

@Module({
    imports: [
        PrismaModule,
        AuthModule,

        SaaSiCatModule.forRoot(
            defineSaaSiCat({
                planCatalog: SAAS_CONFIG,
                controller: { guards: [JwtAuthGuard, SuperAdminGuard] },
                imports: [PrismaModule, AuthModule],
                persistence,
                entitlement: {
                    resolutionConfig: { defaultTrialEntitlementPlan: 'STARTER' },
                },
                catalog: {
                    featureUiRegistry: MYAPP_FEATURE_UI_REGISTRY,
                    strictModeCheckMode: 'blocking',
                },
                tenantBilling: {
                    authGuards: [JwtAuthGuard, TenantGuard],
                },
                subscriptionBundles: true,
                setup: true,
                subscriptionContract: true,
                adminResources: true,
                promoCodes: true,
                quotaProviders: [UsersQuotaProvider, StorageGbQuotaProvider],
                tenantManifest: { guards: [JwtAuthGuard, TenantGuard] },
            }),
        ),

        MyAppDomainModule,
        MyAppAdminContributionModule,
    ],
})
export class AppModule {}
```

Keep this object in an app-owned `saasicat.config.ts` once it grows beyond a
small quickstart. `AppModule` then contains only
`SaaSiCatModule.forRoot(MY_APP_SAASICAT_CONFIG)`. The library owns module
composition; the client file contains only auth, branding and adapter choices
that are inherently application-specific.

`resolutionConfig` answers which plan's entitlements apply when the
subscription's own plan is not the whole story: during a trial, during a pilot,
while an enterprise deal waits on sales — and after a cancellation has taken
effect. That last one grants nothing by default, which is what ending a contract
means. Name a plan to keep a floor instead:

```ts
entitlement: {
    resolutionConfig: {
        defaultTrialEntitlementPlan: 'STARTER',
        // A read-only tier a former customer can still export from. Omit the
        // key and a subscription grants nothing once its cancellation lands.
        canceledEntitlementPlan: 'FREE',
    },
},
```

This configuration removes the usual app-owned plan resolver, catalog module,
billing module, subscription display mapper and duplicate usage snapshot.
SaaSiCat resolves active plans through the subscription repository and builds
usage from the registered quota providers.

`adminResources: true` mounts the standard tenant list/detail/actions, user,
audit and subscription endpoints. `promoCodes: true` mounts the full
SuperAdmin promo-code CRUD. Both add functionality to the standard API; they
do not remove pages from the Admin UI. Apps with a different schema replace
the single `AdminResourcesPort` while keeping the controllers and pages.

For a database-managed runtime catalog, replace `planCatalog` with:

```ts
dbCatalog: {
    app: SAAS_CONFIG.app,
    currency: SAAS_CONFIG.currency,
    vatRate: SAAS_CONFIG.vatRate,
    tenantBilling: SAAS_CONFIG.tenantBilling,
    marketing: SAAS_CONFIG.marketing,
}
```

Use the low-level `CatalogModule`, `EntitlementModule`,
`TenantBillingModule`, `SubscriptionBundleModule` and adapter options only
when the standard behavior does not fit. Payment-provider integration is a
separate future adapter boundary; it does not change capability discovery,
contracts or backend enforcement.

## Admin Module

`SaaSiCatModule` owns `PlatformAdminModule`, `AdminManifestModule` and the
optional `AdminStatsModule`. Configure them in `saasicat.config.ts`:

```ts
export const MY_APP_SAASICAT_CONFIG = defineSaaSiCat({
    // ...core options...
    includeManifestController: false, // the app owns the guarded route
    adminManifestExtraProviders: [AdminManifestConfigFactory],
    adminManifestConfig: {
        useFactory: (factory: AdminManifestConfigFactory) => factory.build(),
        inject: [AdminManifestConfigFactory],
    },
    adminStats: {
        extraProviders: [
            PrismaSubscriptionStatsPort,
            PrismaPromoCodeStatsPort,
            PrismaAuditStatsPort,
        ],
        subscriptionStatsPort: { useExisting: PrismaSubscriptionStatsPort },
        promoCodeStatsPort: { useExisting: PrismaPromoCodeStatsPort },
        auditStatsPort: { useExisting: PrismaAuditStatsPort },
    },
});
```

The app-owned `AdminModule` now contains only project controllers, services
and manifest contributions:

```ts
// admin/admin.module.ts
@Global()
@Module({
    controllers: [AdminController, AdminManifestController],
    providers: [AdminService],
    exports: [AdminService],
})
export class AdminModule implements OnModuleInit {
    constructor(private readonly manifest: AdminManifestService) {}

    onModuleInit(): void {
        this.manifest.register(MYAPP_CORE_MANIFEST_CONTRIBUTION);
        this.manifest.register(PROMO_CODES_MANIFEST_CONTRIBUTION);
        // … more contributions
    }
}
```

## Manifest Contributions

A contribution describes _what your app contributes to the SuperAdmin UI_ — which
capabilities it has, which standard pages are on/off, which KPI cards, which
tenant actions, which project pages (your own pages under `/admin/...`).

```ts
// admin/manifest-contributions/myapp-core.manifest.ts
import type { ManifestContribution } from '@saasicat/core';

export const MYAPP_CORE_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
        'tenants.read': true,
        'plans.read': true,
        'plans.write': true,
        'discovery.read': true,
    },

    navigation: {
        standardPages: {
            subscriptions: { enabled: false, requiredCapability: 'subscriptions.read' },
        },
        projectPages: [
            {
                id: 'myapp.report',
                path: '/admin/report',
                label: 'Auswertung',
                icon: 'analytics',
                requiredCapability: 'reports.read',
                component: 'MyAppReportPage', // resolved in the UI via lazy loader
            },
        ],
    },

    dashboard: {
        kpiCards: [
            {
                id: 'platform.tenants.active',
                label: 'Aktive Mandanten',
                endpoint: '/api/v1/admin/stats/dashboard',
                displayHint: { type: 'value+delta', icon: 'business' },
                slotPriority: 90,
                requiredCapability: 'dashboard.read',
            },
        ],
    },

    tenantActions: [
        {
            id: 'myapp.tenants.export',
            label: 'Daten exportieren',
            endpoint: '/api/v1/admin/tenants/:slug/export',
            method: 'POST',
            requiresMfa: true,
            requiredCapability: 'tenants.export',
        },
    ],
};
```

## Custom `AdminManifestController` with Caching + MFA

Disable the standard controller (`includeManifestController: false`) and write your
own that hooks in your app guards and does ETag caching:

```ts
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard, MfaGuard)
@UseInterceptors(AdminBypassRlsInterceptor)
export class AdminManifestController {
    constructor(private readonly manifest: AdminManifestService) {}

    @Get('manifest')
    @Header('Cache-Control', 'private, max-age=60, must-revalidate')
    getManifest(@Headers('if-none-match') ifNoneMatch?: string) {
        const m = this.manifest.getManifest();
        const etag = `"${m.build.manifestHash}"`;
        if (ifNoneMatch === etag) throw new HttpException('', HttpStatus.NOT_MODIFIED);
        return m;
    }

    @Post('manifest/reload')
    @RequireMfa()
    reload() {
        return this.manifest.rebuild();
    }
}
```

## Declaring Capabilities / Features / Quotas in Code

On your app's controllers:

```ts
// dms/dms.controller.ts
import { ImplementsCapability, EnforceQuota } from '@saasicat/nest/discovery';
import { RequireFeature } from '@saasicat/nest/billing';

@Controller('dms')
@UseGuards(JwtAuthGuard)
export class DmsController {
    @Post('upload')
    @ImplementsCapability('dms.upload', {
        label: 'Dokument ins DMS hochladen',
        feature: 'DMS',
        kind: 'endpoint',
        owner: 'dms',
    })
    @RequireFeature('DMS')
    @EnforceQuota('storageGb')
    async upload(@CurrentUser() user: AuthenticatedUser, @Req() req: FastifyRequest) {
        return this.dmsService.upload(user, req);
    }
}
```

On the quota providers:

```ts
// modules/platform-adapters/quota-providers.ts
@Injectable()
@DefinesQuota({
    key: 'storageGb',
    label: 'Belegter Speicher (GB)',
    unit: 'gigabyte',
    policy: 'hard',
    feature: 'DMS',
})
export class StorageGbQuotaProvider implements QuotaProvider {
    constructor(private readonly prisma: PrismaService) {}
    async count(tenantId: string): Promise<number> {
        const r = await this.prisma.dmsFile.aggregate({
            where: { tenantId },
            _sum: { sizeBytes: true },
        });
        return Number(r._sum.sizeBytes ?? 0) / 1024 / 1024 / 1024;
    }
}
```

> After adding/changing any decorator, the app must restart so the
> discovery snapshot is rewritten. Only then do the entries appear on the
> SuperAdmin discovery page.

## `AdminManifestConfigFactory`

Builds the static configuration for the manifest from the plan catalog, the environment
and `package.json`:

```ts
@Injectable()
export class AdminManifestConfigFactory {
    constructor(@Inject(PLAN_CATALOG_TOKEN) private readonly planCatalog: PlanCatalog) {}

    build(): AdminManifestConfig {
        return {
            project: {
                key: this.planCatalog.app.name,
                displayName: this.planCatalog.app.name,
                label: this.planCatalog.app.label,
                icon: this.planCatalog.app.icon,
                logoUrl: this.planCatalog.app.logoUrl,
                environment: this.resolveEnvironment(),
                availableLocales: this.planCatalog.marketing?.availableLocales,
                defaultLocale: this.planCatalog.marketing?.availableLocales?.[0],
            },
            build: {
                platformPackageVersion: readPackageVersion(
                    require.resolve('@saasicat/core/package.json'),
                ),
                appVersion: process.env.MYAPP_VERSION ?? '0.0.0',
            },
            planCatalogSnapshot: this.buildPlanCatalogSnapshot(),
        };
    }
    // …
}
```

---

## First-Run Setup (SuperAdmin Bootstrap via the Admin UI)

On the very first start there is no SUPER_ADMIN yet — so there's also nobody who could log in or
create an admin via CLI (chicken-and-egg). The `SetupModule` solves this with a **public,
self-locking** bootstrap endpoint that the shared login page automatically shows as a wizard.

**Security model (two barriers, both must be satisfied):**

1. **Self-disable** — setup runs only while `provisioningPort.countSuperAdmins() === 0`. After the
   first SUPER_ADMIN is created, the endpoint permanently responds with `409 SETUP_ALREADY_DONE`.
2. **Setup token** — a secret set by the operator (env var, default `SETUP_TOKEN`). Without the var
   set, setup is completely disabled (`403 SETUP_DISABLED`); the comparison is timing-safe.

This way, even with a publicly reachable app, nobody can "guess/grab" the first admin.

**You need exactly one app adapter** — the `SuperAdminProvisioningPort` (2 methods). A full
`UserManagementPort` adapter (CLI) satisfies it too, so it can be shared:

```ts
import { Injectable } from '@nestjs/common';
import {
    PlatformUserExistsError,
    type CreateSuperAdminCliInput,
    type PlatformUserDto,
    type SuperAdminProvisioningPort,
} from '@saasicat/core';

@Injectable()
export class PrismaSuperAdminProvisioningAdapter implements SuperAdminProvisioningPort {
    constructor(private readonly prisma: PrismaService) {}

    countSuperAdmins(): Promise<number> {
        return this.prisma.user.count({ where: { role: 'SUPER_ADMIN', deletedAt: null } });
    }

    async createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto> {
        const email = input.email.toLowerCase();
        const existing = await this.prisma.user.findUnique({ where: { email } });
        // IMPORTANT: throw the shared error — the SetupService maps it to
        // 409 EMAIL_EXISTS (otherwise 500). The guard is `code`-based (realm-safe).
        if (existing) throw new PlatformUserExistsError(email, existing.role);
        const user = await this.prisma.user.create({
            data: { email, passwordHash: await hash(input.password), role: 'SUPER_ADMIN' /* … */ },
        });
        return toPlatformUserDto(user); // password hashing stays app-specific (argon2/bcrypt)
    }
}
```

**Wiring (`AppModule`)** — `SetupModule` MUST come **after** `AdminModule.forRoot` (it injects its
global `MfaService` for MFA enrollment):

```ts
SetupModule.forRoot({
  global: true,
  provisioningPort: {
    useFactory: (prisma: PrismaService) => new PrismaSuperAdminProvisioningAdapter(prisma),
    inject: [PrismaService],
  },
  setupTokenEnvVar: 'SETUP_TOKEN',   // Default; the operator sets the env var
  mfaIssuer: 'MeineApp',             // shown in the authenticator
}),
```

This mounts three public routes under `${apiBase}` (e.g. `/api/v1/admin`):

| Route                      | Purpose                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET …/setup/status`       | `{ needsSetup }` — the login page queries this on mount                                              |
| `POST …/setup`             | creates the first SUPER_ADMIN + MFA enrollment → `{ userId, qrDataUrl, secret, generatedPassword? }` |
| `POST …/setup/confirm-mfa` | verifies the TOTP code (token-protected)                                                             |

When authentication is registered as a global `APP_GUARD`, it must return
early for `isSaaSiCatPublicRoute(reflector, context)`. SaaSiCat marks these
setup endpoints itself; the setup token and automatic self-disable remain the
protection for first-run provisioning.

The **QR code is generated server-side** as a data URL (`qrDataUrl`) — the frontend only renders
`<img>`, no QR dependency needed.

**Frontend:** Nothing to do if the app uses the shared `SuperAdminLoginPage` (see
[app bootstrap](build-the-admin-frontend.md#app-bootstrap)). On mount it calls `setup/status` and,
when `needsSetup`, renders the `SuperAdminSetupWizard` instead of the login form. Apps **without**
`SetupModule` get `404` → the wizard stays off, normal login.

> **Prerequisite & order:** `AdminModule.forRoot` imported globally; global `ValidationPipe` active
> (for the setup DTOs); `apiBase` in the admin UI = mount prefix of the `SetupController`.
