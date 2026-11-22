---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

An application decides which billing details its tenants change

An application that keeps the address on a page of its own now names the
contact details a tenant changes in its billing area:
`tenantBilling.billingDetails: { tenantEditable: ['invoiceEmail'] }`. Left
out, the tenant changes every one, as before. `PATCH /billing/details` refuses
a change naming another with `SUBSCRIBER_DETAIL_CHANGED_ELSEWHERE`, by name and
writing nothing of it, and a name that is not a contact detail stops the start.
What the application writes through `SubscriberService.changeContactOfTenant`
is not limited (`SC-SUB-047`, which supersedes `SC-SUB-018`). The two billing
details routes are now served wherever tenant billing is on, with a payment
gateway or without one. See "An application decides which billing details its
tenants change" in `docs/guides/upgrade-to-1.0.md`.

Each line of a subscriber's address is now held to one bound wherever it
arrives — sign-up, a subscriber an application creates, a change of the
contact details, the operator's correction of an invoice — and the platform
refuses a longer one itself with `SUBSCRIBER_DETAIL_INVALID`, naming the field,
whether or not the application installs a `ValidationPipe` (`SC-SUB-049`). So
`PATCH /billing/details` behind a pipe refuses a detail kept elsewhere by its
name whatever its value, instead of with a `400`. **Breaking** for code that
passes a longer line through `SubscriberService` or a checkout offer, and for
the operator's correction, which took 300 characters for every detail and now
does so for the legal name and the tax identifiers only. See "A line of the
address holds one bound, wherever it arrives" in the same guide.

- `@saasicat/core`: `SUBSCRIBER_CONTACT_FIELDS`, `SubscriberContactField` and
  the code `SUBSCRIBER_DETAIL_CHANGED_ELSEWHERE` with its German and English
  texts; `SUBSCRIBER_ADDRESS_MAX_LENGTHS`, `SubscriberAddressLineField` and
  `invoiceCorrectionMaxLengthOf`.
- `@saasicat/nest`: `TenantBillingDetailsOptions`; `GET` and
  `PATCH /billing/details` answer `tenantEditable`;
  `changeContactOfTenant` takes `options.changeable`. `ChangeBillingDetailsDto`
  declares every field without judging it; the sign-up and correction DTOs
  declare the bounds of `SUBSCRIBER_ADDRESS_MAX_LENGTHS`.
- `@saasicat/ui-vue`: `TenantBillingContactField` is an alias of
  `SubscriberContactField`. **Breaking** for code that builds the answer:
  `TenantBillingDetailsShape.tenantEditable` is required, and
  `useTenantBillingDetails` reports an answer without it as a failure to load.
  The invoice cancellation dialog stops each correction at its own bound.
- `@saasicat/ui-vue-tenant`: `TenantBillingSection` shows the details the
  application keeps as text, followed by `billingDetailsChangedElsewhere` from
  its `i18n` or the `changed-elsewhere` slot, for a link to that page.
