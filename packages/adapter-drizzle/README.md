# @saasicat/adapter-drizzle

The Drizzle + PostgreSQL persistence adapter for SaaSiCat. Same ports, same
canonical schema and the same executable contract as
`@saasicat/adapter-prisma` — `@saasicat/persistence-testing` runs the
identical suite against both adapters in CI, which is what makes "swap the
ORM, keep the guarantees" a verified claim.

## Quickstart — the bundle

```ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzlePersistence } from '@saasicat/adapter-drizzle';

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));

SaasPlatformModule.forRoot({
    planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
    controller: { guards: [JwtAuthGuard] },
    imports: [AuthModule],
    persistence: drizzlePersistence({ db }),
    entitlement: {},
});
```

`drizzlePersistence({ db })` accepts a ready Drizzle database (any pg
driver — node-postgres, postgres.js) or an injection token, and returns the
same `SaasicatPersistenceAdapter` bundle shape as `prismaPersistence()`.
Options: `passwordHasher` (enables `core.superAdminProvisioning`) and
`rlsIntegration` (declares the `rowLevelSecurity` capability once your db
layer applies the bypass).

## Schema

The adapter queries the canonical tables from
`@saasicat/spec/sql/reference-schema.postgres.sql` (+
`constraints.postgres.sql`) — apply that DDL in your migrations. The
exported `saasicatSchema` table map is **query-side only** (not for
drizzle-kit migrations); mix it freely with your own app tables:

```ts
import { saasicatSchema } from '@saasicat/adapter-drizzle';

const active = await db
    .select()
    .from(saasicatSchema.subscriptions)
    .where(eq(saasicatSchema.subscriptions.tenantId, tenantId));
```

Conventions the adapter upholds for Prisma parity on the shared schema:

- `id`/`updatedAt` have no DB defaults — the adapter generates
  `crypto.randomUUID()` and timestamps app-side, like the Prisma client.
- Enum columns are declared as `text`; Postgres coerces parameterized
  values to the enum types (covered by interop tests).
- Row counts for the atomic promo mutations come from `RETURNING`, which
  behaves identically across Drizzle pg drivers.

## Shipped adapters

Identical port coverage to `@saasicat/adapter-prisma` (see its README for
the table): transaction runner, subscription/plan-version repositories
(row-locked `findByTenantIdLocked`), the three promo repositories with
atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, audit
write/query/stats, MFA, RLS bypass, SuperAdmin bootstrap
(`PASSWORD_HASHER_TOKEN`), plan-catalog read/import sinks, and the
`ZeroPromoRevenueDeductionAggregator` default. Not shipped: contracts,
bundle bookings, registration, tenant-billing write ports,
`FirstTimeCustomerCheck` — same as the Prisma adapter.

Manual wiring binds the db via `DRIZZLE_DB_TOKEN`.

## Tests

```bash
pnpm --filter @saasicat/adapter-drizzle test              # wiring/schema sanity
SAASICAT_TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/postgres \
pnpm --filter @saasicat/adapter-drizzle test:integration  # contract vs. real PG
```

The integration run applies the normative reference SQL and executes the
`@saasicat/persistence-testing` contract plus drizzle-specific interop
tests. **The database is disposable: the harness drops and recreates its
`public` schema.**
