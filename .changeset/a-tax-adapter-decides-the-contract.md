---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/tax-de': minor
---

A tax adapter decides the rate of every contract

`config/saas.yaml` can name a tax adapter instead of one `vatRate`
(`SC-PRIC-066` supersedes `SC-PRIC-009`), and every contract is then concluded
at the rate it decides for its subscriber (`SC-PRIC-065` supersedes
`SC-PRIC-008`). Without `tax` nothing changes.

- **Naming and binding it.** The file names the adapter, its options and the
  installation's `timeZone`; the application binds the adapter's factory,
  `SaaSiCatModule.forRoot({ tax: { adapter: germanTaxAdapterFactory() } })`.
  `vatRate` is no longer required by the schema; the loader refuses `vatRate`
  beside `tax`, a file naming neither, and a time zone the runtime does not
  know, and `tax` requires `timeZone`. Three start rules guard the binding:
  `tax.adapter-bound-as-the-file-names`, `tax.rate-has-one-source` (no
  `catalog.publicMarketingCatalog.vatRate` beside an adapter) and
  `catalog.public-catalogue-names-a-rate` (without an adapter, the public
  catalogue still needs it).
- **The contract.** An offer is priced at the rate for a subscriber in the
  issuer's country; concluding it restates its money at the rate decided for
  the subscriber, from the billing address, the business flag and a validated
  VAT number, for the contract's first period. The contract records the
  treatment beside the rate (`SC-PRIC-067` supersedes `SC-PRIC-016`). A
  successor — a change, a refresh, a frozen version, a retirement's move — is
  decided again before the contract in force ends, so a refusal leaves it
  running. Where the adapter supports no treatment, there is no contract:
  `TAX_TREATMENT_NOT_SUPPORTED` (422) with the adapter's sentence, and a
  retirement's move records the failure `tax-not-supported` and tries again.
  A contract handed to `SubscriptionContractService.create` at another rate is
  refused with `SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED`, naming the field
  and the decided rate.
- **A promo code with a fixed amount** comes off what the subscriber pays: at
  19 % its net share, at 0 % the whole amount. Every net price and promotion
  stays as offered (`SC-MKT-027` supersedes `SC-MKT-023`). With an adapter, the
  zero-invoice rule measures the amount against the lowest net price instead
  of the gross (`SC-PROMO-029` supersedes `SC-PROMO-008`), and
  `PROMO_WOULD_PRODUCE_ZERO_INVOICE` names it as `lowestApplicablePlanNet`.
- **What is shown.** The pricing page, the configurator, the admin manifest
  and the offer show the adapter's rate for a subscriber in the issuer's
  country. `PublicMarketingCatalogResponse` carries `vatRateShownFor`: that
  country, or `null` where the file's one rate applies to everybody.
  `MarketingCatalogProvider.getVatRate` and `publicMarketingCatalog.vatRate`
  become optional: required without an adapter, refused beside one.
- **For code of your own,** `TAX_TREATMENTS_TOKEN` from
  `@saasicat/nest/billing` resolves `TaxTreatments`, the one source of the
  shown and the decided rate.
- **In `@saasicat/core`:** `TaxAdapterFactory`, `PlanCatalogTax`,
  `TAX_ERROR_CODES` and the two codes with their English and German texts.
- **In `@saasicat/tax-de`:** `germanTaxAdapterFactory(codeOptions)`. The file
  may give `smallBusiness` and nothing else; `fetch`, `viesTimeoutMs` and `now`
  go to the factory.
- **Settings in the database** (`SC-CFG-037` supersedes `SC-CFG-034`): an
  installation whose plans live in the database reads `tax` and `timeZone`
  from the file too.

The upgrade guide has the steps for an existing installation.
