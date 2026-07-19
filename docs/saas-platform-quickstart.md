# SaaS-Plattform — Quickstart

Eine NestJS-App in **10 Schritten** SaaS-fähig machen: Mandanten, Pläne,
Features, Quotas, automatisches Backend-Enforcement und SuperAdmin-UI. Ziel:
in ~30 Minuten ein funktionierender SuperAdmin auf einem bestehenden
CRUD-Backend, mit < 100 Zeilen App-eigenem Code.

> Setzt eine **NestJS-App mit Prisma + PostgreSQL + JWT-Auth** voraus, in der
> bereits ein `tenantId`-Konzept lebt (z. B. eine `Tenant`-Tabelle + RLS oder
> `tenantId` als Foreign Key). Wer komplett bei null anfängt, sollte zuerst
> Mandanten-Trennung implementieren — diese Anleitung _erweitert_ eine
> mandantenfähige App um SaaS-Funktionalität.
>
> Vollständige Erklärung jedes Schritts steht im [SaaS-Plattform-Handbuch](saas-platform.md).
> Der Quickstart zeigt den schnellsten Pfad — wer andere Schemata, DBs oder
> mehr Kontrolle braucht, wandert ins Handbuch weiter.

**Beispiel-App in dieser Anleitung:** Eine NestJS-App `notesapp` mit:

- einem `Notes`-Modul (CRUD über Notizen pro Mandant),
- einer `User`-Tabelle mit `tenantId`,
- JWT-Login.

Wir machen daraus eine SaaS-App mit zwei Plänen (Starter / Pro), einer Quota
auf Notizen pro Mandant, und einer SuperAdmin-UI.

---

## Schritt 1 — Pakete installieren

```bash
cd notesapp/backend
pnpm add @saasicat/types @saasicat/spec @saasicat/nest @saasicat/prisma @saasicat/cli
```

## Schritt 2 — Plan-Catalog anlegen

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
    availableLocales: [de]

quotaKeys:
    - key: notes.max
      label: Maximale Notizen
      unit: count

features:
    - key: NOTES
      label: Notizen

plans:
    - id: starter
      name: Starter
      monthlyNet: 0
      features: [NOTES]
      quotas:
          notes.max: 25
    - id: pro
      name: Pro
      monthlyNet: 9.0
      features: [NOTES]
      quotas:
          notes.max: 1000
