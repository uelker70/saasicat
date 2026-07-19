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
Plattform dokumentieren. Konsumenten (AutohausPro, vereinsfux, Dagitto) kopieren
die Models in ihre eigene `schema.prisma` und ergänzen FK-Relationen zu ihren
projekt-spezifischen `Tenant`/`User`-Models.

## Dateien

| Datei                                                                | Models                                                                                 | Quelle                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`01-subscription.prisma`](01-subscription.prisma)                   | `Subscription`, `SubscriptionPaymentMethod`, `CheckoutOffer` + Enums                   | UMSETZUNGSPLAN §3.2 (1.1), AutohausPro-Schema                         |
| [`02-promo-code.prisma`](02-promo-code.prisma)                       | `PromoCode`, `PromoCodeRedemption`, `PromoCodeValidationLog` + Enums                   | UMSETZUNGSPLAN §3.2 (1.2), AutohausPro-Schema                         |
| [`03-plan-versions.prisma`](03-plan-versions.prisma)                 | `Plan`, `PlanVersion`                                                                  | UMSETZUNGSPLAN §3.2 (1.3), ROADMAP §3.1                          |
| [`04-audit-log.prisma`](04-audit-log.prisma)                         | `AuditLog`                                                                             | UMSETZUNGSPLAN §3.2 (1.4)                                        |
| [`05-bundle-business-type.prisma`](05-bundle-business-type.prisma)   | `Bundle`, `BundleVersion`, `BusinessType`, `BusinessTypeVersion`, `BusinessTypeBundle` | SPEC_V2 §5 + §11 (M1), GESCHAEFTSTYP_SPEC §3.1                   |
| [`06-catalog-entries.prisma`](06-catalog-entries.prisma)             | `CapabilityCatalogEntry`, `FeatureCatalogEntry`, `MarketingProjection`                 | SPEC_V2 §3 + §5 (Discovery + Marketing), GESCHAEFTSTYP_SPEC §3.1 |
| [`07-promotion.prisma`](07-promotion.prisma)                         | `Promotion`                                                                            | SPEC_V3 §4–§5, Plan-/Bundle-/Offer-Promotions                    |
| [`08-subscription-contract.prisma`](08-subscription-contract.prisma) | `SubscriptionContract`, `ContractLineItem`                                             | SPEC_V3 §6–§8, immutable Contract Snapshot                       |
| [`09-pending-registration.prisma`](09-pending-registration.prisma)   | `PendingRegistration`, `PaymentEventLog` + `RegistrationStatus`                        | registrierung.md, vereinsfux-Schema (Referenz-Implementierung)   |

## Wie der Konsument die Fragmente nutzt

Prisma kann **kein** echtes Schema-Merging — es gibt keinen Include-Mechanismus.
Konsumenten müssen die Models in ihre eigene `schema.prisma` einfügen. Es gibt
zwei pragmatische Wege:

### Variante A — Copy-Paste (empfohlen)

1. Benötigte Models aus den Fragmenten in die eigene `schema.prisma` einfügen.
2. Auskommentierte FK-Relationen zu Konsumenten-Models (`Tenant`, `User`)
   aktivieren und auf den eigenen Model-Namen anpassen.
3. Plan/Feature-Keys bleiben als `String` — Source-of-Truth ist die
   Konsumenten-`config/plans.yaml`, validiert via
   `@saasicat/spec/schemas/plan-catalog.schema.json`.

### Variante B — Schema-Stitching via Codegen

Tools wie [`prisma-import`](https://github.com/ajmnz/prisma-import) erlauben
Include-Direktiven; sie generieren eine zusammengeführte `schema.prisma`. Für
heutige Single-Repo-Konsumenten ist Variante A einfacher.

## Konventionen

### 1. Keys sind Strings, nicht Enums

`plan` (`Subscription.plan`, `Subscription.pendingPlan`, …) und
`featureKey` sind als `String` deklariert. Source-of-Truth sind die
Konsumenten-`config/plans.yaml` (`plans[].id`) und der Feature-Katalog
(`feature_catalog_entries`).

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
Bitte **nicht ändern** — sonst brechen Plattform-Migrations-Skripte und der
Cross-Repo-CLI-Pfad (`saas-platform-cli` ab P3).

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

## Plattform vs. AutohausPro-Original

Die Fragmente sind **kein 1:1-Mirror** des AutohausPro-Schemas. Plattform-
Anpassungen gegenüber dem AutohausPro-Original:

- **`PlanVersion.maxUsers/maxVehicles/maxStorageGb`** ist zu
  `quotas Json` zusammengefasst — Quota-Keys sind plans.yaml-getrieben
  (kein hartcodierter `maxVehicles`).
- **`SubscriptionPlan` / `FeatureKey`-Enums** entfernt;
  beide sind als `String` deklariert (siehe Konvention 1).
- **Add-on-Tabellen entfernt (#49)** — `subscription_addons`,
  `unit_addon_versions`, `feature_addon_versions` sind keine
  Verkaufsfläche mehr; verkauft werden nur PlanVersionen + Bundles.
- **AutohausPro-spezifische Tabellen** (`InvoiceDiscount`, `BankInfo`) sind
  **nicht** Teil der Plattform — sie bleiben in AutohausPro.

AutohausPro selbst migriert in P1.10 (UMSETZUNGSPLAN §3.2 (1.13)) auf diese
kanonische Form. Bisher war AutohausPro nicht produktiv eingesetzt, daher gibt
es keinen Daten-Migrations-Pfad — die DB wird entleert und mit dem Seed-
Skript neu befüllt.
