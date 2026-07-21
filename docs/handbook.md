# SaaS Platform — Handbook

Guide on how to make a NestJS or Express application SaaS-capable with the `@saasicat/*`
packages: tenants, plans, bundles, quotas, features, SuperAdmin UI,
MFA, audit, promo codes, checkout, subscription contracts.

> **Audience:** External developers / new teams deploying the platform for the first time.
> Assumes knowledge of NestJS, Prisma and Vue/Quasar, but **no** prior knowledge
> of the internal concepts (Capability, Feature, Quota, Bundle, Plan, Contract).
>
> **Quick start:** If you want to bolt the platform onto an existing NestJS
> app, start with the [Quickstart](saas-platform-quickstart.md) —
> 10 steps, ~60 minutes to a working SuperAdmin. This handbook is
> the reference work you'll need afterwards.

---

## Contents

1. [What the Platform Provides](#1-what-the-platform-provides)
2. [Concepts](#2-concepts)
3. [Architecture](#3-architecture)
4. [The Five Packages](#4-the-five-packages)
5. [Prerequisites](#5-prerequisites)
6. [NestJS Integration — Step by Step](#6-nestjs-integration--step-by-step)
7. [Express Integration](#7-express-integration)
8. [Admin Frontend (Vue/Quasar)](#8-admin-frontend-vuequasar)
9. [CLI Integration](#9-cli-integration)
10. [Verification Checklist](#10-verification-checklist)
11. [Common Pitfalls](#11-common-pitfalls)
12. [Further Reading](#12-further-reading)

---

## 1. What the Platform Provides

A ready-built SuperAdmin layer for your app:

- **Tenant management** (listing, detail, suspend/reactivate, impersonate, export).
- **Plans & plan versions** (CRUD incl. plan editor, audit, bundle persistence).
- **Bundles & business types** (versioned product options, marketing projection).
- **Discovery loop** (code declares capabilities/features/quotas via decorators → the platform
  scans → SuperAdmin reviews → released entries are translated in the marketing catalog
  and mapped to plans).
- **Marketing catalog** (i18n labels, descriptions, highlights, promo actions) including a
  public REST endpoint (`/public/catalog`) for pricing pages.
- **Checkout offer + subscription contract** (V3): frozen purchase intents → immutable
  contracts as the single source for billing and entitlement.
- **Entitlement** at runtime (`@RequireFeature`, `@EnforceQuota`); missing features
  respond with a structured 403 (`code: FEATURE_NOT_LICENSED` + upsell `offers`
  via the optional `UpsellOfferResolver` port).
- **MFA (TOTP)** for SuperAdmin actions, **AuditService** for every sensitive operation,
  **RLS bypass interceptor** for global reads.
- **Promo codes** (generator, lifecycle, redemption tracking).
- **CLI building blocks** (`<app> admin mfa-setup|whoami`, `<app> audit tail`, `<app> doctor`,
  `<app> manifest dump|hash|validate|check`).
- **Vue/Quasar standard pages** that are dynamically toggled active/inactive via the
  manifest — you just wire them in as routes and pass data through.

You implement:

- persistence (Prisma adapters to the platform ports — see §6.3),
- app-specific capabilities (`@ImplementsCapability(...)` on your controllers),
- manifest contributions (which KPI cards, tenant actions, project pages your app adds),
- app-specific quota providers (`count(tenantId)` for each quota).

Everything else comes from the packages.

---

## 2. Concepts

The platform cleanly separates **code reality**, **product definition** and **sold contract**:

| Concept                        | Meaning                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capability**                 | A concrete capability in code, declared with `@ImplementsCapability('dms.upload', {...})`. Atomic technical unit, e.g. an endpoint.                                                                                                   |
| **Feature**                    | Marketable bundle of several capabilities (e.g. `DMS` = upload + download + preview). Translated in the marketing catalog, mapped to prices, referenced in plans.                                                                     |
| **Quota**                      | Numeric limit (e.g. `users=10`, `storageGb=5`). Declared with `@DefinesQuota(...)` on a `QuotaProvider` that provides `count(tenantId)`. Enforced at endpoints via `@EnforceQuota('users')`.                                          |
| **Discovery snapshot**         | Static snapshot of all decorator calls (capabilities, features, quotas) that the platform writes to `var/discovery-snapshot.json` at boot. Feeds the SuperAdmin discovery page.                                                       |
| **Catalog-Entry**              | DB-projected view of a capability/feature/quota with lifecycle status (`discovered → accepted → active → deprecated → retired` / `ignored`).                                                                                          |
| **Bundle**                     | Versioned grouping of features + quota effects — bookable on its own or included in plan versions (addon sales removed, #49).                                                                                                         |
| **Plan / Plan version**        | Sales offer with price, included features, quota limits. Plan = immutable identifier, plan version = published snapshot.                                                                                                              |
| **Checkout-Offer**             | Frozen offer (plan + bundles + cycle + price + validity date) before a contract is created.                                                                                                                                           |
| **Subscription-Contract** (V3) | Immutable contract created at purchase time from the checkout offer. **Single source** for billing and entitlement at runtime. On plan change: new contract, old contract becomes `superseded`.                                       |
| **Entitlement-Snapshot**       | Aggregated view of all features and quota limits from a tenant's active contract line items. Computed at runtime by `EntitlementService`.                                                                                             |
| **Manifest**                   | UI discovery projection of your app (`/api/v1/admin/manifest`): which standard pages are active, which project pages your app adds, which KPI cards, which tenant actions. Spec: `@saasicat/spec/schemas/admin-manifest.schema.json`. |

**Rule of thumb:** Capability is _technical_, Feature is _marketable_, Quota is _countable_,
Plan is _sellable_, Contract is _sold_.

**Sales model (since v1.5.0, #49):** Only **plan versions** and
**bundles** are sold; a tenant's effective features/quotas are
the union of plan ∪ booked bundles. The SSOT for plans, bundles and prices
is the AdminUI — seeds may only create drafts (`publishedAt = null`);
publishing happens exclusively in the AdminUI (bundle publish requires
`validFrom`).

---

## 3. Architecture

### 3.1 Data Flow

```text
┌──────────────────────────────────────────────────────────────────┐
│ App code                                                         │
│  @ImplementsCapability('dms.upload', {...})                      │
│  @DefinesQuota({ key: 'storageGb', ... })                        │
│  @EnforceQuota('storageGb')                                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │ (boot scan)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ DiscoveryModule  →  var/discovery-snapshot.json                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ CatalogEntryRepository  (DB projection with lifecycle)           │
│   - capability_catalog_entry                                     │
│   - feature_catalog_entry                                        │
│   - quota_catalog_entry                                          │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼                                ▼
┌─────────────────────────────┐   ┌────────────────────────────────┐
│ SuperAdmin-UI               │   │ AdminManifestService           │
│  - Discovery page (review)  │   │  → /api/v1/admin/manifest      │
│  - Marketing catalog page   │   │  (KPI cards, nav, actions)     │
│  - Bundles page             │   └────────────────────────────────┘
│  - Plans page               │
└─────────────┬───────────────┘
              │ (publish)
              ▼
┌──────────────────────────────────────────────────────────────────┐
│ PlanRepository / BundleRepository                                │
│   - plan, plan_version                                           │
│   - catalog_bundle, catalog_bundle_version                       │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ PublicMarketingCatalog  →  GET /public/catalog                   │
│   (the app's pricing page reads here — never compute locally)    │
└─────────────────┬────────────────────────────────────────────────┘
                  │ (customer selects)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ CheckoutOfferService    →  GET /api/v1/checkout/offer/:id        │
│   (frozen selection with expiry date)                            │
└─────────────────┬────────────────────────────────────────────────┘
                  │ (payment)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ SubscriptionContractService    (immutable!)                      │
│   - subscription_contract                                        │
│   - contract_line_item                                           │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ EntitlementService    (runtime aggregation from contracts)       │
│   - @RequireFeature('DMS')  →  403 if not included               │
│   - @EnforceQuota('storageGb')  →  LimitExceededError            │
└──────────────────────────────────────────────────────────────────┘
```

**Most important architecture invariant:** The subscription contract is **immutable**.
If the SuperAdmin UI later changes a plan, that is a _new_ version —
running contracts remain untouched. This way a live catalog edit can never
retroactively break historical invoices or quotas.

### 3.2 Three-Layer Wiring in the Consumer

```text
┌──────────────────────────────────────────────────────────────────┐
│ Backend (NestJS)                                                 │
│  ├─ PlatformAdaptersModule  (your Prisma implementations)        │
│  ├─ PlanCatalogModule.forRoot({ sink: PrismaPlanCatalogReadSink })│
│  ├─ DiscoveryModule.forRoot({ app, controller, snapshotPath })   │
│  ├─ CatalogModule.forRoot({ ...Repositories })                   │
│  ├─ CheckoutOfferModule.forRoot({ ...Repositories })             │
│  ├─ SubscriptionContractModule.forRoot({ ... })                  │
│  ├─ EntitlementModule.forRoot({ ... })                           │
│  └─ AdminModule (= PlatformAdminModule + your AdminController)   │
├──────────────────────────────────────────────────────────────────┤
│ Admin frontend (Vue 3 + Quasar)                                  │
│  ├─ createPlatformLoaders({ endpoints, http, getAuthToken })     │
│  ├─ createManifestStore({ loader })                              │
│  ├─ Standard pages from @saasicat/ui-vue/pages/... │
│  └─ createSuperAdminApp({ loginAdapter, actions, ... })          │
├──────────────────────────────────────────────────────────────────┤
│ CLI (nest-commander)                                             │
│  └─ CliContextModule.forRoot({ config, userPort, ..., flows })   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. The Five Packages

| Package            | Contents                                                                                                                                                 | Consumed by                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@saasicat/spec`   | JSON schemas (manifest, plan catalog, promo code, audit event), OpenAPI, acceptance test scenarios. **Language-neutral.**                                | Backend & any other languages |
| `@saasicat/types`  | TypeScript interfaces derived from the schemas (`AdminManifest`, `PlanCatalog`, `Subscription`, `Ports`).                                                | Backend & frontend            |
| `@saasicat/nest`   | NestJS modules/services/decorators/guards (`AdminModule`, `DiscoveryModule`, `CatalogModule`, `EntitlementModule`, …).                                   | Backend                       |
| `@saasicat/ui-vue` | Vue/Quasar components, Pinia stores, composables (`useDiscovery`, `useCatalogEntries`), standard pages (`DiscoveryPage`, `TenantsPage`, `PlansPage`, …). | Frontend                      |
| `@saasicat/cli`    | `nest-commander` flows (`ManifestCliFlow`, `MfaSetupFlow`, `AuditTailFlow`, `DoctorFlow`) for your app CLI.                                              | Backend (CLI submodule)       |

### 4.1 `saas-platform-nest` — Sub-Entries

Always import the sub-entry, never the root:

```ts
import { PlanCatalogModule, loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import {
    DiscoveryModule,
    ImplementsCapability,
    DefinesQuota,
    EnforceQuota,
} from '@saasicat/nest/discovery';
import { CatalogModule } from '@saasicat/nest/catalog';
import { CheckoutOfferModule } from '@saasicat/nest/checkout-offer';
import { SubscriptionContractModule } from '@saasicat/nest/subscription-contract';
import {
    EntitlementModule,
    EntitlementService,
    LimitExceededError,
} from '@saasicat/nest/entitlement';
import {
    AdminModule as PlatformAdminModule,
    SuperAdminGuard,
    MfaGuard,
    RequireMfa,
    AdminBypassRlsInterceptor,
} from '@saasicat/nest/admin';
import { RegistrationModule } from '@saasicat/nest/registration';
```

### 4.2 Standard Pages from `saas-platform-ui-vue`

Path: `node_modules/@saasicat/ui-vue/src/pages-standard/`.

| Page                                     | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `SuperAdminLoginPage`                    | Login form                                                 |
| `AdminLayout`                            | Sidebar, nav guard, MFA prompt                             |
| `DashboardPage`                          | KPI cards (fed by the manifest)                            |
| `TenantsPage` / `TenantDetailPage`       | Tenant management + actions                                |
| `PlansPage` / `PlanVersionsPage`         | Plans, plan editor, version diff                           |
| `BundlesPage`                            | Bundle/BundleVersion CRUD                                  |
| `BusinessTypesPage`                      | Business types (optionally enabled via the manifest)       |
| `DiscoveryPage`                          | Capability/feature/quota review with lifecycle transitions |
| `MarketingCatalogPage`                   | i18n marketing texts + pricing actions                     |
| `SubscriptionsPage`                      | Contract management (V3)                                   |
| `AuditPage`                              | Audit log browser                                          |
| `UsersPage`                              | SuperAdmin user management (MFA, password reset, role)     |
| `PilotsPage`                             | Pilot feature grants (feature flags)                       |
| `PromoCodesPage` / `PromoCodeDetailPage` | Promo code CRUD + redemption tracking                      |

---

## 5. Prerequisites

- **Node.js 24+**, **pnpm 10+**.
- **NestJS 11+** with Fastify or Express adapter.
- **Prisma 5+** with PostgreSQL (RLS support desired — the platform requires an
  `RlsBypassPort`).
- **Authentication**: JWT-based is recommended; a `JwtAuthGuard` equivalent
  must exist (passed into `controller.guards` of the platform modules).
- **Vue 3 + Quasar 2** for the admin frontend; Vite as the build tool.

### 5.1 Installing Packages

```bash
# Backend
pnpm add @saasicat/spec @saasicat/types @saasicat/nest @saasicat/cli

# Admin frontend
pnpm add @saasicat/types @saasicat/ui-vue
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

### 5.2 Prisma Schema Fragments

The platform modules (as of 2026-05) provide **no ready-made Prisma schema fragments**.
You have to create the following tables yourself. The normative source is the
JSON schema contract in [`@saasicat/spec/schemas/`](../packages/saas-platform-spec/schemas/)
plus the TypeScript interfaces in [`@saasicat/types/src/`](../packages/saas-platform-types/src/).
The [Quickstart §3](saas-platform-quickstart.md#schritt-3--prisma-schema-erg%C3%A4nzen)
shows a complete minimal schema for copy-paste. The relevant table families:

- `capabilityCatalogEntry`, `featureCatalogEntry`, `quotaCatalogEntry` (discovery projection)
- `plan`, `catalogPlanVersion`
- `catalogBundle`, `catalogBundleVersion`
- `catalogBusinessType`, `catalogBusinessTypeVersion`
- `catalogMarketingProjection`, `marketingSettings`
- `checkoutOffer`
- `subscriptionContract`, `contractLineItem`
- `promoCode`, `promoCodeRedemption`
- `auditEntry`
- `superAdminUser`, `superAdminMfa`

Schema snippets are deliberately not shipped in the platform package — every app maintains
its own schema (constraints, indexes and RLS policies are app-specific). A
ready-made minimal schema is in the [Quickstart §3](saas-platform-quickstart.md#schritt-3--prisma-schema-erg%C3%A4nzen).

---

## 6. NestJS Integration — Step by Step

### 6.1 App-Identity YAML

Create `config/saas.yaml` (schema:
`@saasicat/spec/schemas/plan-catalog.schema.json`). The file carries **only**
the app identity (branding + version) and the app-global marketing config —
source-of-truth separation:

- **App identity** (branding, version, project key) → this file.
- **Features / quotas / capabilities** → code (`@ImplementsCapability`,
  `@DefinesQuota`), published via discovery.
- **Plans / bundles** → DB tables `plan` + `catalogPlanVersion` + `bundles`.
  The single source of truth is the SuperAdmin UI alone.

```yaml
schemaVersion: 1
projectKey: myapp
app:
    key: myapp
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

### 6.2 Loading the Plan Catalog at Boot

```ts
// app.module.ts
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';

const SAAS_CONFIG_PATH = process.env.MYAPP_SAAS_CONFIG_PATH ?? 'config/saas.yaml';
const SAAS_CONFIG = loadPlanCatalogFromFile({ path: SAAS_CONFIG_PATH });
```

`loadPlanCatalogFromFile` validates the YAML against the schema from
`saas-platform-spec` — errors throw early at boot.

### 6.3 Platform Adapters Module (Prisma)

This is the biggest task for the consumer. One `@Injectable` class per port that implements
the interface from `@saasicat/types/ports` (or the specific repository
interfaces from the `saas-platform-nest` sub-entries).

| Adapter                                           | Interface (from)                 | What to do                                                                   |
| ------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `PrismaPlanCatalogReadSink`                       | `PlanCatalogReadSink`            | **Boot read-only** snapshot of plans + versions; set the RLS bypass context! |
| `PrismaPlanRepository`                            | `PlanRepository`                 | CRUD for `plan` + `catalogPlanVersion` (consumed by the SuperAdmin UI)       |
| `PrismaBundleRepository`                          | `BundleRepository`               | CRUD for `catalogBundle` + `catalogBundleVersion`                            |
| `PrismaBusinessTypeRepository`                    | `BusinessTypeRepository`         | CRUD for `catalogBusinessType` + `catalogBusinessTypeVersion`                |
| `PrismaCatalogEntryRepository`                    | `CatalogEntryRepository`         | Lifecycle transitions + i18n storage for capability/feature/quota            |
| `PrismaMarketingProjectionRepository`             | `MarketingProjectionRepository`  | i18n marketing texts (label, description, highlights per locale)             |
| `PrismaMarketingSettingsRepository`               | `MarketingSettingsRepository`    | Active locales                                                               |
| `PrismaPromotionRepository`                       | `PromotionRepository`            | Time-limited pricing actions                                                 |
| `PrismaCheckoutOfferRepository`                   | `CheckoutOfferRepository`        | Frozen checkout snapshots                                                    |
| `PrismaSubscriptionContractRepository`            | `SubscriptionContractRepository` | Append-only immutable contracts                                              |
| `UsersQuotaProvider`, `StorageGbQuotaProvider`, … | `QuotaProvider` (one per quota)  | `count(tenantId): Promise<number>`; decorate with `@DefinesQuota({...})`     |
| `PrismaMfaAdapter`                                | `MfaPort`                        | TOTP setup, verify, disable                                                  |
| `PrismaAuditAdapter`                              | `AuditPort`                      | Write audit entry                                                            |
| `AsyncLocalRlsBypassAdapter`                      | `RlsBypassPort`                  | Platform: `node:async_hooks`-based; usually reusable 1:1                     |

Bundle everything in a **`@Global()` module** so the DynamicModule factories can resolve the
adapters via `inject:`:

```ts
// modules/platform-adapters/platform-adapters.module.ts
@Global()
@Module({
    imports: [PrismaModule],
    providers: [
        PrismaPlanCatalogReadSink,
        PrismaPlanRepository,
        PrismaBundleRepository,
        /* … */
        UsersQuotaProvider,
        StorageGbQuotaProvider,
        PrismaMfaAdapter,
        PrismaAuditAdapter,
        { provide: 'RLS_BYPASS_PORT', useClass: AsyncLocalRlsBypassAdapter },
    ],
    exports: [/* ditto */],
})
export class PlatformAdaptersModule {}
```

### 6.4 Wiring the AppModule

> **Order matters.** `PlatformAdaptersModule` must appear in `imports[]` **before** the
> `DynamicModule.forRoot(...)` calls, otherwise the factories cannot resolve
> their `inject:` tokens.

```ts
// app.module.ts
@Module({
    imports: [
        PrismaModule,
        AuthModule,
        PlatformAdaptersModule,

        PlanCatalogModule.forRoot({
            projectKey: SAAS_CONFIG.projectKey,
            app: SAAS_CONFIG.app,
            currency: SAAS_CONFIG.currency,
            vatRate: SAAS_CONFIG.vatRate,
            marketing: SAAS_CONFIG.marketing,
            imports: [PlatformAdaptersModule],
            sink: {
                useFactory: (s: PrismaPlanCatalogReadSink) => s,
                inject: [PrismaPlanCatalogReadSink],
            },
        }),

        DiscoveryModule.forRoot({
            app: { key: 'myapp', version: '0.0.1' },
            controller: { guards: [JwtAuthGuard] },
            imports: [AuthModule],
            snapshotPath:
                process.env.MYAPP_DISCOVERY_SNAPSHOT_PATH ?? 'var/discovery-snapshot.json',
        }),

        CatalogModule.forRoot({
            bundleRepository: { useExisting: PrismaBundleRepository },
            businessTypeRepository: { useExisting: PrismaBusinessTypeRepository },
            catalogEntryRepository: { useExisting: PrismaCatalogEntryRepository },
            marketingProjectionRepository: { useExisting: PrismaMarketingProjectionRepository },
            planRepository: { useExisting: PrismaPlanRepository },
            controller: { guards: [JwtAuthGuard] },
            imports: [AuthModule],
            strictModeCheckMode: 'blocking', // Default (#12); 'warn-only' as a transition until 100% discovery coverage
            publicMarketingCatalog: {
                guards: [], // public
                projectKey: 'myapp',
                currency: 'EUR',
                vatRate: 19.0,
            },
        }),

        CheckoutOfferModule.forRoot({
            checkoutOfferRepository: { useExisting: PrismaCheckoutOfferRepository },
            bundleRepository: { useExisting: PrismaBundleRepository },
            planRepository: { useExisting: PrismaPlanRepository },
            controller: { guards: [] }, // pre-tenant, public
        }),

        SubscriptionContractModule.forRoot({
            contractRepository: { useExisting: PrismaSubscriptionContractRepository },
            controller: { guards: [JwtAuthGuard] },
        }),

        EntitlementModule.forRoot({
            contractRepository: { useExisting: PrismaSubscriptionContractRepository },
        }),

        AdminModule, // your own module, see 6.5
    ],
})
export class AppModule {}
```

### 6.5 Admin Module

Your own `AdminModule` bundles `PlatformAdminModule`, `AdminManifestModule`,
`AdminStatsModule` and registers your manifest contributions in `onModuleInit`:

```ts
// admin/admin.module.ts
@Global()
@Module({
    imports: [
        PlatformAdminModule.forRoot({
            mfaPort: { useExisting: PrismaMfaAdapter },
            auditPort: { useExisting: PrismaAuditAdapter },
            rlsBypassPort: new AsyncLocalRlsBypassAdapter(),
        }),
        AdminManifestModule.forRoot({
            includeManifestController: false, // we build our own, see 6.7
            extraProviders: [AdminManifestConfigFactory],
            config: {
                useFactory: (f: AdminManifestConfigFactory) => f.build(),
                inject: [AdminManifestConfigFactory],
            },
        }),
        AdminStatsModule.forRoot({
            imports: [PrismaModule],
            extraProviders: [
                PrismaSubscriptionStatsPort,
                PrismaPromoCodeStatsPort,
                PrismaAuditStatsPort,
            ],
            subscriptionStatsPort: { useExisting: PrismaSubscriptionStatsPort },
            promoCodeStatsPort: { useExisting: PrismaPromoCodeStatsPort },
            auditStatsPort: { useExisting: PrismaAuditStatsPort },
        }),
    ],
    controllers: [AdminController, AdminManifestController],
    providers: [AdminService, AdminManifestConfigFactory],
    exports: [PlatformAdminModule, AdminManifestModule, AdminService],
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

### 6.6 Manifest Contributions

A contribution describes _what your app contributes to the SuperAdmin UI_ — which
capabilities it has, which standard pages are on/off, which KPI cards, which
tenant actions, which project pages (your own pages under `/admin/...`).

```ts
// admin/manifest-contributions/myapp-core.manifest.ts
import type { ManifestContribution } from '@saasicat/types';

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
            planVersions: { enabled: false }, // integrated in the Plans cockpit
            businessTypes: { enabled: false },
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
                endpoint: '/api/v1/admin/dashboard/stats',
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

### 6.7 Custom `AdminManifestController` with Caching + MFA

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

### 6.8 Declaring Capabilities / Features / Quotas in Code

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

### 6.9 `AdminManifestConfigFactory`

Builds the static configuration for the manifest from the plan catalog, the environment
and `package.json`:

```ts
@Injectable()
export class AdminManifestConfigFactory {
    constructor(@Inject(PLAN_CATALOG_TOKEN) private readonly planCatalog: PlanCatalog) {}

    build(): AdminManifestConfig {
        return {
            project: {
                key: this.planCatalog.projectKey,
                displayName: this.planCatalog.app?.name ?? this.planCatalog.projectKey,
                label: this.planCatalog.app?.label,
                icon: this.planCatalog.app?.icon,
                logoUrl: this.planCatalog.app?.logoUrl,
                environment: this.resolveEnvironment(),
                availableLocales: this.planCatalog.marketing?.availableLocales,
                defaultLocale: this.planCatalog.marketing?.availableLocales?.[0],
            },
            build: {
                platformPackageVersion: readPackageVersion(
                    require.resolve('@saasicat/types/package.json'),
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

### 6.10 First-Run Setup (SuperAdmin Bootstrap via the Admin UI)

On the very first start there is no SUPER_ADMIN yet — so there's also nobody who could log in or create an admin via CLI (chicken-and-egg). The `SetupModule` solves this with a **public, self-locking** bootstrap endpoint that the shared login page automatically shows as a wizard.

**Security model (two barriers, both must be satisfied):**

1. **Self-disable** — setup runs only while `provisioningPort.countSuperAdmins() === 0`. After the first SUPER_ADMIN is created, the endpoint permanently responds with `409 SETUP_ALREADY_DONE`.
2. **Setup token** — a secret set by the operator (env var, default `SETUP_TOKEN`). Without the var set, setup is completely disabled (`403 SETUP_DISABLED`); the comparison is timing-safe.

This way, even with a publicly reachable app, nobody can "guess/grab" the first admin.

**You need exactly one app adapter** — the `SuperAdminProvisioningPort` (2 methods). A full `UserManagementPort` adapter (CLI) satisfies it too, so it can be shared:

```ts
import { Injectable } from '@nestjs/common';
import {
    PlatformUserExistsError,
    type CreateSuperAdminCliInput,
    type PlatformUserDto,
    type SuperAdminProvisioningPort,
} from '@saasicat/types';

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

**Wiring (`AppModule`)** — `SetupModule` MUST come **after** `AdminModule.forRoot` (it injects its global `MfaService` for MFA enrollment):

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

The **QR code is generated server-side** as a data URL (`qrDataUrl`) — the frontend only renders `<img>`, no QR dependency needed.

**Frontend:** Nothing to do if the app uses the shared `SuperAdminLoginPage` (see §8.4). On mount it calls `setup/status` and, when `needsSetup`, renders the `SuperAdminSetupWizard` instead of the login form. Apps **without** `SetupModule` get `404` → the wizard stays off, normal login.

> **Prerequisite & order:** `AdminModule.forRoot` imported globally; global `ValidationPipe` active (for the setup DTOs); `apiBase` in the admin UI = mount prefix of the `SetupController`.

---

## 7. Express Integration

The platform is **NestJS-native**. A pure Express app has two options:

### 7.1 Mount NestJS Standalone Behind Express (recommended)

NestJS supports both Fastify and Express as HTTP adapters; an existing
Express app can run the SaaS endpoints as a sub-app.

```ts
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const root = express();
root.use('/legacy', myExistingExpressApp);

const saasExpressInstance = express();
const nest = await NestFactory.create(AppModule, new ExpressAdapter(saasExpressInstance));
await nest.init();

root.use('/', saasExpressInstance); // /api/v1/admin/* etc.
root.listen(3000);
```

Advantages: all decorators, guards, interceptors work unchanged; all
standard pages of the SuperAdmin UI run without modification.

### 7.2 Pure Express App Without NestJS

Only sensible if you don't want NestJS. You then use exclusively:

- `@saasicat/types` (TypeScript interfaces)
- `@saasicat/spec` (JSON schemas + OpenAPI as contract)
- `@saasicat/nest/promo` (pure functions)
- `@saasicat/nest/billing` → `aggregateLimits`, `version-publish`, `version-renewal` (pure functions)
- `@saasicat/nest/entitlement` → `aggregateLimits`, `resolveEntitlementPlan`, `LimitExceededError`

and implement the **endpoints**, **guards**, **audit**, **MFA**, **RLS bypass**,
**discovery scan** yourself against the schemas in `saas-platform-spec/admin-api.openapi.yaml`.
This is essentially a _reimplementation_ of the platform modules — sensible only
for a completely different language (e.g. Django/Python).

> Recommendation: option 7.1. Option 7.2 is explicitly meant for foreign-language backends
> and should be avoided in a pure Node codebase.

---

## 8. Admin Frontend (Vue/Quasar)

### 8.1 Platform Loaders

Wrap one HTTP client per app (Axios or Fetch) and pass it to `createPlatformLoaders`
— it assembles the endpoints and handles ETag caching.

```ts
// services/platform-loaders.ts
import { createPlatformLoaders, type HttpClient } from '@saasicat/ui-vue';
import { api } from './api';

export const ADMIN_ENDPOINTS = { apiBase: '/api/v1/admin' };

const httpClient: HttpClient = async (url, init) => {
    const stripped = url.startsWith('/api/v1') ? url.slice(7) : url;
    const response = await api.request({
        url: stripped,
        method: init?.method ?? 'GET',
        headers: init?.headers,
        data: init?.body,
        validateStatus: (s) => s < 500,
    });
    return {
        status: response.status,
        headers: {
            get: (n) => {
                const v = response.headers[n.toLowerCase()];
                return v == null ? null : String(v);
            },
        },
        json: async () => response.data,
        text: async () =>
            typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    };
};

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: httpClient,
    storageKeyPrefix: 'myapp:',
    getAuthToken: () => localStorage.getItem('myapp-admin-token'),
});

export const platformHttpClient = httpClient;
```

### 8.2 Manifest Store

```ts
// stores/manifest.ts
import { createManifestStore } from '@saasicat/ui-vue';
import { loaders } from '../services/platform-loaders';

export const useManifestStore = createManifestStore({
    loader: loaders.manifestLoader,
    id: 'admin-manifest',
});
```

### 8.3 Router

```ts
// router/index.ts
import { createProjectPageHostRoute } from '@saasicat/ui-vue';
import SuperAdminLoginPage from '@saasicat/ui-vue/pages/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/pages/AdminLayout.vue';
import AdminDiscoveryPage from '../pages/AdminDiscoveryPage.vue';
import AdminTenantsPage from '../pages/AdminTenantsPage.vue';
import AdminPlansPage from '../pages/AdminPlansPage.vue';
// …

export const adminRoutes = [
    { path: '/login', component: SuperAdminLoginPage, meta: { public: true } },
    {
        path: '/admin-error',
        component: () => import('@saasicat/ui-vue/pages/AdminManifestErrorPage.vue'),
        meta: { public: true },
    },
    {
        path: '/admin',
        component: AdminLayout,
        children: [
            { path: '', redirect: '/admin/dashboard' },
            { path: 'dashboard', component: () => import('../pages/AdminDashboardPage.vue') },
            { path: 'tenants', component: AdminTenantsPage },
            { path: 'plans', component: AdminPlansPage },
            { path: 'bundles', component: () => import('../pages/AdminBundlesPage.vue') },
            { path: 'discovery', component: AdminDiscoveryPage },
            {
                path: 'marketing-catalog',
                component: () => import('../pages/AdminMarketingCatalogPage.vue'),
            },
            { path: 'audit', component: () => import('../pages/AdminAuditPage.vue') },
            // …
            createProjectPageHostRoute(), // Catch-all for manifest project pages
        ],
    },
];
```

### 8.4 App Bootstrap

```ts
// main.ts
import {
    createSuperAdminApp,
    type SuperAdminLoginAdapter,
    type ActionsMap,
} from '@saasicat/ui-vue';
import { ADMIN_ENDPOINTS, loaders } from './services/platform-loaders';
import { adminApi } from './services/admin-api';
import { useAuthStore } from './stores/auth';

const loginAdapter: SuperAdminLoginAdapter = {
    async login(email, password) {
        const result = await useAuthStore().login(email, password);
        return result.ok ? { ok: true } : { ok: false, code: result.reason };
    },
};

const actions: ActionsMap = {
    'tenants.suspend': (i) => adminApi.tenants.suspend(i.row.slug, i.payload),
    'tenants.reactivate': (i) => adminApi.tenants.reactivate(i.row.slug),
    'myapp.tenants.export': (i) => adminApi.tenants.export(i.row.slug),
    // … list all actions declared in the manifest
};

const app = createSuperAdminApp({
    loginAdapter,
    endpoints: ADMIN_ENDPOINTS,
    loaders,
    actions,
    manifestErrorRoute: '/admin-error',
});

app.mount('#app');
```

### 8.5 Wrapper Pages: Dumb Components with Data Composables

Platform pages are deliberately _dumb_: they receive data + callbacks as props.
In the consumer, a thin wrapper marries composables to the page.
Example `AdminDiscoveryPage`:

```vue
<template>
    <PlatformDiscoveryPage
        :snapshot="snapshot"
        :capabilities="capabilities"
        :features="features"
        :quotas="quotas"
        :loading="loading"
        :error="error"
        :active-locales="activeLocales"
        :run-discovery="runDiscovery"
        :review-capability="reviewCapability"
        :set-feature-i18n="setFeatureI18n"
        :set-quota-i18n="setQuotaI18n"
        :set-feature-base="setFeatureBase"
        :set-quota-base="setQuotaBase"
    />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useCatalogEntries, useDiscovery } from '@saasicat/ui-vue';
import PlatformDiscoveryPage from '@saasicat/ui-vue/pages/DiscoveryPage.vue';
import { platformHttpClient } from '../services/platform-loaders';
import { useManifestStore } from '../stores/manifest';

const {
    snapshot,
    loading: snapLoading,
    error: snapError,
    reload,
    rescan,
} = useDiscovery({ endpoint: '/api/v1/admin/discovery', http: platformHttpClient });

const {
    capabilities,
    features,
    quotas,
    loading: entriesLoading,
    error: entriesError,
    load,
    reviewCapability,
    setFeatureI18n,
    setQuotaI18n,
    setFeatureBase,
    setQuotaBase,
    syncDiscovery,
} = useCatalogEntries({
    adminEndpoint: '/api/v1/admin',
    projectKey: 'myapp',
    http: platformHttpClient,
});

const manifestStore = useManifestStore();
const activeLocales = computed(() => manifestStore.manifest?.project?.availableLocales ?? ['de']);
const loading = computed(() => snapLoading.value || entriesLoading.value);
const error = computed(() => snapError.value ?? entriesError.value);

async function runDiscovery(): Promise<void> {
    await rescan();
    if (snapshot.value) await syncDiscovery(snapshot.value);
}

onMounted(() => {
    void load();
    void reload();
});
</script>
```

> **Anti-pattern:** Copying code from the standard pages into the consumer. Then the UI
> drifts on platform updates and you lose the i18n/action synchronization. Shared
> logic belongs in the platform packages — the app wrapper stays thin.

---

## 9. CLI Integration

Optional but strongly recommended integration for ops workflows.

```ts
// cli/cli.module.ts
@Module({
    imports: [
        PrismaModule,
        PlanCatalogModule.forRoot({/* like 6.4 */}),
        PlatformAdminModule.forRoot({/* like 6.5 */}),
        CliContextModule.forRoot({
            config: {
                adminEmailEnvVar: 'MYAPP_ADMIN_EMAIL',
                mfaSkipEnvVar: 'MYAPP_SKIP_MFA',
                isProductionEnvironment: () => process.env.MYAPP_ENV === 'production',
            },
            userPort: { useExisting: PrismaUserPortAdapter },
            auditQueryPort: { useExisting: PrismaAuditQueryAdapter },
            manifestAccessPort: { useExisting: AdminManifestService },
            doctorChecks: [
                // Platform defaults are NOT loaded automatically — list explicitly:
                new DatabaseReachableCheck(),
                new EmailServiceReachableCheck(),
            ],
        }),
    ],
    providers: [
        // App-specific commands:
        PaketApplyCommand,
        PilotCreateCommand,
        // Platform flow wrappers:
        AdminMfaSetupCommand, // wraps MfaSetupFlow
        AdminWhoAmICommand, // wraps WhoAmIFlow
        AuditTailCommand, // wraps AuditTailFlow
        DoctorCommand, // wraps DoctorFlow
        ManifestDumpCommand, // wraps ManifestCliFlow.dump
        ManifestHashCommand, // wraps ManifestCliFlow.hash
        ManifestValidateCommand, // wraps ManifestCliFlow.validate
        ManifestCheckCommand, // wraps ManifestCliFlow.check
    ],
})
export class CliModule {}
```

With this your app has, for example:

```bash
myapp admin mfa-setup --as taci@example.com
myapp admin whoami    --as taci@example.com
myapp audit tail      --since "2026-05-01" --limit 50
myapp doctor
myapp manifest dump | jq .
myapp manifest hash                                          # for CI pinning
myapp manifest check                                         # drift detection
```

**Exit codes** are standardized (see `saas-platform-spec/cli-conventions.md`):
`0=ok`, `1=user-error`, `2=identity`, `3=mfa`, `4=connectivity`, `5=permission`,
`6=conflict`, `7=drift`, `99=internal`.

---

## 10. Verification Checklist

After integration:

- [ ] Backend starts without `P2028 "Unable to start a transaction"` — if it does:
      `PrismaPlanCatalogReadSink` doesn't bypass RLS correctly.
- [ ] `var/discovery-snapshot.json` is written at boot and contains your
      `@ImplementsCapability` entries.
- [ ] `GET /api/v1/admin/manifest` responds with status 200 + `ETag` and contains
      all standard pages, your manifest contribution + KPI cards.
- [ ] `GET /public/catalog` returns the plans declared in the plan catalog.
- [ ] SuperAdmin login works, `MfaGuard` blocks without MFA.
- [ ] The SuperAdmin UI loads:
    - [ ] `/admin/dashboard` shows your KPI cards.
    - [ ] `/admin/tenants` lists tenants.
    - [ ] `/admin/discovery` shows capabilities/features/quotas (are the tabs empty? — see §11).
    - [ ] `/admin/plans` shows your YAML plans.
    - [ ] `/admin/marketing-catalog` shows features for locale translation.
- [ ] An endpoint with `@EnforceQuota('xxx')` throws `LimitExceededError` when exceeded.
- [ ] An endpoint with `@RequireFeature('XXX')` responds 403 with
      `code: FEATURE_NOT_LICENSED` when the plan doesn't include the feature.
- [ ] `myapp manifest hash` is deterministic (same code → same hash).
- [ ] `myapp doctor` runs through without errors.

---

## 11. Common Pitfalls

1. **Order of `imports[]`.** `PlatformAdaptersModule` (with the repository providers)
   **must** come before the `DynamicModule.forRoot(...)` calls. Otherwise `Nest can't resolve
dependencies of the X (?, ...)` errors. NestJS 11+ is stricter here than 9/10.

2. **`@Global()` on `AdminModule`.** If the CLI wants to inject via `AdminManifestService`,
   the module must be global. Otherwise the DynamicModule factory won't find the service.

3. **`includeManifestController: false`.** If you write your own `AdminManifestController`
   (for your own guards / caching), be sure to disable the standard controller in
   `AdminManifestModule.forRoot()` — otherwise a duplicate-route error.

4. **`extraProviders` instead of global providers.** DynamicModule factories only see what is
   declared _in the same DynamicModule scope_. Dependencies of a
   `useFactory({ inject })` config must be passed via `extraProviders: [...]` in
   `forRoot()`, not as an external `providers:` list.

5. **RLS bypass for global reads.** Plan catalog, bundles, discovery are _not_
   tenant-bound. Reads must bypass RLS. The `AdminBypassRlsInterceptor` solves
   this for controller routes; in adapters that run _outside_ a request (boot,
   scheduler) you have to call `rlsBypassPort.run(() => …)` yourself.

6. **Discovery snapshot is a boot cache.** Decorator changes only become
   visible on the _next start_. In the dev container a `restart` suffices; in the UI you then
   have to click "Discovery starten" on the discovery page (or
   call `myapp doctor`, if built in).

7. **`SubscriptionContract` is immutable.** Plan change = new contract + the old one becomes
   `superseded`. Never update directly — otherwise historical invoices break.

8. **Never cache the public catalog in the frontend.** The pricing page reads
   `/public/catalog` fresh every time. Cached locally → stale prices. A classic source of
   live billing bugs.

9. **Pin the manifest hash in CI.** Check `myapp manifest hash` in a pre-deploy step
   against an expected value; unwanted manifest drifts change the UI and
   permission checks without it being obvious in the code diff.

10. **`@DefinesQuota` on the class, not the interface.** The discovery scanner
    only reads concrete classes.

11. **Clear the Vite cache after a platform build.** `file:` deps are copied by pnpm,
    but Vite bundles them into `node_modules/.vite/deps`. After
    `pnpm --filter @saasicat/ui-vue build` + `pnpm install` in the
    consumer you have to delete `.vite/deps` and restart the dev server — otherwise
    Vite serves the old version.

12. **`AdminManifestConfig` is a boot snapshot.** Plan changes via the SuperAdmin UI
    only become visible after a manifest reload (`POST /admin/manifest/reload`, MFA-required)
    — not automatically.

---

## 12. Further Reading

- **Spec**: `packages/saas-platform-spec/`
    - `schemas/admin-manifest.schema.json`
    - `schemas/plan-catalog.schema.json`
    - `schemas/promo-code.schema.json`
    - `schemas/audit-event.schema.json`
    - `admin-api.openapi.yaml` (normative REST contract)
    - `cli-conventions.md`
- **Acceptance tests** (planned): `packages/saas-platform-spec/acceptance/*.yaml`.

In case of discrepancies between code and spec: the spec is normative,
the code is the implementation status.
