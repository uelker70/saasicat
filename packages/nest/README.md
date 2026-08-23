# @saasicat/nest

## What this is

NestJS implementation of the SaaS platform — billing, promo codes, admin
backend, audit, MFA, adapter ports.

## What this is not

Not a standalone server. It is a set of Nest modules for an application that
already has its own HTTP stack, authentication and database — the platform
brings the product loop, not the runtime.

Not a persistence layer. Every store access goes through a port, and a port
needs an adapter: `@saasicat/adapter-prisma` or `@saasicat/adapter-drizzle`,
or your own.

Not a place to import from the root by habit. Each sub-entry is a bundle of
its own; the root additionally re-exports the platform composition, and the
reason that is safe is worth knowing before you rely on it.

## Entry points

Each sub-entry is a bundle of its own: importing from `./promo` costs you the
promo slice, not the package. The root additionally re-exports the platform
composition — see [ADR 0003](../../docs/explanation/adr/0003-one-bundle-many-entries.md)
for why that is safe and what it costs.

```ts
import { computeDiscountGross, buildLabel, round2 } from '@saasicat/nest/promo';
```

| Entry                     | What is in it                                                                    | When you take it                                     |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `.`                       | `SaaSiCatModule`, `defineSaaSiCat` and the option types — the whole composition. | The standard integration, and existing consumers.    |
| `./platform`              | The same composition, without the rest of the root surface.                      | A new application. Prefer this over `.`.             |
| `./discovery`             | `DiscoveryModule` and the four decorators that declare capabilities and quotas.  | You are annotating your controllers.                 |
| `./entitlement`           | `EntitlementModule`, `EntitlementService`, `LimitExceededError`, aggregation.    | You enforce limits yourself instead of by decorator. |
| `./catalog`               | `CatalogModule` — plans, bundles, marketing projections, promotions.             | You touch the catalogue outside the admin pages.     |
| `./billing`               | Billing periods, plan-catalog loading and import.                                | You compute periods or load a catalogue yourself.    |
| `./promo`                 | Pure promo arithmetic: discounts, cycles, labels, VAT.                           | You price something outside a checkout.              |
| `./checkout-offer`        | `CheckoutOfferModule` — the frozen offer between catalogue and contract.         | Your own checkout writes offers.                     |
| `./subscription-contract` | `SubscriptionContractModule` and the invoice-shaped projections of a contract.   | You bill from contracts.                             |
| `./admin`                 | `AdminModule`, the SuperAdmin guards, the port tokens, the manifest surface.     | You extend or replace part of the admin backend.     |
| `./registration`          | `RegistrationModule` — the only entry `SaaSiCatModule` does not compose.         | You offer self-registration.                         |
| `./testing`               | Fake adapters for every repository port, plus a `TransactionRunner`.             | You unit-test code that depends on the platform.     |

## Usage

```bash
pnpm add @saasicat/nest
```

```ts
export {
    computeDiscountGross,
    computeDiscountedGross,
    computeRegularStartsAt,
    addCycles,
    buildLabel,
    round2,
} from '@saasicat/nest/promo';
```

## Conventions

- **Pure functions without NestJS decorators** may live under `src/<area>/`.
  NestJS modules + services require `@nestjs/common` as a peerDependency.
- **No Prisma imports.** Anything needing wire-format types imports from
  `@saasicat/core`.
- **Schema fragments** for the `prisma/schema.prisma` merge live in
  `prisma-fragments/` — versioned separately.

## Build

```bash
pnpm --filter @saasicat/nest build
```

Produces `dist/index.{js,cjs,d.ts}` plus `dist/promo/index.{js,cjs,d.ts}`
via tsup with multiple entries.

## Next

- [Wire the backend](../../docs/guides/wire-the-backend.md) — every option, in the order you need them
- [Module options](../../docs/reference/options.md) — the generated lookup
- [Architecture](../../docs/explanation/architecture.md) — which module does what