```

## Schritt 3 — Prisma-Schema + Migration in einem Befehl

```bash
pnpm exec saas-platform schema migrate --name=add_saas_platform --fragments=04,06
pnpm prisma generate
```

`schema migrate` macht zwei Dinge: fügt die Plattform-Models aus den gewählten
Prisma-Fragmenten idempotent in deine `schema.prisma` ein und ruft direkt
`prisma migrate dev` für die DB-Migration auf. Für den Quickstart-Scope
reichen Fragmente `04` (AuditLog) und `06` (CatalogEntries); `--all` lädt
zusätzlich Bundles, Subscriptions, Promo-Codes.

Vor der Migration kurz `schema.prisma` reviewen, ob FK-Pointer auf deine
`User`/`Tenant`-Tabellen manuell zu aktivieren sind (auskommentierte
`@relation`-Zeilen in den Fragmenten).

## Schritt 4 — Quota-Provider schreiben

Hier deklarierst du **was zählbar ist und wie man es zählt**. Pro Quota-Key
aus deiner `saas.yaml` eine Klasse, die `QuotaProvider` erfüllt und mit
`@DefinesQuota({...})` dekoriert ist.

> **Was tut `@DefinesQuota`?** Der Discovery-Scanner liest den Decorator beim
> Boot und schreibt einen Eintrag in `var/discovery-snapshot.json`. Daraus
> entsteht in der SuperAdmin-UI eine reviewbare Quota — inklusive Verbindung
> zum `Feature`, der diese Quota enthält. **Außerdem nutzt der
> `EnforceQuotaInterceptor` aus Schritt 6 den Provider zur Laufzeit, um den
> aktuellen Verbrauch des Tenants zu zählen.**

`backend/src/saas-adapters/notes-quota.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DefinesQuota } from '@saasicat/nest/discovery';
import type { QuotaProvider } from '@saasicat/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@DefinesQuota({
    key: 'notes.max', // muss zu saas.yaml/quotaKeys passen
    label: 'Notizen-Anzahl',
    unit: 'count',
    policy: 'hard', // 'hard' = blockiert, 'soft' = warnt nur
    feature: 'NOTES', // verknüpft Quota mit Feature aus saas.yaml
})
export class NotesQuotaProvider implements QuotaProvider {
    readonly key = 'notes.max';
    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<number> {
        return this.prisma.note.count({ where: { tenantId } });
    }
}
```

## Schritt 5 — Adapter-Modul anlegen

Statt 3 Prisma-Adapter selbst zu schreiben, importierst du sie aus
`@saasicat/prisma` und bindest deinen `PrismaService` an das
Plattform-Token.

| Klasse                       | Implementiert Port |
| ---------------------------- | ------------------ |
| `PrismaMfaAdapter`           | `MfaPort`          |
| `PrismaAuditAdapter`         | `AuditPort`        |
| `AsyncLocalRlsBypassAdapter` | `RlsBypassPort`    |

> **Warum nicht alles in der Plattform?** Die Plattform liefert die
> **Adapter**, du bindest **deinen PrismaService** als `PRISMA_CLIENT_TOKEN`
> ein. Wer Drizzle, TypeORM oder abweichendes Schema hat, schreibt weiterhin
> eigene Adapter — die Plattform-Ports bleiben identisch.

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

> **RLS-Bypass:** Im `PrismaService` rufst du `rls.isBypassActive()` (z. B.
> in einer Prisma-Middleware) ab und setzt `SET LOCAL row_security = off` für
> die aktuelle Transaktion, wenn aktiv. Snippet im README von
> `@saasicat/prisma`.

## Schritt 6 — AppModule wiren (inkl. Auto-Enforcement)

`SaasPlatformModule` bündelt PlanCatalog + Discovery + Admin + AdminManifest
in einem Aufruf **und aktiviert automatisch den Feature-Guard +
Quota-Interceptor**, sobald du `defaultPlanId` (Quickstart-Pfad) oder
`adapters.planResolver` (V3-Pfad) übergibst.

| Feld                | Was es bewirkt                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `planCatalog`       | Plan/Feature/Quota-Definition aus der YAML.                                                |
| `controller.guards` | Pflicht-Guards für `/admin/manifest` + `/admin/discovery` (typisch `[JwtAuthGuard]`).      |
| `adapters`          | Prisma-Adapter aus Schritt 5 via `useExisting`.                                            |
| `defaultPlanId`     | Fallback-Plan für alle Tenants, wenn kein `planResolver` gesetzt — Dev/Smoke.              |
| `quotaProviders`    | `QuotaProvider`-Klassen aus Schritt 4 — `EnforceQuotaInterceptor` nutzt sie für `count()`. |
| `tenantManifest`    | Aktiviert `GET /tenant/manifest` (Features + Quotas + gefilterte Navigation).              |

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
import { PrismaMfaAdapter, PrismaAuditAdapter, AsyncLocalRlsBypassAdapter } from '@saasicat/prisma';
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
                // Für V3 (echte Verträge): hier zusätzlich
                //   planResolver: { useExisting: MyTenantPlanResolver },
                // Solange weggelassen, greift defaultPlanId.
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

**Was hier automatisch passiert:**

- `StaticEntitlementService` wird registriert — liest pro Tenant aus dem
  Plan-Catalog (via `planResolver` oder `defaultPlanId`) Features + Quotas.
- `StaticFeatureGuard` wird als `APP_GUARD` registriert — `@RequireFeature(...)`
  wirft jetzt automatisch 403, wenn das Feature im Plan fehlt.
- `EnforceQuotaInterceptor` wird als `APP_INTERCEPTOR` registriert —
  `@EnforceQuota(...)` wirft automatisch `LimitExceededError`, sobald
  `provider.count(tenantId) + delta > planLimit`.
- `TenantManifestService` + Controller werden registriert, falls
  `tenantManifest` gesetzt ist.

## Schritt 7 — Capability + Feature + Quota im Code deklarieren

Vier Decorators verheiraten den Code mit der Plattform:

| Decorator                                      | Wo                              | Bewirkt                                                                                                  |
| ---------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@DefinesQuota({ key, feature, ... })`         | Klasse mit `QuotaProvider`-Impl | „Es gibt diese Quota, ich kann sie zählen." → Discovery-UI + Interceptor-Quelle.                         |
| `@ImplementsCapability(key, { feature, ... })` | Endpoint-Methode                | „Dieser Endpoint realisiert die Capability." → Discovery-UI, kann in Plänen aufgenommen werden.          |
| `@RequireFeature(...keys)`                     | Endpoint-Methode                | Plattform-`StaticFeatureGuard` prüft beim Request: ist mind. **eines** der Features im aktiven Plan?     |
| `@EnforceQuota(quotaKey)`                      | Endpoint-Methode                | Plattform-`EnforceQuotaInterceptor` ruft den `QuotaProvider` und vergleicht `count + delta ≤ planLimit`. |

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
        label: 'Notiz erstellen',
        feature: 'NOTES',
        kind: 'endpoint',
        owner: 'notes',
    })
    @RequireFeature('NOTES') // 403 wenn Plan das Feature nicht enthält
    @EnforceQuota('notes.max') // 429 LimitExceeded wenn count(tenantId) >= 25 (Starter)
    create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
        return this.notes.create(user.tenantId, dto);
    }
}
```

Beide Checks laufen jetzt **automatisch** — du musst nichts mehr in den
Service-Code einbauen. Bei Race-kritischen Operations (z. B. großem
File-Upload gegen Storage-GB) ist der transaktionale Pfad
`EntitlementService.enforceLimit({ tenantId, dimension, currentUsage, insert })`
weiterhin sauberer; siehe [Handbuch §6](saas-platform.md#6-nestjs-integration--schritt-für-schritt).

## Schritt 8 — Backend starten + SuperAdmin per CLI anlegen

```bash
pnpm start:dev
```

Beim Boot prüfen:

```bash
jq '.capabilities[].capabilityKey' var/discovery-snapshot.json
#   → "notes.create"
```

Ersten SuperAdmin + MFA anlegen: über den **First-Run-Setup-Wizard** im
Admin-UI (`SETUP_TOKEN` setzen, dann zeigt die Login-Seite den Wizard, solange
kein SUPER_ADMIN existiert). Siehe [Handbuch §6.10](saas-platform.md#610-first-run-setup-superadmin-bootstrap-übers-admin-ui).

> Voraussetzung: deine App-CLI bindet den `AdminBootstrapCommand` als
> `nest-commander`-Subcommand ein, der `PrismaSuperAdminBootstrapAdapter`
> ist im `CliContextModule.forRoot({ superAdminBootstrapPort })`
> registriert.

Optional aber empfohlen: `notesapp doctor` für Plattform-Self-Check (Plan-
Catalog geladen, Discovery-Snapshot, UserPort erreichbar, AdminManifest
baubar). Aktivieren mit `defaultDoctorChecks: true` im
`CliContextModule.forRoot()`.

## Schritt 9 — Admin-Frontend in einem Befehl

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

Erzeugt ein lauffähiges Vue-3 + Quasar + Vite-Projekt mit:

- `createSuperAdminApp(...)` Bootstrap (Quasar + Pinia + Router + Auth-Guard + Manifest-Guard)
- HTTP-Client mit Token-Handling
- Routes für alle Standard-Pages (Dashboard, Tenants, Plans, Discovery, …)
- Branding-Variablen in `src/styles/theme.scss`

Du musst nur noch **`src/services/http.ts#adminLogin`** an dein Backend-Auth
anpassen.

