# @saasicat/core

## What this is

The shared core of the SaaS platform: the wire-format types — AdminManifest,
PlanCatalog, PromoCode, AuditEvent, Subscription, PlanVersion, the adapter
ports — **and the pure domain logic both sides run**: the error-code catalogues
and their texts, `classifyPlanDiff`, the promo arithmetic, the
feature-requires rules, version editability. Until 1.0 this package was called
`@saasicat/types`, a name that promised less than it carried; server and
browser import the same functions from here so the two cannot drift, and the
pricing/proration logic is planned to consolidate here too.

Derived from the JSON Schemas in
[`@saasicat/spec`](https://www.npmjs.com/package/@saasicat/spec). The `src/generated/`
types are generated from the schemas via `pnpm gen:types`
(`json-schema-to-typescript`); a drift test keeps schemas and snapshots in
sync.

## What this is not

Not a types-only package, despite what its predecessor's name promised. It
carries 45 runtime exports — `classifyPlanDiff`, `applyPromo`,
`resolveErrorMessage`, the error-code catalogues, the feature-requires rules —
because backend and admin UI must reach the same verdict, and two
implementations of the same rule reach two.

Not the source of truth for the wire formats either. That is `@saasicat/spec`;
the types under `src/generated/` are produced from its JSON Schemas, and a
drift test rejects an edit made here.

## Contents

| File                      | Contents                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `admin-manifest.types.ts` | `AdminManifest`, `ManifestContribution`, `ProjectPageDef`, `KpiCardDef`, `TenantActionDef`, …        |
| `plan-catalog.types.ts`   | `PlanCatalog`, `PlanDef`, `FeatureKey`, `PlanId`, `QuotaKey`                                         |
| `promo-code.types.ts`     | `PromoCode`, `CreatePromoCodeRequest`, `PromoCodeRedemption`, validation result enum, `BillingCycle` |
| `audit-event.types.ts`    | `AuditEntry`, `AuditQuery`, `ActorTag`                                                               |
| `subscription.types.ts`   | `Subscription`, `PlanVersion`, `SubscriptionBundleRecord`, `VersionChange`                           |
| `ports/*.types.ts`        | `TenantPort`, `UserPort`, `QuotaProvider`, `MfaPort` (adapter interfaces)                            |

## Usage

```ts
import type {
    AdminManifest,
    ManifestContribution,
    PlanCatalog,
    QuotaProvider,
} from '@saasicat/core';
```

```bash
pnpm add @saasicat/core
```

## Build

```bash
pnpm --filter @saasicat/core build
```

Produces `dist/index.{js,cjs,d.ts,d.cts}` via `tsup`.

## Invariants

- **No runtime logic.** Type definitions only.
- **`schemaVersion` of the manifest/catalog structures is `1`.** A major bump
  there bumps this package's version as well.
- **Required fields mirror the schemas.** Anything non-optional here must be
  non-optional in the schema too — otherwise it drifts.

## Next

- [The vocabulary](../../docs/explanation/concepts.md) — capability, feature, quota, plan, contract
- [Codegen](../../docs/explanation/adr/0006-spec-to-types-codegen.md) — what is generated, and what
  is not
- [`@saasicat/spec`](../spec/README.md) — the schemas these types come from
