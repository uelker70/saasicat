# @saasicat/types

TypeScript-Interfaces der SaaS-Plattform — Wire-Format-Types für AdminManifest,
PlanCatalog, PromoCode, AuditEvent, Subscription, PlanVersion und Adapter-Ports.

Abgeleitet aus den JSON-Schemas in
[`@saasicat/spec`](../saas-platform-spec/README.md). Die `src/generated/`-Types
werden via `pnpm gen:types` (`json-schema-to-typescript`) aus den Schemas
generiert; ein Drift-Test hält Schemas und Snapshots synchron.

## Inhalt

| Datei                     | Inhalt                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `admin-manifest.types.ts` | `AdminManifest`, `ManifestContribution`, `ProjectPageDef`, `KpiCardDef`, `TenantActionDef`, …        |
| `plan-catalog.types.ts`   | `PlanCatalog`, `PlanDef`, `FeatureKey`, `PlanId`, `QuotaKey`                                         |
| `promo-code.types.ts`     | `PromoCode`, `CreatePromoCodeRequest`, `PromoCodeRedemption`, Validation-Result-Enum, `BillingCycle` |
| `audit-event.types.ts`    | `AuditEntry`, `AuditQuery`, `ActorTag`                                                               |
| `subscription.types.ts`   | `Subscription`, `PlanVersion`, `SubscriptionBundleRecord`, `VersionChange`                           |
| `ports.types.ts`          | `TenantPort`, `UserPort`, `QuotaProvider`, `MfaPort` (Adapter-Schnittstellen)                        |

## Konsum

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

Erzeugt `dist/index.{js,cjs,d.ts,d.cts}` via `tsup`.

## Verbindlich

- **Keine Runtime-Logik.** Nur Type-Definitionen.
- **`schemaVersion` der Manifest-/Catalog-Strukturen ist `1`.** Bei Major-Bump
  wird die Version dieses Pakets ebenfalls bumped.
- **Pflichtfelder spiegeln die Schemas.** Wer hier nicht-optional schreibt,
  muss es im Schema auch sein — sonst Drift.
