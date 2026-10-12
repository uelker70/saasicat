---
'@saasicat/adapter-prisma': patch
---

Every shipped adapter takes the client Prisma generates from the shipped
fragments, without a cast

The fragments declare enum columns (`PromoCodeStatus`, `SubscriptionStatus`
and others) and `Json` columns, and a client Prisma generates from them asks
for the enum's members and its own JSON input there. The client shapes the
adapters take named `string` and `unknown` in those places, so
`PrismaPromoCodeRepository`, `PrismaPromoCodeRedemptionRepository`,
`PrismaPromoSubscriptionLookup`, `PrismaAuditAdapter` and the adapters that
take the whole client refused a generated client, and wiring one by hand
needed a cast. The shapes now name the unions `@saasicat/core` declares for
those columns and a JSON input type, and `PromoCodeRowLike.createdById` is
nullable as the column is (`SC-COMP-020`). Nothing changes at runtime.
