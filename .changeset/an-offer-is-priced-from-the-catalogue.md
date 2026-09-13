---
'@saasicat/core': major
'@saasicat/nest': major
---

A checkout offer is priced from the catalogue; a caller only chooses

`POST` and `PATCH /public/checkout-offer` and `CheckoutOfferService.create` and
`update` take a selection — `planKey`, `billingCycle`, `bundleVersionIds`,
`promoCode`, `locale`, `validUntil` — typed as `CheckoutOfferSelection` and
`CheckoutOfferSelectionUpdate`. The plan version on sale, the bundle prices for
that plan, the promotion the public catalogue picks, the promo code discount
and the installation's currency and VAT rate make up every amount on the
stored offer. `priceBreakdown`, `lineItems`, `promotionSnapshots`,
`promoCodeSnapshot`, `planVersionId`, `promotionId` and `bundles` are no longer
accepted in a request.

- A plan without a price for the rhythm, an add-on that is not on sale, not
  marketed, incompatible or not priced for the plan, and a promo code the promo
  module refuses or cannot check are refused with
  `CHECKOUT_OFFER_PLAN_NOT_OFFERED`, `CHECKOUT_OFFER_BUNDLE_NOT_OFFERED` or
  `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED`.
- `consume` computes the amounts again from the versions the offer froze and
  refuses one whose stored amounts differ, or that names no plan version, with
  `CHECKOUT_OFFER_PRICE_NOT_CURRENT`. An open offer created before this release
  may have to be created again.
- `priceBreakdown.vatRate` is stated in per cent, as `config/saas.yaml` names
  it. A contract created from an offer reads either unit.
- `CheckoutOfferModule.forRoot` requires `planRepository` and accepts
  `promotionRepository`; `SaaSiCatModule.forRoot` supplies both from the
  persistence bundle, and registers the promo module globally when checkout
  offers are on, so a promo code can be checked.
