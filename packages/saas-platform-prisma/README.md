# @saasicat/prisma

Default Prisma adapters for the SaaS platform ports. Saves consumers using
Prisma + the standard schema (from `@saasicat/spec/prisma-fragments/`) from
hand-writing the ~5 adapter classes.

## Adapters

| Class                              | Implements port           | Reads/writes table |
| ---------------------------------- | ------------------------- | ------------------ |
| `PrismaMfaAdapter`                 | `MfaPort`                 | `SuperAdminMfa`    |
| `PrismaAuditAdapter`               | `AuditPort`               | `AuditEntry`       |
| `AsyncLocalRlsBypassAdapter`       | `RlsBypassPort`           | (no DB access)     |
| `PrismaSuperAdminBootstrapAdapter` | `SuperAdminBootstrapPort` | `SuperAdminUser`   |

> **Roadmap:** `PrismaPlanCatalogReadSink` and `PrismaPlanRepository` follow
> in a later iteration. The quickstart path currently uses
> `PlanCatalogModule.forRootWithCatalog(...)` directly with the `saas.yaml` —
> without a DB read sink. Apps on the DB catalog path still write the sink
> themselves.

## Usage

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

Then wire it via
`SaasPlatformModule.forRoot({ adapters: { mfa: PrismaMfaAdapter, ... } })` —
see [quickstart steps 5/6](../../docs/quickstart.md).

## Schema assumptions

The adapters expect the table names from the platform fragments:

- `SuperAdminMfa(userId, secret, enabledAt, updatedAt)`
- `AuditEntry(id, actorEmail, actorRole, entity, entityId, action, changes, createdAt)`
- `SuperAdminUser(id, email, platformRole, isActive, createdAt, updatedAt)`

If your schema differs: write your own adapters — the ports stay the same.

## RLS bypass

`AsyncLocalRlsBypassAdapter` sets `bypass: true` via `node:async_hooks` —
your `PrismaService` must read `isBypassActive()` and (e.g. via Prisma
middleware) apply `SET LOCAL row_security = off` for the current transaction
while it is active.

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

Produces `dist/index.{js,cjs,d.ts}` via tsup.
