# @saasicat/prisma

Default-Prisma-Adapter für die SaaS-Plattform-Ports. Spart Konsumenten,
die Prisma + das Standard-Schema (aus
`@saasicat/spec/prisma-fragments/`) nutzen, das händische
Schreiben der ~5 Adapter-Klassen.

## Adapter

| Klasse                             | Implementiert Port        | Liest/schreibt Tabelle |
| ---------------------------------- | ------------------------- | ---------------------- |
| `PrismaMfaAdapter`                 | `MfaPort`                 | `SuperAdminMfa`        |
| `PrismaAuditAdapter`               | `AuditPort`               | `AuditEntry`           |
| `AsyncLocalRlsBypassAdapter`       | `RlsBypassPort`           | (kein DB-Zugriff)      |
| `PrismaSuperAdminBootstrapAdapter` | `SuperAdminBootstrapPort` | `SuperAdminUser`       |

> **Roadmap:** `PrismaPlanCatalogReadSink` und `PrismaPlanRepository` folgen
> in einer späteren Iteration. Aktuell nutzt der Quickstart-Pfad
> `PlanCatalogModule.forRootWithCatalog(...)` direkt mit der `saas.yaml` —
> ohne DB-Read-Sink. Wer den DB-Catalog-Pfad fährt, schreibt den Sink
> weiterhin selbst.

## Konsum

```ts
import { Module } from '@nestjs/common';
import {
    AsyncLocalRlsBypassAdapter,
    PrismaAuditAdapter,
    PrismaMfaAdapter,
    PrismaSuperAdminBootstrapAdapter,
    PRISMA_CLIENT_TOKEN,
} from '@saasicat/prisma';
import { PrismaService } from './prisma/prisma.service';

@Module({
    providers: [
        { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
        PrismaMfaAdapter,
        PrismaAuditAdapter,
        AsyncLocalRlsBypassAdapter,
        PrismaSuperAdminBootstrapAdapter,
    ],
    exports: [
        PrismaMfaAdapter,
        PrismaAuditAdapter,
        AsyncLocalRlsBypassAdapter,
        PrismaSuperAdminBootstrapAdapter,
    ],
})
export class SaasAdaptersModule {}
```

Dann via `SaasPlatformModule.forRoot({ adapters: { mfa: PrismaMfaAdapter, ... } })`
verdrahten — siehe
[Quickstart Schritt 5/6](../../docs/saas-platform-quickstart.md).

## Schema-Annahme

Die Adapter erwarten die Tabellen-Namen aus den Plattform-Fragmenten:

- `SuperAdminMfa(userId, secret, enabledAt, updatedAt)`
- `AuditEntry(id, actorEmail, actorRole, entity, entityId, action, changes, createdAt)`
- `SuperAdminUser(id, email, platformRole, isActive, createdAt, updatedAt)`

Wer abweicht: Adapter selbst schreiben — die Ports bleiben dieselben.

## RLS-Bypass

`AsyncLocalRlsBypassAdapter` setzt `bypass: true` per `node:async_hooks` —
dein `PrismaService` muss `isBypassActive()` lesen und (z. B. via Prisma-
Middleware) `SET LOCAL row_security = off` für die aktuelle Transaktion
setzen, wenn aktiv.

```ts
this.$use(async (params, next) => {
    if (rls.isBypassActive()) {
        await this.$executeRawUnsafe('SET LOCAL row_security = off');
    }
    return next(params);
});
```

## Build

```bash
pnpm --filter @saasicat/prisma build
```

Erzeugt `dist/index.{js,cjs,d.ts}` über tsup.