### Frontend-Feature-Gate (Tenant-UI)

Für die App-eigene Tenant-UI (nicht SuperAdmin) liefert die Plattform drei
Bausteine, die zusammenarbeiten:

```ts
// main.ts der Tenant-App
import { provideEntitlement, useTenantManifest } from '@saasicat/ui-vue';

const manifest = useTenantManifest({ endpoint: '/api/v1/tenant/manifest' });
// manifest.value → { planId, features, quotas, navigation }
// manifest.hasFeature('NOTES') → boolean

// Wenn du das alte useEntitlement weiterhin nutzt:
provideEntitlement(app, manifest); // FeatureGate + Router-Guard nutzen es
```

Dann deklarativ Sichtbarkeit im Template steuern:

```vue
<template>
    <FeatureGate feature="NOTES">
        <RouterLink to="/notes">Notizen</RouterLink>
        <template #fallback>
            <span class="muted">Upgrade auf Pro für Notizen</span>
        </template>
    </FeatureGate>
</template>

<script setup>
import FeatureGate from '@saasicat/ui-vue/components/FeatureGate.vue';
</script>
```

Und Routen blocken:

```ts
import { buildFeatureRouterGuard } from '@saasicat/ui-vue';

router.beforeEach(
    buildFeatureRouterGuard({
        getEntitlement: () => manifest,
        redirectTo: '/upgrade',
    }),
);

// Routen-Meta:
{ path: '/notes', component: NotesPage, meta: { requiresFeature: 'NOTES' } }
```

> **Sicherheitshinweis:** Frontend-Feature-Gate ist **Komfort, kein
> Schutz**. Der eigentliche Schutz liegt im Backend (`@RequireFeature` +
> `@EnforceQuota`, Schritt 7). Das Frontend versteckt nur Knöpfe, die das
> Backend ohnehin ablehnen würde.

## Schritt 10 — Verifizieren

