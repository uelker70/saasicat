# SaaS-Plattform — Handbuch

Anleitung, wie eine NestJS- oder Express-Anwendung mit den `@saasicat/*`-Paketen
SaaS-fähig gemacht wird: Mandanten, Pläne, Bundles, Quotas, Features, SuperAdmin-UI,
MFA, Audit, Promo-Codes, Checkout, Subscription-Contracts.

> **Zielgruppe:** Externe Entwickler / neue Teams, die die Plattform zum ersten Mal einsetzen.
> Setzt Kenntnis von NestJS, Prisma und Vue/Quasar voraus, aber **kein** Vorwissen
> über die internen Begriffe (Capability, Feature, Quota, Bundle, Plan, Contract).
>
> **Schneller Einstieg:** Wenn du eine bestehende NestJS-App auf die Plattform
> aufsatteln willst, beginne mit dem [Quickstart](saas-platform-quickstart.md) —
> 10 Schritte, ~60 Minuten zum funktionierenden SuperAdmin. Dieses Handbuch ist
> das Nachschlagewerk, das du danach brauchst.

---

## Inhalt

1. [Was die Plattform liefert](#1-was-die-plattform-liefert)
2. [Begriffe](#2-begriffe)
3. [Architektur](#3-architektur)
4. [Die fünf Pakete](#4-die-fünf-pakete)
5. [Voraussetzungen](#5-voraussetzungen)
6. [NestJS-Integration — Schritt für Schritt](#6-nestjs-integration--schritt-für-schritt)
7. [Express-Integration](#7-express-integration)
8. [Admin-Frontend (Vue/Quasar)](#8-admin-frontend-vuequasar)
9. [CLI-Integration](#9-cli-integration)
10. [Verifikations-Checkliste](#10-verifikations-checkliste)
11. [Häufige Fallstricke](#11-häufige-fallstricke)
12. [Weiterführend](#12-weiterführend)

---

## 1. Was die Plattform liefert

Eine fertig konstruierte SuperAdmin-Schicht für deine App:

- **Mandanten-Verwaltung** (Listing, Detail, suspendieren/reaktivieren, impersonate, export).
- **Pläne & Plan-Versionen** (CRUD inkl. Plan-Editor, Audit, Bundle-Persistenz).
- **Bundles & Business-Types** (versionierte Produkt-Optionen, Marketing-Projektion).
- **Discovery-Loop** (Code deklariert Capabilities/Features/Quotas per Decorator → Plattform
  scannt → SuperAdmin reviewt → freigegebene Einträge werden im Marketing-Catalog
  übersetzt und zu Plänen zugeordnet).
- **Marketing-Catalog** (i18n-Labels, Beschreibungen, Highlights, Promo-Aktionen) inklusive
  öffentlichem REST-Endpoint (`/public/catalog`) für Pricing-Pages.
- **Checkout-Offer + Subscription-Contract** (V3): eingefrorene Kaufabsichten → immutable
  Verträge als alleinige Quelle für Billing und Entitlement.
- **Entitlement** zur Laufzeit (`@RequireFeature`, `@EnforceQuota`); fehlende Features
  antworten mit strukturiertem 403 (`code: FEATURE_NOT_LICENSED` + Upsell-`offers`
  über den optionalen `UpsellOfferResolver`-Port).
- **MFA (TOTP)** für SuperAdmin-Aktionen, **AuditService** für jede sensible Operation,
  **RLS-Bypass-Interceptor** für globale Reads.
- **Promo-Codes** (Generator, Lifecycle, Redemption-Tracking).
- **CLI-Bausteine** (`<app> admin mfa-setup|whoami`, `<app> audit tail`, `<app> doctor`,
  `<app> manifest dump|hash|validate|check`).
- **Vue/Quasar-Standard-Pages**, die per Manifest dynamisch aktiv/inaktiv geschaltet
  werden — du steckst sie nur als Routen rein und reichst Daten durch.

Du implementierst:

- Persistenz (Prisma-Adapter zu den Plattform-Ports — siehe §6.3),
- App-spezifische Capabilities (`@ImplementsCapability(...)` auf deinen Controllern),
- Manifest-Contributions (welche KPI-Cards, Tenant-Actions, Project-Pages deine App ergänzt),
- App-spezifische Quota-Provider (`count(tenantId)` für jede Quota).

Alles andere kommt aus den Paketen.

---

## 2. Begriffe

Die Plattform trennt sauber zwischen **Code-Realität**, **Produkt-Definition** und **verkauftem Vertrag**:

| Begriff                        | Bedeutung                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capability**                 | Eine konkrete Fähigkeit im Code, deklariert mit `@ImplementsCapability('dms.upload', {...})`. Atomare technische Einheit, z. B. ein Endpoint.                                                                                                |
| **Feature**                    | Vermarktbares Bündel mehrerer Capabilities (z. B. `DMS` = Upload + Download + Preview). Wird im Marketing-Catalog übersetzt, Preisen zugeordnet, in Plänen referenziert.                                                                     |
| **Quota**                      | Numerische Begrenzung (z. B. `users.max=10`, `storage.gb=5`). Deklariert mit `@DefinesQuota(...)` auf einem `QuotaProvider`, der `count(tenantId)` liefert. Wird per `@EnforceQuota('users.max')` an Endpoints geprüft.                      |
| **Discovery-Snapshot**         | Statisches Abbild aller Decorator-Aufrufe (Capabilities, Features, Quotas), das die Plattform beim Boot in `var/discovery-snapshot.json` schreibt. Speist die SuperAdmin-Discovery-Page.                                                     |
| **Catalog-Entry**              | DB-projizierte Sicht auf eine Capability/Feature/Quota mit Lifecycle-Status (`discovered → accepted → active → deprecated → retired` / `ignored`).                                                                                           |
| **Bundle**                     | Versionierte Gruppierung von Features + Quota-Effekten — eigenständig buchbar oder in Plan-Versionen enthalten (Addon-Verkauf entfernt, #49).                                                                                                |
| **Plan / Plan-Version**        | Verkaufsangebot mit Preis, enthaltenen Features, Quota-Limits. Plan = unveränderlicher Bezeichner, Plan-Version = veröffentlichter Snapshot.                                                                                                 |
| **Checkout-Offer**             | Eingefrorenes Angebot (Plan + Bundles + Cycle + Preis + Gültigkeitsdatum), bevor ein Vertrag entsteht.                                                                                                                                       |
| **Subscription-Contract** (V3) | Immutable Vertrag, der zum Kaufzeitpunkt aus der Checkout-Offer erzeugt wird. **Alleinige Quelle** für Billing und Entitlement zur Laufzeit. Bei Plan-Wechsel: neuer Vertrag, alter Vertrag wird `superseded`.                               |
| **Entitlement-Snapshot**       | Aggregierte Sicht aller Features und Quota-Limits aus den aktiven Vertrags-Line-Items eines Mandanten. Wird von `EntitlementService` zur Laufzeit berechnet.                                                                                 |
| **Manifest**                   | UI-Discovery-Projektion deiner App (`/api/v1/admin/manifest`): welche Standard-Pages sind aktiv, welche Project-Pages ergänzt deine App, welche KPI-Cards, welche Tenant-Actions. Spec: `@saasicat/spec/schemas/admin-manifest.schema.json`. |

**Faustregel:** Capability ist _technisch_, Feature ist _vermarktbar_, Quota ist _zählbar_,
Plan ist _verkäuflich_, Contract ist _verkauft_.

**Verkaufsmodell (seit v1.5.0, #49):** Verkauft werden ausschließlich
**Plan-Versionen** und **Bundles**; effektive Features/Quotas eines Tenants sind
die Vereinigung aus Plan ∪ gebuchten Bundles. SSOT für Plans, Bundles und Preise
ist das AdminUI — Seeds dürfen nur Entwürfe anlegen (`publishedAt = null`);
Publish passiert ausschließlich im AdminUI (beim Bundle-Publish ist `validFrom`
Pflicht).

---

## 3. Architektur

### 3.1 Datenfluss

```text
┌──────────────────────────────────────────────────────────────────┐
│ App-Code                                                         │
│  @ImplementsCapability('dms.upload', {...})                      │
│  @DefinesQuota({ key: 'storage.gb', ... })                       │
│  @EnforceQuota('storage.gb')                                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │ (Boot-Scan)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ DiscoveryModule  →  var/discovery-snapshot.json                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ CatalogEntryRepository  (DB-Projektion mit Lifecycle)            │
│   - capability_catalog_entry                                     │
│   - feature_catalog_entry                                        │
│   - quota_catalog_entry                                          │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼                                ▼
┌─────────────────────────────┐   ┌────────────────────────────────┐
│ SuperAdmin-UI               │   │ AdminManifestService           │
│  - Discovery-Page (Review)  │   │  → /api/v1/admin/manifest      │
│  - Marketing-Catalog-Page   │   │  (KPI-Cards, Nav, Actions)     │
│  - Bundles-Page             │   └────────────────────────────────┘
│  - Plans-Page               │
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
│   (Pricing-Page der App liest hier — niemals lokal berechnen)    │
└─────────────────┬────────────────────────────────────────────────┘
                  │ (Kunde wählt)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ CheckoutOfferService    →  GET /api/v1/checkout/offer/:id        │
│   (eingefrorene Auswahl mit Ablaufdatum)                         │
└─────────────────┬────────────────────────────────────────────────┘
                  │ (Bezahlung)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ SubscriptionContractService    (immutable!)                      │
│   - subscription_contract                                        │
│   - contract_line_item                                           │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ EntitlementService    (Runtime-Aggregation aus Verträgen)        │
│   - @RequireFeature('DMS')  →  403 wenn nicht enthalten          │
│   - @EnforceQuota('storage.gb')  →  LimitExceededError           │
└──────────────────────────────────────────────────────────────────┘
```

**Wichtigster Architektur-Invariant:** Der Subscription-Contract ist **unveränderlich**.
Wenn die SuperAdmin-UI nachträglich einen Plan ändert, ist das eine _neue_ Version —
laufende Verträge bleiben unangetastet. Damit kann nie ein Live-Catalog-Edit historische
Rechnungen oder Quotas retroaktiv brechen.

### 3.2 Drei-Schichten-Wiring im Konsumenten

```text
┌──────────────────────────────────────────────────────────────────┐
│ Backend (NestJS)                                                 │
│  ├─ PlatformAdaptersModule  (deine Prisma-Implementierungen)     │
│  ├─ PlanCatalogModule.forRoot({ sink: PrismaPlanCatalogReadSink })│
│  ├─ DiscoveryModule.forRoot({ app, controller, snapshotPath })   │
│  ├─ CatalogModule.forRoot({ ...Repositories })                   │
│  ├─ CheckoutOfferModule.forRoot({ ...Repositories })             │
│  ├─ SubscriptionContractModule.forRoot({ ... })                  │
│  ├─ EntitlementModule.forRoot({ ... })                           │
│  └─ AdminModule (= PlatformAdminModule + dein AdminController)   │
├──────────────────────────────────────────────────────────────────┤
│ Admin-Frontend (Vue 3 + Quasar)                                  │
│  ├─ createPlatformLoaders({ endpoints, http, getAuthToken })     │
│  ├─ createManifestStore({ loader })                              │
│  ├─ Standard-Pages aus @saasicat/ui-vue/pages/...  │
│  └─ createSuperAdminApp({ loginAdapter, actions, ... })          │
├──────────────────────────────────────────────────────────────────┤
│ CLI (nest-commander)                                             │
│  └─ CliContextModule.forRoot({ config, userPort, ..., flows })   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Die fünf Pakete

| Paket              | Inhalt                                                                                                                                                    | Konsumiert                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `@saasicat/spec`   | JSON-Schemas (Manifest, Plan-Catalog, Promo-Code, Audit-Event), OpenAPI, Acceptance-Test-Szenarien. **Sprach-neutral.**                                   | Backend & beliebige andere Sprachen |
| `@saasicat/types`  | TypeScript-Interfaces, die aus den Schemas abgeleitet sind (`AdminManifest`, `PlanCatalog`, `Subscription`, `Ports`).                                     | Backend & Frontend                  |
| `@saasicat/nest`   | NestJS-Module/Services/Decorators/Guards (`AdminModule`, `DiscoveryModule`, `CatalogModule`, `EntitlementModule`, …).                                     | Backend                             |
| `@saasicat/ui-vue` | Vue/Quasar-Komponenten, Pinia-Stores, Composables (`useDiscovery`, `useCatalogEntries`), Standard-Pages (`DiscoveryPage`, `TenantsPage`, `PlansPage`, …). | Frontend                            |
| `@saasicat/cli`    | `nest-commander`-Flows (`ManifestCliFlow`, `MfaSetupFlow`, `AuditTailFlow`, `DoctorFlow`) für deine App-CLI.                                              | Backend (CLI-Submodule)             |

### 4.1 `saas-platform-nest` — Sub-Entries

Importiere immer den Sub-Entry, nie das Root:

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

### 4.2 Standard-Pages aus `saas-platform-ui-vue`

Pfad: `node_modules/@saasicat/ui-vue/src/pages-standard/`.

| Page                                     | Zweck                                                       |
| ---------------------------------------- | ----------------------------------------------------------- |
| `SuperAdminLoginPage`                    | Login-Formular                                              |
| `AdminLayout`                            | Sidebar, Nav-Guard, MFA-Prompt                              |
| `DashboardPage`                          | KPI-Cards (vom Manifest gespeist)                           |
| `TenantsPage` / `TenantDetailPage`       | Mandanten-Verwaltung + Actions                              |
| `PlansPage` / `PlanVersionsPage`         | Pläne, Plan-Editor, Version-Diff                            |
| `BundlesPage`                            | Bundle-/BundleVersion-CRUD                                  |
| `BusinessTypesPage`                      | Business-Types (optional im Manifest aktivierbar)           |
| `DiscoveryPage`                          | Capability-/Feature-/Quota-Review mit Lifecycle-Transitions |
| `MarketingCatalogPage`                   | i18n-Marketing-Texte + Pricing-Actions                      |
| `SubscriptionsPage`                      | Vertrags-Verwaltung (V3)                                    |
| `AuditPage`                              | Audit-Log-Browser                                           |
| `UsersPage`                              | SuperAdmin-User-Verwaltung (MFA, PW-Reset, Rolle)           |
| `PilotsPage`                             | Pilot-Feature-Grants (Feature-Flags)                        |
| `PromoCodesPage` / `PromoCodeDetailPage` | Promo-Code-CRUD + Redemption-Tracking                       |

---

## 5. Voraussetzungen

- **Node.js 24+**, **pnpm 10+**.
- **NestJS 11+** mit Fastify- oder Express-Adapter.
- **Prisma 5+** mit PostgreSQL (RLS-Support gewünscht — die Plattform setzt ein
  `RlsBypassPort` voraus).
- **Authentifizierung**: JWT-basiert wird empfohlen; ein `JwtAuthGuard`-Äquivalent
  muss existieren (wird in `controller.guards` der Plattform-Module reingereicht).
- **Vue 3 + Quasar 2** für das Admin-Frontend; Vite als Build-Tool.

### 5.1 Pakete installieren

```bash
# Backend
pnpm add @saasicat/spec @saasicat/types @saasicat/nest @saasicat/cli

# Admin-Frontend
pnpm add @saasicat/types @saasicat/ui-vue
```

Für lokale Entwicklung gegen einen Checkout dieses Repos eignen sich
`pnpm.overrides` mit `link:`-Pfaden (nicht `file:` — siehe Hinweis unten).

> **Wichtig:** `file:`-Dependencies werden von pnpm in `node_modules/.pnpm/...` **kopiert**,
> nicht symlinked. Nach einem Plattform-Build musst du im Konsumenten ein `pnpm install`
> ausführen, damit der neue Stand übernommen wird. Im Container-Setup hilft ein
> Helfer-Script (z. B. `scripts/ensure-container-deps.cjs`) oder ein manueller
> `pnpm install` im Container; danach **muss der Vite-Dev-Cache (`.vite/deps`)
> geleert und der Admin-Container neugestartet werden**, sonst serviert Vite die
> alte gebundelte Version.

### 5.2 Prisma-Schema-Fragmente

Die Plattform-Module liefern (Stand 2026-05) **keine fertigen Prisma-Schema-Fragmente**.
Du musst die folgenden Tabellen selbst anlegen. Die normative Quelle ist der
JSON-Schema-Vertrag in [`@saasicat/spec/schemas/`](../packages/saas-platform-spec/schemas/)
plus die TypeScript-Interfaces in [`@saasicat/types/src/`](../packages/saas-platform-types/src/).
Der [Quickstart §3](saas-platform-quickstart.md#schritt-3--prisma-schema-erg%C3%A4nzen)
zeigt ein vollständiges Minimal-Schema zum Copy-Paste. Die relevanten Tabellen-Familien:

- `capabilityCatalogEntry`, `featureCatalogEntry`, `quotaCatalogEntry` (Discovery-Projektion)
- `plan`, `catalogPlanVersion`
- `catalogBundle`, `catalogBundleVersion`
- `catalogBusinessType`, `catalogBusinessTypeVersion`
- `catalogMarketingProjection`, `marketingSettings`
- `checkoutOffer`
- `subscriptionContract`, `contractLineItem`
- `promoCode`, `promoCodeRedemption`
- `auditEntry`
- `superAdminUser`, `superAdminMfa`

Schema-Schnipsel werden bewusst nicht im Plattform-Paket mitgeliefert — jede App pflegt ihr
Schema selbst (Constraints, Indices und RLS-Policies sind App-spezifisch). Ein
fertiges Minimal-Schema steht im [Quickstart §3](saas-platform-quickstart.md#schritt-3--prisma-schema-erg%C3%A4nzen).

---

## 6. NestJS-Integration — Schritt für Schritt

### 6.1 Plan-Catalog YAML

Lege `config/saas.yaml` an (Schema:
`@saasicat/spec/schemas/plan-catalog.schema.json`):

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

quotaKeys:
    - key: users.max
      label: Maximale Benutzer
      unit: count
    - key: storage.gb
      label: Speicher
      unit: gigabyte

features:
    - key: DMS
      label: Dokumenten-Management
    - key: REPORTING
      label: Auswertungen

plans:
    - id: starter
      name: Starter
      monthlyNet: 19.0
      features: [DMS]
      quotas:
          users.max: 3
          storage.gb: 5
    - id: pro
      name: Pro
      monthlyNet: 49.0
      features: [DMS, REPORTING]
      quotas:
          users.max: 25
          storage.gb: 100
```

### 6.2 Plan-Catalog beim Boot laden

```ts
// app.module.ts
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';

const SAAS_CONFIG_PATH = process.env.MYAPP_SAAS_CONFIG_PATH ?? 'config/saas.yaml';
const SAAS_CONFIG = loadPlanCatalogFromFile({ path: SAAS_CONFIG_PATH });
```

`loadPlanCatalogFromFile` validiert die YAML gegen das Schema aus
`saas-platform-spec` — Fehler werfen früh beim Boot.

### 6.3 Platform-Adapters-Modul (Prisma)

Das ist die größte Aufgabe für den Konsumenten. Pro Port eine `@Injectable`-Klasse, die
das Interface aus `@saasicat/types/ports` (bzw. die spezifischen Repository-
Interfaces aus den `saas-platform-nest`-Sub-Entries) implementiert.

| Adapter                                           | Interface (aus)                   | Was tun                                                                        |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `PrismaPlanCatalogReadSink`                       | `PlanCatalogReadSink`             | **Boot-Read-only** Snapshot von Plänen + Versionen; RLS-Bypass-Kontext setzen! |
| `PrismaPlanRepository`                            | `PlanRepository`                  | CRUD für `plan` + `catalogPlanVersion` (von SuperAdmin-UI konsumiert)          |
| `PrismaBundleRepository`                          | `BundleRepository`                | CRUD für `catalogBundle` + `catalogBundleVersion`                              |
| `PrismaBusinessTypeRepository`                    | `BusinessTypeRepository`          | CRUD für `catalogBusinessType` + `catalogBusinessTypeVersion`                  |
| `PrismaCatalogEntryRepository`                    | `CatalogEntryRepository`          | Lifecycle-Transitions + i18n-Speicherung für Capability/Feature/Quota          |
| `PrismaMarketingProjectionRepository`             | `MarketingProjectionRepository`   | i18n-Marketing-Texte (Label, Beschreibung, Highlights pro Locale)              |
| `PrismaMarketingSettingsRepository`               | `MarketingSettingsRepository`     | Aktive Locales                                                                 |
| `PrismaPromotionRepository`                       | `PromotionRepository`             | Zeitbegrenzte Pricing-Actions                                                  |
| `PrismaCheckoutOfferRepository`                   | `CheckoutOfferRepository`         | Frozen Checkout-Snapshots                                                      |
| `PrismaSubscriptionContractRepository`            | `SubscriptionContractRepository`  | Append-only immutable Verträge                                                 |
| `UsersQuotaProvider`, `StorageGbQuotaProvider`, … | `QuotaProvider` (eines pro Quota) | `count(tenantId): Promise<number>`; mit `@DefinesQuota({...})` decorieren      |
| `PrismaMfaAdapter`                                | `MfaPort`                         | TOTP-Setup, -Verify, -Disable                                                  |
| `PrismaAuditAdapter`                              | `AuditPort`                       | Audit-Entry schreiben                                                          |
| `AsyncLocalRlsBypassAdapter`                      | `RlsBypassPort`                   | Plattform: `node:async_hooks`-basiert; meist 1:1 übernehmbar                   |

Bündele alles in einem **`@Global()`-Modul**, damit DynamicModule-Factories die Adapter
per `inject:` auflösen können:

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
    exports: [/* dito */],
})
export class PlatformAdaptersModule {}
```

### 6.4 AppModule wiren

> **Reihenfolge zählt.** `PlatformAdaptersModule` muss in `imports[]` **vor** den
> `DynamicModule.forRoot(...)`-Aufrufen stehen, sonst können die Factories
> ihre `inject:`-Tokens nicht auflösen.

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
            quotaKeys: SAAS_CONFIG.quotaKeys,
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
            strictModeCheckMode: 'blocking', // Default (#12); 'warn-only' als Übergang bis 100 % Discovery-Coverage
            publicMarketingCatalog: {
                guards: [], // öffentlich
                projectKey: 'myapp',
                currency: 'EUR',
                vatRate: 19.0,
            },
        }),

        CheckoutOfferModule.forRoot({
            checkoutOfferRepository: { useExisting: PrismaCheckoutOfferRepository },
            bundleRepository: { useExisting: PrismaBundleRepository },
            planRepository: { useExisting: PrismaPlanRepository },
            controller: { guards: [] }, // pre-tenant, öffentlich
        }),

        SubscriptionContractModule.forRoot({
            contractRepository: { useExisting: PrismaSubscriptionContractRepository },
            controller: { guards: [JwtAuthGuard] },
        }),

        EntitlementModule.forRoot({
            contractRepository: { useExisting: PrismaSubscriptionContractRepository },
        }),

        AdminModule, // dein eigenes Modul, s. 6.5
    ],
})
export class AppModule {}
```

### 6.5 Admin-Modul

Das eigene `AdminModule` bündelt `PlatformAdminModule`, `AdminManifestModule`,
`AdminStatsModule` und registriert in `onModuleInit` deine Manifest-Contributions:

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
            includeManifestController: false, // wir bauen einen eigenen, s. 6.7
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
        // … weitere Contributions
    }
}
```

### 6.6 Manifest-Contributions

Eine Contribution beschreibt, _was deine App zur SuperAdmin-UI beiträgt_ — welche
Capabilities sie hat, welche Standard-Pages an/aus sind, welche KPI-Cards, welche
Tenant-Actions, welche Project-Pages (eigene Seiten unter `/admin/...`).

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
            planVersions: { enabled: false }, // im Plans-Cockpit integriert
            businessTypes: { enabled: false },
        },
        projectPages: [
            {
                id: 'myapp.report',
                path: '/admin/report',
                label: 'Auswertung',
                icon: 'analytics',
                requiredCapability: 'reports.read',
                component: 'MyAppReportPage', // wird in der UI per Lazy-Loader aufgelöst
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

### 6.7 Eigener `AdminManifestController` mit Caching + MFA

Standard-Controller deaktivieren (`includeManifestController: false`) und einen
eigenen schreiben, der deine App-Guards einhängt und ETag-Caching betreibt:

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

### 6.8 Capabilities / Features / Quotas im Code deklarieren

Auf den Controllern deiner App:

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
    @EnforceQuota('storage.gb')
    async upload(@CurrentUser() user: AuthenticatedUser, @Req() req: FastifyRequest) {
        return this.dmsService.upload(user, req);
    }
}
```

Auf den Quota-Providern:

```ts
// modules/platform-adapters/quota-providers.ts
@Injectable()
@DefinesQuota({
    key: 'storage.gb',
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

> Nach jedem Hinzufügen/Ändern eines Decorators muss die App neu starten, damit der
> Discovery-Snapshot neu geschrieben wird. Erst dann erscheinen die Einträge in der
> SuperAdmin-Discovery-Page.

### 6.9 `AdminManifestConfigFactory`

Baut die statische Konfiguration für das Manifest aus dem Plan-Catalog, dem Environment
und der `package.json`:

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

### 6.10 First-Run-Setup (SuperAdmin-Bootstrap übers Admin-UI)

Beim allerersten Start existiert noch kein SUPER_ADMIN — also auch niemand, der sich einloggen oder per CLI einen Admin anlegen könnte (Henne-Ei). Das `SetupModule` löst das mit einem **öffentlichen, selbstverriegelnden** Bootstrap-Endpoint, den die geteilte Login-Seite automatisch als Wizard anzeigt.

**Sicherheitsmodell (zwei Schranken, beide müssen erfüllt sein):**

1. **Self-Disable** — Setup läuft nur, solange `provisioningPort.countSuperAdmins() === 0`. Nach Anlage des ersten SUPER_ADMIN antwortet der Endpoint dauerhaft mit `409 SETUP_ALREADY_DONE`.
2. **Setup-Token** — ein vom Betreiber gesetztes Geheimnis (Env-Var, Default `SETUP_TOKEN`). Ohne gesetzte Var ist Setup komplett deaktiviert (`403 SETUP_DISABLED`); der Vergleich ist timing-safe.

So kann selbst bei öffentlich erreichbarer App niemand den ersten Admin „erraten/grabben".

**Du brauchst genau einen App-Adapter** — den `SuperAdminProvisioningPort` (2 Methoden). Ein voller `UserManagementPort`-Adapter (CLI) erfüllt ihn ebenfalls, lässt sich also teilen:

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
        // WICHTIG: den geteilten Fehler werfen — der SetupService mappt ihn auf
        // 409 EMAIL_EXISTS (sonst 500). Der Guard ist `code`-basiert (realm-safe).
        if (existing) throw new PlatformUserExistsError(email, existing.role);
        const user = await this.prisma.user.create({
            data: { email, passwordHash: await hash(input.password), role: 'SUPER_ADMIN' /* … */ },
        });
        return toPlatformUserDto(user); // Passwort-Hashing bleibt app-spezifisch (argon2/bcrypt)
    }
}
```

**Wiring (`AppModule`)** — `SetupModule` MUSS **nach** `AdminModule.forRoot` stehen (es injiziert dessen globalen `MfaService` fürs MFA-Enrollment):

```ts
SetupModule.forRoot({
  global: true,
  provisioningPort: {
    useFactory: (prisma: PrismaService) => new PrismaSuperAdminProvisioningAdapter(prisma),
    inject: [PrismaService],
  },
  setupTokenEnvVar: 'SETUP_TOKEN',   // Default; Betreiber setzt die Env-Var
  mfaIssuer: 'MeineApp',             // Anzeige im Authenticator
}),
```

Das mountet drei öffentliche Routen unter `${apiBase}` (z. B. `/api/v1/admin`):

| Route                      | Zweck                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET …/setup/status`       | `{ needsSetup }` — die Login-Seite fragt das beim Mount ab                                            |
| `POST …/setup`             | legt den ersten SUPER_ADMIN an + MFA-Enrollment → `{ userId, qrDataUrl, secret, generatedPassword? }` |
| `POST …/setup/confirm-mfa` | verifiziert den TOTP-Code (token-geschützt)                                                           |

Der **QR-Code wird serverseitig** als Data-URL erzeugt (`qrDataUrl`) — das Frontend rendert nur `<img>`, keine QR-Dependency nötig.

**Frontend:** Nichts zu tun, wenn die App die geteilte `SuperAdminLoginPage` nutzt (siehe §8.4). Sie ruft beim Mount `setup/status` ab und rendert bei `needsSetup` den `SuperAdminSetupWizard` statt des Login-Formulars. Apps **ohne** `SetupModule` bekommen `404` → der Wizard bleibt aus, normaler Login.

> **Voraussetzung & Reihenfolge:** `AdminModule.forRoot` global importiert; globale `ValidationPipe` aktiv (für die Setup-DTOs); `apiBase` im Admin-UI = Mount-Prefix des `SetupController`.

---

## 7. Express-Integration

Die Plattform ist **NestJS-native**. Eine reine Express-App hat zwei Wege:

### 7.1 NestJS-Standalone hinter Express mounten (empfohlen)

NestJS unterstützt sowohl Fastify als auch Express als HTTP-Adapter; eine bestehende
Express-App kann die SaaS-Endpoints als Sub-App betreiben.

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

Vorteile: alle Decorators, Guards, Interceptors funktionieren unverändert; alle
Standard-Pages der SuperAdmin-UI laufen ohne Anpassung.

### 7.2 Reine Express-App ohne NestJS

Nur dann sinnvoll, wenn du NestJS nicht haben willst. Du nutzt dann ausschließlich:

- `@saasicat/types` (TypeScript-Interfaces)
- `@saasicat/spec` (JSON-Schemas + OpenAPI als Vertrag)
- `@saasicat/nest/promo` (pure Funktionen)
- `@saasicat/nest/billing` → `aggregateLimits`, `version-publish`, `version-renewal` (pure Funktionen)
- `@saasicat/nest/entitlement` → `aggregateLimits`, `resolveEntitlementPlan`, `LimitExceededError`

und implementierst die **Endpoints**, **Guards**, **Audit**, **MFA**, **RLS-Bypass**,
**Discovery-Scan** selbst gegen die Schemas in `saas-platform-spec/admin-api.openapi.yaml`.
Das ist im Wesentlichen eine _Neuimplementierung_ der Plattform-Module — sinnvoll nur
bei einer komplett anderen Sprache (z. B. Django/Python) sinnvoll.

> Empfehlung: Variante 7.1. Variante 7.2 ist explizit für sprachfremde Backends gedacht
> und sollte in einer reinen Node-Codebase vermieden werden.

---

## 8. Admin-Frontend (Vue/Quasar)

### 8.1 Platform-Loaders

Pro App einen HTTP-Client wrappen (Axios oder Fetch) und an `createPlatformLoaders`
reichen — der setzt Endpoints zusammen und kümmert sich um ETag-Caching.

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

### 8.2 Manifest-Store

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
            createProjectPageHostRoute(), // Catch-all für Manifest-Projekt-Pages
        ],
    },
];
```

### 8.4 App-Bootstrap

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
    // … alle in Manifest deklarierten Actions auflisten
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

### 8.5 Wrapper-Pages: Dumb-Components mit Data-Composables

Plattform-Pages sind absichtlich _dumb_: sie kriegen Daten + Callbacks als Props
reingereicht. Im Konsumenten verheiratet ein dünner Wrapper Composables mit der Page.
Beispiel `AdminDiscoveryPage`:

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

> **Anti-Pattern:** Code aus den Standard-Pages in den Konsumenten kopieren. Dann driftet
> die UI bei Plattform-Updates und du verlierst die i18n-/Action-Synchronisation. Geteilte
> Logik gehört in die Plattform-Pakete — der App-Wrapper bleibt thin.

---

## 9. CLI-Integration

Optionale aber dringend empfohlene Integration für Ops-Workflows.

```ts
// cli/cli.module.ts
@Module({
    imports: [
        PrismaModule,
        PlanCatalogModule.forRoot({/* wie 6.4 */}),
        PlatformAdminModule.forRoot({/* wie 6.5 */}),
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
                // Plattform-Defaults werden NICHT automatisch geladen — explizit auflisten:
                new DatabaseReachableCheck(),
                new EmailServiceReachableCheck(),
            ],
        }),
    ],
    providers: [
        // App-spezifische Commands:
        PaketApplyCommand,
        PilotCreateCommand,
        // Plattform-Flow-Wrappers:
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

Damit hat deine App z. B.:

```bash
myapp admin mfa-setup --as taci@example.com
myapp admin whoami    --as taci@example.com
myapp audit tail      --since "2026-05-01" --limit 50
myapp doctor
myapp manifest dump | jq .
myapp manifest hash                                          # für CI-Pinning
myapp manifest check                                         # Drift-Detection
```

**Exit-Codes** sind standardisiert (siehe `saas-platform-spec/cli-conventions.md`):
`0=ok`, `1=user-error`, `2=identity`, `3=mfa`, `4=connectivity`, `5=permission`,
`6=conflict`, `7=drift`, `99=internal`.

---

## 10. Verifikations-Checkliste

Nach der Integration:

- [ ] Backend startet ohne `P2028 "Unable to start a transaction"` — wenn doch:
      `PrismaPlanCatalogReadSink` bypassen RLS nicht korrekt.
- [ ] `var/discovery-snapshot.json` wird beim Boot geschrieben und enthält deine
      `@ImplementsCapability`-Einträge.
- [ ] `GET /api/v1/admin/manifest` antwortet mit Status 200 + `ETag` und enthält
      alle Standard-Pages, dein Manifest-Contribution + KPI-Cards.
- [ ] `GET /public/catalog` liefert die im Plan-Catalog deklarierten Pläne.
- [ ] SuperAdmin-Login funktioniert, `MfaGuard` blockt ohne MFA.
- [ ] SuperAdmin-UI lädt:
    - [ ] `/admin/dashboard` zeigt deine KPI-Cards.
    - [ ] `/admin/tenants` listet Mandanten.
    - [ ] `/admin/discovery` zeigt Capabilities/Features/Quotas (sind die Tabs leer? — siehe §11).
    - [ ] `/admin/plans` zeigt deine YAML-Pläne.
    - [ ] `/admin/marketing-catalog` zeigt Features für Locale-Übersetzung.
- [ ] Ein Endpoint mit `@EnforceQuota('xxx')` wirft `LimitExceededError` bei Überschreitung.
- [ ] Ein Endpoint mit `@RequireFeature('XXX')` antwortet 403 mit
      `code: FEATURE_NOT_LICENSED`, wenn der Plan das Feature nicht enthält.
- [ ] `myapp manifest hash` ist deterministisch (gleicher Code → gleicher Hash).
- [ ] `myapp doctor` läuft ohne Fehler durch.

---

## 11. Häufige Fallstricke

1. **Reihenfolge von `imports[]`.** `PlatformAdaptersModule` (mit den Repository-Providern)
   **muss** vor den `DynamicModule.forRoot(...)`-Aufrufen stehen. Sonst `Nest can't resolve
dependencies of the X (?, ...)`-Fehler. NestJS 11+ ist hier strenger als 9/10.

2. **`@Global()` auf `AdminModule`.** Wenn das CLI über `AdminManifestService` injecten
   will, muss das Modul global sein. Sonst findet die DynamicModule-Factory den Service nicht.

3. **`includeManifestController: false`.** Wenn du einen eigenen `AdminManifestController`
   schreibst (für eigene Guards / Caching), unbedingt im `AdminManifestModule.forRoot()`
   den Standard-Controller deaktivieren — sonst Duplicate-Route-Error.

4. **`extraProviders` statt globale Providers.** DynamicModule-Factories sehen nur, was
   _im selben DynamicModule-Scope_ deklariert ist. Dependencies einer
   `useFactory({ inject })`-Config müssen via `extraProviders: [...]` in
   `forRoot()` mitgegeben werden, nicht als externe `providers:`-Liste.

5. **RLS-Bypass für globale Reads.** Plan-Catalog, Bundles, Discovery sind _nicht_
   mandantengebunden. Reads müssen RLS bypassen. Der `AdminBypassRlsInterceptor` löst
   das für Controller-Routen; in Adaptern, die _außerhalb_ eines Requests (Boot,
   Scheduler) laufen, musst du selbst `rlsBypassPort.run(() => …)` aufrufen.

6. **Discovery-Snapshot ist Boot-Cache.** Decorator-Änderungen werden erst beim
   _nächsten Start_ sichtbar. Im Dev-Container reicht `restart`, in der UI musst du
   anschließend in der Discovery-Page „Discovery starten" klicken (oder
   `myapp doctor` callen, falls eingebaut).

7. **`SubscriptionContract` ist immutable.** Plan-Wechsel = neuer Contract + alter wird
   `superseded`. Niemals direkt updaten — sonst brechen historische Rechnungen.

8. **Public-Catalog niemals im Frontend cachen.** Pricing-Page liest jedes Mal frisch
   `/public/catalog`. Lokal cached → veraltete Preise. Klassische Quelle für
   Live-Billing-Bugs.

9. **Manifest-Hash in CI pinnen.** `myapp manifest hash` in einem Pre-Deploy-Step
   gegen einen Sollwert prüfen; ungewollte Manifest-Drifts ändern UI und
   Permission-Checks ohne dass es im Code-Diff offensichtlich ist.

10. **`@DefinesQuota` auf der Klasse, nicht auf dem Interface.** Der Discovery-Scanner
    liest nur konkrete Klassen.

11. **Vite-Cache nach Plattform-Build leeren.** `file:`-Deps werden von pnpm kopiert,
    aber Vite bundle't sie in `node_modules/.vite/deps`. Nach
    `pnpm --filter @saasicat/ui-vue build` + `pnpm install` im
    Konsumenten musst du `.vite/deps` löschen und den Dev-Server neustarten — sonst
    serviert Vite die alte Version.

12. **`AdminManifestConfig` ist Boot-Snapshot.** Plan-Änderungen via SuperAdmin-UI
    werden erst nach Manifest-Reload (`POST /admin/manifest/reload`, MFA-pflichtig)
    sichtbar — nicht automatisch.

---

## 12. Weiterführend

- **Spec**: `packages/saas-platform-spec/`
    - `schemas/admin-manifest.schema.json`
    - `schemas/plan-catalog.schema.json`
    - `schemas/promo-code.schema.json`
    - `schemas/audit-event.schema.json`
    - `admin-api.openapi.yaml` (normativer REST-Vertrag)
    - `cli-conventions.md`
- **Acceptance-Tests** (geplant): `packages/saas-platform-spec/acceptance/*.yaml`.

Bei Discrepancies zwischen Code und Spec gilt: Spec ist normativ,
Code ist Implementierungsstand.
