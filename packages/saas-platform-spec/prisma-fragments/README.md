---
doc_title: SaaS-Plattform Prisma-Fragmente
status: living document
related:
    - ../schemas/plan-catalog.schema.json
    - ../schemas/promo-code.schema.json
    - ../schemas/audit-event.schema.json
    - ../../saas-platform-types/src/subscription.types.ts
---

# Prisma-Fragmente

Referenz-Snippets, die das **kanonische Datenbank-Schema** der SaaS-
Plattform dokumentieren. Konsumenten-Apps kopieren die Models in ihre eigene
`schema.prisma` und ergänzen FK-Relationen zu ihren projekt-spezifischen
`Tenant`/`User`-Models.

## Dateien

| Datei                                                                | Models                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`01-subscription.prisma`](01-subscription.prisma)                   | `Subscription`, `SubscriptionPaymentMethod`, `CheckoutOffer` + Enums                   |
| [`02-promo-code.prisma`](02-promo-code.prisma)                       | `PromoCode`, `PromoCodeRedemption`, `PromoCodeValidationLog` + Enums                   |
| [`03-plan-versions.prisma`](03-plan-versions.prisma)                 | `Plan`, `PlanVersion`                                                                  |
| [`04-audit-log.prisma`](04-audit-log.prisma)                         | `AuditLog`                                                                             |
| [`05-bundle-business-type.prisma`](05-bundle-business-type.prisma)   | `Bundle`, `BundleVersion`, `BusinessType`, `BusinessTypeVersion`, `BusinessTypeBundle` |
| [`06-catalog-entries.prisma`](06-catalog-entries.prisma)             | `CapabilityCatalogEntry`, `FeatureCatalogEntry`, `MarketingProjection`                 |
| [`07-promotion.prisma`](07-promotion.prisma)                         | `Promotion`                                                                            |
| [`08-subscription-contract.prisma`](08-subscription-contract.prisma) | `SubscriptionContract`, `ContractLineItem`                                             |
| [`09-pending-registration.prisma`](09-pending-registration.prisma)   | `PendingRegistration`, `PaymentEventLog` + `RegistrationStatus`                        |

## Wie der Konsument die Fragmente nutzt

Prisma kann **kein** echtes Schema-Merging — es gibt keinen Include-Mechanismus.
Konsumenten müssen die Models in ihre eigene `schema.prisma` einfügen. Es gibt
zwei pragmatische Wege:

### Variante A — Copy-Paste (empfohlen)

1. Benötigte Models aus den Fragmenten in die eigene `schema.prisma` einfügen.
2. Auskommentierte FK-Relationen zu Konsumenten-Models (`Tenant`, `User`)
   aktivieren und auf den eigenen Model-Namen anpassen.
3. Plan/Feature-Keys bleiben als `String` — Source-of-Truth sind die im
   SuperAdmin-UI gepflegten Pläne (DB) und der via Discovery publizierte
   Feature-/Quota-Katalog.

### Variante B — Schema-Stitching via Codegen

Tools wie [`prisma-import`](https://github.com/ajmnz/prisma-import) erlauben
Include-Direktiven; sie generieren eine zusammengeführte `schema.prisma`. Für
heutige Single-Repo-Konsumenten ist Variante A einfacher.

## Konventionen

### 1. Keys sind Strings, nicht Enums

`plan` (`Subscription.plan`, `Subscription.pendingPlan`, …) und
`featureKey` sind als `String` deklariert. Source-of-Truth sind die
Plan-Stämme (`plans`-Tabelle, gepflegt im SuperAdmin-UI) und der
Feature-Katalog (`feature_catalog_entries`).

Wer **Postgres-Enums** bevorzugt: lokal ein Enum deklarieren und das Feld
via `@db.<EnumName>` casten. Keine Plattform-Anforderung — die Plattform-
Services lesen nur Strings.

### 2. FKs zu Konsumenten-Models sind dokumentiert, aber auskommentiert

Felder wie `tenantId String` und `userId String?` bleiben als reine
String-Spalten in den Fragmenten; die zugehörige `@relation` ist als
Kommentar hinterlegt. Konsument aktiviert sie mit dem eigenen
`Tenant`-/`User`-Model-Namen.

### 3. Tabellen-Namen (`@@map`) sind kanonisch

`subscriptions`, `plan_versions`, `promo_codes`, `promo_code_redemptions`,
`promo_code_validation_logs`, `audit_logs`, `bundles`, `bundle_versions`,
`business_types`, `business_type_versions`, `business_type_bundles`,
`capability_catalog_entries`, `feature_catalog_entries`,
`marketing_projections`, `subscription_contracts`, `contract_line_items`.
Bitte **nicht ändern** — sonst brechen Plattform-Migrations-Skripte und die
`@saasicat/cli`-Kommandos, die auf diese Namen bauen.

### 4. Decimal-Präzision

Alle Geldbeträge sind `Decimal(10, 2)` (max ±99 999 999,99 €), Promo-Code-
Werte sind `Decimal(8, 2)` (Prozent oder Betrag). Konsumenten sollten diese
Präzision nicht aufweichen.

### 5. Partial Unique Index für Drafts

`PlanVersion`, `BundleVersion`
und `BusinessTypeVersion` erlauben **genau einen** Draft pro
Identitätsschlüssel (`publishedAt IS NULL`). Prisma-Schema kann das nicht
ausdrücken — in der SQL-Migration ergänzen:

```sql
CREATE UNIQUE INDEX plan_versions_draft_per_plan
    ON plan_versions (plan_id) WHERE published_at IS NULL;
```

Analog für:

- `bundle_versions` (per `bundle_id`)
- `business_type_versions` (per `business_type_id`)

## Design-Entscheidungen

- **Keine festen Quota-Spalten** (`maxUsers`, `maxStorageGb`, …) — Limits
  liegen generisch in `quotas Json`; die erlaubten Keys deklariert der Code
  via `@DefinesQuota`.
- **Keine `SubscriptionPlan`-/`FeatureKey`-Enums** — beide Felder sind als
  `String` deklariert (siehe Konvention 1).
- **Keine Add-on-Tabellen (#49)** — `subscription_addons`,
  `unit_addon_versions`, `feature_addon_versions` sind keine
  Verkaufsfläche; verkauft werden nur PlanVersionen + Bundles.
- **App-spezifische Tabellen** (z. B. Rechnungs- oder Bank-Stammdaten)
  gehören in das Schema der konsumierenden App, nicht in die Plattform.
