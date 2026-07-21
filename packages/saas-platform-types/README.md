# @saasicat/types

TypeScript interfaces of the SaaS platform — wire-format types for
AdminManifest, PlanCatalog, PromoCode, AuditEvent, Subscription, PlanVersion
and the adapter ports.

Derived from the JSON Schemas in
[`@saasicat/spec`](https://www.npmjs.com/package/@saasicat/spec). The `src/generated/`
types are generated from the schemas via `pnpm gen:types`
(`json-schema-to-typescript`); a drift test keeps schemas and snapshots in
sync.

## Contents

| File                      | Contents                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `admin-manifest.types.ts` | `AdminManifest`, `ManifestContribution`, `ProjectPageDef`, `KpiCardDef`, `TenantActionDef`, …        |
| `plan-catalog.types.ts`   | `PlanCatalog`, `PlanDef`, `FeatureKey`, `PlanId`, `QuotaKey`                                         |
| `promo-code.types.ts`     | `PromoCode`, `CreatePromoCodeRequest`, `PromoCodeRedemption`, validation result enum, `BillingCycle` |
| `audit-event.types.ts`    | `AuditEntry`, `AuditQuery`, `ActorTag`                                                               |
| `subscription.types.ts`   | `Subscription`, `PlanVersion`, `SubscriptionBundleRecord`, `VersionChange`                           |
| `ports.types.ts`          | `TenantPort`, `UserPort`, `QuotaProvider`, `MfaPort` (adapter interfaces)                            |

## Usage

```ts
import type {
    AdminManifest,
    ManifestContribution,
    PlanCatalog,
    QuotaProvider,
} from '@saasicat/types';
```

```bash
pnpm add @saasicat/types
```

## Build

```bash
pnpm --filter @saasicat/types build
```

Produces `dist/index.{js,cjs,d.ts,d.cts}` via `tsup`.

## Invariants

- **No runtime logic.** Type definitions only.
- **`schemaVersion` of the manifest/catalog structures is `1`.** A major bump
  there bumps this package's version as well.
- **Required fields mirror the schemas.** Anything non-optional here must be
  non-optional in the schema too — otherwise it drifts.
