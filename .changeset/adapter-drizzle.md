---
'@saasicat/adapter-drizzle': minor
---

New package: the Drizzle + PostgreSQL persistence adapter — the proof that SaaSicat's ports are ORM-agnostic in practice, not just on paper.

- `drizzlePersistence({ db })` bundle for `SaasPlatformModule.forRoot({ persistence })`, mirroring `prismaPersistence()` slice by slice (core incl. transaction runner and audit write/query/stats, entitlement with row-locked `findByTenantIdLocked`, promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull` as guarded UPDATE … RETURNING, SuperAdmin bootstrap, plan-catalog read/import sinks).
- Driver-independent: typed against `PgDatabase` from `drizzle-orm/pg-core`, so node-postgres and postgres.js clients both work; row counts come from RETURNING instead of driver-specific result shapes.
- Targets the same canonical schema (`@saasicat/spec` reference SQL) as adapter-prisma — ids and `updatedAt` are generated app-side to match Prisma's client-side behavior, enum columns are declared as text and coerced by Postgres.
- Passes the identical `@saasicat/persistence-testing` contract against a real PostgreSQL (CI runs both adapters in the persistence-contract job), plus drizzle-specific interop tests for enum round-trips and the subscription CHECK constraint.
