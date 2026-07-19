# @saasicat/nest

NestJS-Implementierung der SaaS-Plattform — Billing, Promo, Admin-Backend,
Audit, MFA, Adapter-Ports.

## Sub-Entries

```ts
import { computeDiscountGross, buildLabel, round2 } from '@saasicat/nest/promo';
```

| Entry                  | Inhalt                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@saasicat/nest/promo` | `computeDiscountGross`, `computeDiscountedGross`, `computeRegularStartsAt`, `addCycles`, `buildLabel`, `round2`, `grossFromNet`, `computeIncludedVat` — alles pure Functions |

Weitere Entries: `./billing`, `./entitlement`, `./admin`, `./registration`,
`./discovery`, `./catalog`, `./checkout-offer`, `./subscription-contract`,
`./platform`, `./testing`.

## Konsum

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

## Konvention

- **Pure Functions ohne NestJS-Dekoratoren** dürfen unter `src/<area>/` liegen.
  NestJS-Module + Services verlangen `@nestjs/common` als peerDependency.
- **Keine Prisma-Imports.** Wer Wire-Format-Types braucht, importiert aus
  `@saasicat/types`.
- **Schema-Fragmente** für `prisma/schema.prisma`-Merge kommen unter
  `prisma-fragments/` — separat versioniert.

## Build

```bash
pnpm --filter @saasicat/nest build
```

Erzeugt `dist/index.{js,cjs,d.ts}` plus `dist/promo/index.{js,cjs,d.ts}`
über tsup mit Multi-Entry.
