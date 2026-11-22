---
'@saasicat/nest': minor
---

An application injects the preview of a checkout offer

`CheckoutOfferModule` now exports `CheckoutOfferPricing`, so a checkout of your
own injects it with `@Inject(CheckoutOfferPricing)` from
`@saasicat/nest/checkout-offer` rather than reaching it through `ModuleRef`
with `strict: false`. Its `price(selection, asOf)` gives the amounts an offer
created from the same selection carries and stores no offer; it holds and
redeems no promo code, and a code it checks is recorded in the validation log
like every check (`SC-MKT-031`).

**Breaking:** `price()` refuses an add-on whose feature needs one that neither
the plan nor a selected add-on brings, with
`CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED`, as creating the offer does; a
preview showed a price for a selection the offer then refused.
`CheckoutOfferService` no longer takes the plan and catalogue entry
repositories, and `CheckoutOfferPricing` takes the catalogue entry repository
as an optional last argument, which matters only where you construct either by
hand. See "`CheckoutOfferPricing.price` refuses an unmet feature dependency" in
`docs/guides/upgrade-to-1.0.md`.
