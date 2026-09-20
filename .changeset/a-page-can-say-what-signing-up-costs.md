---
'@saasicat/core': minor
'@saasicat/nest': minor
---

The public catalogue says what a new payment method is taken with

A page that offers the plans is written before anybody signs up, and nothing
told it whether a payment method would be asked for. Whether one is follows from
`config/saas.yaml#payments.newPaymentMethods` and the gateway bound for that
account, neither of which the page can see — so a screen that said "no payment
method is taken" kept saying it after a gateway was bound, and the visitor found
out at the form.

`GET /public/marketing-catalog` now answers `newPaymentMethods`:

```json
{ "taken": true, "methods": ["card", "sepa_debit"] }
```

It says what this installation takes a new payment method with — the account a
sign-up's payment step and a tenant's own change both go to — in the order the
file names the methods. Whether you run a sign-up at all is your own wiring and
not part of the answer. Which account it is and who keeps the payment method
stay inside: a prospect is told that a card or a direct debit will be asked for,
not where it is kept.

`SaaSiCatModule` wires it wherever `payments` is configured. A `CatalogModule`
mounted by hand takes it as
`publicMarketingCatalog.newPaymentMethodsFrom: PaymentGatewayRegistry`; left
out, the catalogue publishes that none is taken, and pointed at a registry it
cannot reach, it refuses to start rather than publishing the same thing. Where
your own sign-up route wants the answer in process,
`PaymentGatewayRegistry.forNewPaymentMethods()` from `@saasicat/nest/payments`
is where the catalogue reads it.

`PublicMarketingCatalogResponse` carries the field as required rather than
optional, so a consumer that builds one itself — a test fixture, a mock of the
endpoint — has to say what its installation does.
