---
'@saasicat/core': major
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
---

Conclude a checkout offer with its contract in one transaction

`CheckoutOfferService.conclude(offerId, options, within)` consumes the offer,
writes its contract and runs the application's own writes, such as starting the
subscription and redeeming the promo code, on one transaction. Everything that
can refuse is checked first; a failure after that undoes all of it and leaves
the offer open. An offer concluded already for the same tenant answers with its
contract; for another tenant it is refused as consumed, and an offer changed
after its checks is refused with the new `CHECKOUT_OFFER_CHANGED`.
`SaaSiCatModule.forRoot` wires it where the persistence bundle has a contract
repository and a transaction runner; `CheckoutOfferModule.forRoot` takes
`conclusion` for wiring by hand.

- `CheckoutOfferRepository.consume(id, tx?)` writes on `tx` and only while the
  offer is open, refusing it otherwise.
- `SubscriptionContractRepository.create(data, tx?)` writes on `tx`, and
  `findByOriginalOfferId(offerId, tx?)` is new; both shipped adapters implement
  them.
- `persistenceAdapterContract` checks both, and gains the gap
  `checkoutOffers` for a harness without a `CheckoutOfferRepository`, which
  both shipped adapters declare.
