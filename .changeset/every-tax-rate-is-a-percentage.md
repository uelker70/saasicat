---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/spec': major
---

Every tax rate is a percentage, and nothing reads one in another unit

19 means 19 % in `config/saas.yaml`, the catalogue, a checkout offer's
`priceBreakdown.vatRate`, a contract's `priceSnapshot.vatRate` and
`ContractLineItemRecord.taxRate`. A rate is never read as a fraction or
converted from one.

- `config/saas.yaml` refuses a `vatRate` between 0 and 1, the shape of a
  fraction such as 0.19.
- `SubscriptionContractService` refuses a contract whose `priceSnapshot.vatRate`
  or any line's `taxRate` is not a percentage, with
  `SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT` — frozen from the catalogue,
  concluded from an offer or handed over by a caller. An offer the server
  priced passes.
- `vatPercentFromOfferRate` is removed from
  `@saasicat/nest/subscription-contract`.
- `getPlanPriceGross` computes through `grossFromNet` and refuses a rate that
  is not a percentage, the catalogue's or an override, with
  `SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT`.
- `1.0-line-items-record-their-money.postgres.sql` records the snapshot's rate
  as it stands and refuses a contract whose rate is outside 0 to 100 or
  between 0 and 1, naming it; it needs the rate, not the totals. It converts
  nothing: an installation that stored fractions converts them before running
  it. The pre-flight query in the upgrade guide reports the same contracts.
