# Architecture

How a decorator in your controller becomes a limit a customer runs into, and
which package holds each step of the way. Read
[the vocabulary](concepts.md) first if `capability`, `feature` and `quota` are
not yet distinct in your head.

## Data Flow

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

## Three layers in the consumer

```text
┌──────────────────────────────────────────────────────────────────┐
│ Backend (NestJS)                                                 │
│  ├─ your Prisma module (or Drizzle)                              │
│  └─ SaaSiCatModule.forRoot(defineSaaSiCat({                      │
│         planCatalog, persistence: prismaPersistence({...}),      │
│         discovery, catalog, entitlement, admin, …                │
│     }))                                                          │
├──────────────────────────────────────────────────────────────────┤
│ Admin frontend (Vue 3 + Quasar)                                  │
│  ├─ createPlatformLoaders({ endpoints, http })                   │
│  ├─ createManifestStore({ loader })                              │
│  ├─ createAdminRoutes({ children: standardAdminChildren() })     │
│  └─ createSuperAdminApp({ rootComponent, brand, endpoints, … })  │
├──────────────────────────────────────────────────────────────────┤
│ CLI (nest-commander)                                             │
│  └─ CliContextModule.forRoot({ config, userPort, …, flows })     │
└──────────────────────────────────────────────────────────────────┘
```

**One module, not seven.** `SaaSiCatModule.forRoot(defineSaaSiCat({…}))`
composes the plan catalog, discovery, catalog, checkout offers, subscription
contracts, entitlements and the admin surface from a single options object, and
`defineSaaSiCat` is what type-checks it. The individual modules underneath —
`DiscoveryModule.forRoot`, `CatalogModule.forRoot` and the rest — are still
exported and still work, and an application that wired them by hand before the
composition existed keeps running unchanged. They are not the recommended shape
for a new integration: every option the composition takes, and the couple of
things it deliberately does not compose, are in
[wire the backend](../guides/wire-the-backend.md) and
[the options reference](../reference/options.md). An app that already hand-wired
them has [its own guide](../guides/integrate-into-an-existing-app.md).

| Package                         | Contents                                                                                                                                                                          | Consumed by                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@saasicat/spec`                | JSON schemas (manifest, plan catalog, promo code, audit event), OpenAPI, acceptance test scenarios. **Language-neutral.**                                                         | Backend & any other languages |
| `@saasicat/core`                | The shared contract: DTO types (`AdminManifest`, `PlanCatalog`, `Subscription`, `Ports`) plus the runtime rules both sides apply (`classifyPlanDiff`, `applyPromo`, error codes). | Backend & frontend            |
| `@saasicat/nest`                | NestJS modules/services/decorators/guards (`AdminModule`, `DiscoveryModule`, `CatalogModule`, `EntitlementModule`, …).                                                            | Backend                       |
| `@saasicat/adapter-prisma`      | The standard persistence bundle: `prismaPersistence()` plus one adapter per shipped port, against the canonical schema.                                                           | Backend                       |
| `@saasicat/adapter-drizzle`     | The same ports on Drizzle, for the core slices.                                                                                                                                   | Backend                       |
| `@saasicat/persistence-testing` | The executable persistence contract every adapter must pass against a real database.                                                                                              | Adapter authors               |
| `@saasicat/ui-vue`              | Vue/Quasar components, Pinia stores, composables (`useDiscovery`, `useCatalogEntries`), standard pages (`DiscoveryPage`, `TenantsPage`, `PlansPage`, …).                          | Admin frontend                |
| `@saasicat/ui-vue-tenant`       | The tenant-facing counterpart: plan section, plan-change wizard, onboarding configurator, bundle store — rendered in your application.                                            | Your own frontend             |
| `@saasicat/cli`                 | `nest-commander` flows (`ManifestCliFlow`, `MfaSetupFlow`, `AuditTailFlow`, `DoctorFlow`) for your app CLI.                                                                       | Backend (CLI submodule)       |
| `create-saasicat-admin`         | Scaffolder for a ready-to-run admin frontend.                                                                                                                                     | Once, at the start            |
| `saasicat`                      | Pointer package, no code — it names the one you want.                                                                                                                             | —                             |

## `@saasicat/nest` — Sub-Entries

Import the sub-entry. Each one is a bundle of its own, so taking
`DiscoveryModule` from `@saasicat/nest/discovery` costs you the discovery slice
rather than the whole package:

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

The one exception is the platform composition itself. `SaaSiCatModule`,
`defineSaaSiCat` and their option types are exported from the root **as well
as** from `@saasicat/nest/platform`, deliberately: an app that already injects
them from the root keeps working, and both paths hand out the same classes
because the CommonJS build is one bundle behind thin re-export stubs (see
[CONTRIBUTING](../../CONTRIBUTING.md), "One bundle, many entries"). New
applications take the narrower `/platform` entry.

`RegistrationModule` is the one entry `SaaSiCatModule` does not compose: it takes
ten ports no persistence bundle supplies, and you wire it yourself. See
[self-registration](../guides/self-registration.md) for the port list, the reason, and the
two things that bite. Every other entry above is composed for you.

## Standard Pages from `@saasicat/ui-vue`

Path: `node_modules/@saasicat/ui-vue/src/pages/` — with the shell in `src/layouts/`, the login screens in `src/auth/` and the primitives in `src/ui/`.

| Page                                     | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `SuperAdminLoginPage`                    | Login form                                                 |
| `AdminLayout`                            | Sidebar, nav guard, MFA prompt                             |
| `DashboardPage`                          | KPI cards (fed by the manifest)                            |
| `TenantsPage` / `TenantDetailPage`       | Tenant management + actions                                |
| `PlansPage`                              | Plan lifecycle, editor, version timeline and diff          |
| `BundlesPage`                            | Bundle/BundleVersion CRUD                                  |
| `DiscoveryPage`                          | Capability/feature/quota review with lifecycle transitions |
| `MarketingCatalogPage`                   | i18n marketing texts + pricing actions                     |
| `SubscriptionsPage`                      | Contract management (V3)                                   |
| `AuditPage`                              | Audit log browser                                          |
| `UsersPage`                              | SuperAdmin user management (MFA, password reset, role)     |
| `PilotsPage`                             | Pilot feature grants (feature flags)                       |
| `PromoCodesPage` / `PromoCodeDetailPage` | Promo code CRUD + redemption tracking                      |

The former synthetic `PlanVersionsPage` is no longer a standard page. A global
historical comparison will return as an immutable **Publication Archive** /
**Catalog History** based on [#30](https://github.com/uelker70/saasicat/issues/30)
and [#35](https://github.com/uelker70/saasicat/issues/35). The reusable timeline
and diff components remain available for that work. `MarketingCatalogPage`
continues to be the separate marketing projection.
