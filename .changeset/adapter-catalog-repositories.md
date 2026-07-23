---
'@saasicat/adapter-prisma': minor
'@saasicat/spec': patch
---

Ship the catalog-plane Prisma repositories so a consumer can wire the full
SuperAdmin surface without hand-writing adapters.

`@saasicat/adapter-prisma` previously covered only the core/entitlement/promo
slices; every app that wanted the plans/bundles/business-types/discovery-review/
marketing pages had to implement ~2000 lines of catalog repositories itself. The
package now exports them:

- `PrismaPlanRepository` (`PlanRepository`)
- `PrismaBundleRepository` (`BundleRepository`)
- `PrismaBusinessTypeRepository` (`BusinessTypeRepository`)
- `PrismaCatalogEntryRepository` (`CatalogEntryRepository`)
- `PrismaMarketingProjectionRepository` (`MarketingProjectionRepository`)
- `PrismaMarketingSettingsRepository` (`MarketingSettingsRepository`)
- `PrismaPromotionRepository` (`PromotionRepository`)
- `PrismaSubscriptionContractRepository` (`SubscriptionContractRepository`)

Wire them into `CatalogModule.forRoot({ planRepository: { useFactory: (p) => new
PrismaPlanRepository(p), inject: [PrismaService] }, … })`. Each targets the
canonical `@saasicat/spec` schema; the generic `PrismaModelDelegateLike<Row>`
helper is also exported for adapters that need a narrow client view.

Methods that depend on columns the canonical fragments do not carry
(`PlanVersion`/`BundleVersion` validity windows, plan `terminate`) throw a
descriptive error rather than silently misbehaving — the same fail-closed policy
the shipped `PrismaSubscriptionRepository` already uses.

**`@saasicat/spec`:** the `QuotaCatalogEntry` fragment (06) gained `replaces
String[]` and `successorKey String?`, aligning it with the
`QuotaCatalogEntryRow` / `UpsertQuotaEntryData` port contract (features already
had them) so the discovery sync can persist quota succession. The generated
`sql/reference-schema.postgres.sql` is regenerated to match.
