# @saasicat/nest

NestJS implementation of the SaaS platform — billing, promo codes, admin
backend, audit, MFA, adapter ports.

## Sub-entries

```ts
import { computeDiscountGross, buildLabel, round2 } from '@saasicat/nest/promo';
```

| Entry                  | Contents                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@saasicat/nest/promo` | `computeDiscountGross`, `computeDiscountedGross`, `computeRegularStartsAt`, `addCycles`, `buildLabel`, `round2`, `grossFromNet`, `computeIncludedVat` — all pure functions  |

Further entries: `./billing`, `./entitlement`, `./admin`, `./registration`,
`./discovery`, `./catalog`, `./checkout-offer`, `./subscription-contract`,
`./platform`, `./testing`.

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
  `@saasicat/types`.
- **Schema fragments** for the `prisma/schema.prisma` merge live in
  `prisma-fragments/` — versioned separately.

## Build

```bash
pnpm --filter @saasicat/nest build
```

Produces `dist/index.{js,cjs,d.ts}` plus `dist/promo/index.{js,cjs,d.ts}`
via tsup with multiple entries.
