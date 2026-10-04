---
'@saasicat/tax-de': minor
'@saasicat/core': minor
---

The German tax adapter, `@saasicat/tax-de`

A new package: the tax adapter for an issuer in Germany, behind the
`TaxAdapter` port (ADR 0013). A template, not tax advice; the operator stays
responsible for the tax it charges.

- **What it decides** (`SC-PRIC-064`, which supersedes `SC-PRIC-044`): a
  subscriber in Germany at the German standard rate in force on the last day
  of the period, or without VAT where the issuer declares the small business
  exemption (`smallBusiness`, reaching subscribers in Germany only); a
  business elsewhere in the European Union with a validated VAT number under
  the reverse charge, where the issuer has a VAT number of its own; a business
  outside the Union as not taxable in Germany. Each note is German with
  English beside it, except the small business note, which stays German.
  Every other case is answered as not supported, with a sentence saying why,
  among them a VAT number of another state than the billing address.
- **How it checks a VAT number**: through VIES, naming the issuer's number as
  the requester, and recording every text field of the answer. A number VIES
  cannot read is a completed check that found it invalid; an error, a timeout
  (`viesTimeoutMs`, ten seconds by default) or an unreadable answer is a check
  that did not complete, never a valid one.
- **`TaxDecisionRequest` carries `timeZone`** in `@saasicat/core`: the
  installation's time zone, in which the days of the period count
  (`SC-PRIC-045`). `period.until` is documented as the first moment after the
  period.

Nothing asks the adapter yet. A new package in the fixed group needs its
manual first publish before the release that contains it.