```bash
# 1. Backend liefert Admin- + Tenant-Manifest
curl -H "Authorization: Bearer <admin-token>" \
     localhost:3000/api/v1/admin/manifest | jq '.navigation.standardPages | keys'

curl -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/api/v1/tenant/manifest | jq '.features, .quotas'

# 2. Quota-Enforcement (Test-User auf starter-Plan, Limit = 25)
for i in {1..30}; do
  curl -X POST -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
       -d '{"title":"test '$i'"}' localhost:3000/notes
done
#   → 25 ok, ab #26 → 429 Limit für notes.max erreicht: 25/25

# 3. Feature-Gate prüfen (Endpoint mit @RequireFeature, das nicht im Plan ist)
curl -X POST -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/notes/export
#   → 403 Feature EXPORT nicht im aktuellen Plan enthalten
```

Admin-UI: `http://localhost:9100/admin/login` → einloggen → MFA-Code →
Dashboard. **Discovery-Page** zeigt `notes.create` als „discovered",
**Plans-Page** listet `starter` und `pro`.

**Du bist SaaS-fähig.**

---

## Was als nächstes?

In dieser Reihenfolge ergänzen:

1. **V3-Verträge** statt `defaultPlanId`: `SubscriptionRepository`,
   `PlanVersionRepository`, `TransactionRunner` implementieren →
   `entitlement: { ... }` im `SaasPlatformModule.forRoot()` aktivieren.
   Schema-Vorlagen in `prisma-fragments/01-subscription.prisma` und
   `prisma-fragments/03-plan-versions.prisma`.

2. **Catalog-Adapter** (`PlanRepository`, `BundleRepository`,
   `MarketingProjectionRepository`, `CatalogEntryRepository`) + `CatalogModule`
   wiren — damit die SuperAdmin-UI Pläne live editieren kann.
   → [Handbuch §6.3](saas-platform.md#63-platform-adapters-modul-prisma)

3. **Manifest-Contributions** für eigene SuperAdmin-KPI-Cards, Tenant-Actions,
   Project-Pages. **Tenant-Navigation**-Contributions via
   `TenantManifestService.registerNavItem(...)` in `OnModuleInit`.
   → [Handbuch §6.6](saas-platform.md#66-manifest-contributions)

4. **CLI weiter ausbauen**: `notesapp manifest hash` (CI-Pinning),
   `notesapp audit tail`. Plus `defaultDoctorChecks: true` für die 4
   Plattform-Health-Checks.
   → [Handbuch §9](saas-platform.md#9-cli-integration)

5. **Tests:** `createSaasPlatformTestModule({ planCatalog, defaultPlanId, quotaProviders })`
   aus `@saasicat/nest/testing` für Integration-Tests ohne
   eigenes Adapter-Setup.

---

## Häufiges Versagen im Quickstart

| Symptom                                                | Ursache                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `saas-platform: command not found`                     | `pnpm exec saas-platform ...` oder global `pnpm i -g @saasicat/cli`.                        |
| `prisma-fragments/-Verzeichnis nicht gefunden`         | `@saasicat/spec` fehlt in den Backend-Deps. Schritt 1 wiederholen.                          |
| `Nest can't resolve dependencies of X (?, ...)`        | `SaasAdaptersModule` steht nicht **vor** `SaasPlatformModule.forRoot()` in `imports[]`.     |
| Boot hängt mit `P2028 "Unable to start a transaction"` | RLS-Bypass nicht gegriffen — PrismaService prüft `isBypassActive()` nicht.                  |
| `discovery-snapshot.json` ist leer                     | Decorator-Modul (`NotesModule`, `SaasAdaptersModule`) fehlt in `AppModule.imports[]`.       |
| `@RequireFeature` lässt alles durch                    | Weder `defaultPlanId` noch `adapters.planResolver` gesetzt → kein StaticEntitlement aktiv.  |
| `@EnforceQuota` blockt nie                             | `QuotaProvider`-Klasse nicht in `quotaProviders: [...]` des `SaasPlatformModule.forRoot()`. |
| `@RequireFeature('NOTES')` wirft 403                   | Test-Tenant nicht auf einem Plan, der `NOTES` enthält — bei `defaultPlanId` alle gleich.    |
| Discovery-Tabs bleiben leer                            | Vite-Cache mit altem Stand. `rm -rf node_modules/.vite && pnpm dev`.                        |
| Setup-Wizard erscheint nicht / `403 SETUP_DISABLED`    | `SETUP_TOKEN`-Env nicht gesetzt, oder es existiert bereits ein SUPER_ADMIN (Self-Disable).  |
| `tenantManifest` wirft beim Boot                       | `tenantManifest` aktiv, aber weder `defaultPlanId` noch `adapters.planResolver` gesetzt.    |

Tieferer Troubleshooting siehe [Handbuch §11](saas-platform.md#11-h%C3%A4ufige-fallstricke).
