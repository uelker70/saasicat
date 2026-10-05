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
  know, and `tax` requires `timeZone`; the start refuses the same for a
  catalogue handed over in code, which never meets the loader. Three start rules
  guard the binding: `tax.adapter-bound-as-the-file-names`,
  `tax.rate-has-one-source` (no `catalog.publicMarketingCatalog.vatRate` beside
  an adapter) and `catalog.public-catalogue-names-a-rate` (without an adapter,
  the public catalogue still needs it).
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
- **Asked before a change, over the contract it ends in.**
  `ContractFreezePort.assertPartyFor(tenantId, intended)` and
  `SubscriptionContractService.assertPartyFor(tenantId, intended, tx?)` take the
  contract the change ends in — `IntendedContract` from
  `@saasicat/nest/subscription-contract`: `effectiveFrom`, `cycle`, `endsAt` —
  and, with an adapter, decide over its first period: a plan change from today
  or from the date it is scheduled for, in the rhythm asked for; a booking, a
  version switch, a retirement's move or switch from when it freezes; `null`
  where the change ends in no contract now — a plan change, a version switch or
  a retirement's move in a trial — asks for the party alone. A port of your own
  takes the second argument, and code that calls it passes it. An activation
  through onboarding outside a trial asks too, before it writes.
- **A promo code with a fixed amount** comes off what the subscriber pays: at
  19 % its net share, at 0 % the whole amount. Every net price and promotion
  stays as offered (`SC-MKT-027` supersedes `SC-MKT-023`). With an adapter, the
  zero-invoice rule measures the amount against the lowest net price instead
  of the gross (`SC-PROMO-029` supersedes `SC-PROMO-008`), and
  `PROMO_WOULD_PRODUCE_ZERO_INVOICE` names it as `lowestApplicablePlanNet`. The
  preview and the redemption measure against the net too, so a code stored at
  or above a plan's net price is refused there with
  `WOULD_PRODUCE_ZERO_INVOICE`: review the codes before naming the adapter.
- **A code and a promotion together leave something to pay** (`SC-PROMO-030`),
  with an adapter or without: an offer whose code takes all that the plan's
  promotion leaves is refused when it is priced and when it is concluded, with
  `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED` and the reason
  `WOULD_PRODUCE_ZERO_INVOICE`, unless the code allows an invoice of zero. The
  promo preview's `discount` carries `allowZeroInvoice`.
- **What is shown.** The pricing page, the configurator, the admin manifest
  and the offer show the adapter's rate for a subscriber in the issuer's
  country. `PublicMarketingCatalogResponse` carries `vatRateShownFor`: that
  country, or `null` where the file's one rate applies to everybody.
  `MarketingCatalogProvider.getVatRate` and `publicMarketingCatalog.vatRate`
  become optional: required without an adapter, refused beside one — by the
  start, and by the page where a `CatalogModule` is mounted on its own.
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
