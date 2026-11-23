---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
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
does so for the legal name only. See "A line of the
address holds one bound, wherever it arrives" in the same guide.

The legal name, the tax identifiers and the country now hold one bound and one
form wherever they arrive, behind a pipe or without one (`SC-SUB-050`): the
legal name at most 300 characters, the VAT number and the tax number at most
30 each — the VAT number measured as written, before its separators are
dropped — and the country upper-cased to its two letters. They hold at sign-up,
in `createForTenant`, in a checkout offer's `newSubscriber`, in
`correctIdentity` and in the operator's correction of an invoice; the platform
refuses a value out of its bound or form with `SUBSCRIBER_DETAIL_INVALID`,
naming the field. A sign-up's tenant name holds 2 to 120 characters once
trimmed, judged where the sign-up starts. A cancellation's reason and the
address it is delivered to are judged by the cancellation alone
(`SC-ADM-059`). **Breaking** for code that passes a longer legal name or tax
identifier, for the operator's correction of an invoice, which took 300
characters for a tax identifier and now takes 30, and behind a pipe, where a
`400` becomes a `422`: step 4 for a tax identifier over its bound or a country
that is no code, `POST /auth/register/start` for a tenant name out of its
bounds, and a cancellation for a reason or an address that does not hold.
Step 4 now takes `de` as `DE`. See "The legal name, the tax identifiers and the
country hold one bound and one form" in the same guide.

- `@saasicat/core`: `SUBSCRIBER_CONTACT_FIELDS`, `SubscriberContactField` and
  the code `SUBSCRIBER_DETAIL_CHANGED_ELSEWHERE` with its German and English
  texts; `SUBSCRIBER_ADDRESS_MAX_LENGTHS`, `SubscriberAddressLineField`,
  `invoiceCorrectionMaxLengthOf`, `SUBSCRIBER_INVOICE_EMAIL_MAX_LENGTH` and
  `subscriberContactMaxLengthOf`, the `maxlength` of a contact detail's input;
  `SUBSCRIBER_LEGAL_NAME_MAX_LENGTH`, `SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH`,
  `subscriberIdentityMaxLengthOf`, `REGISTRATION_TENANT_NAME_MIN_LENGTH` and
  `REGISTRATION_TENANT_NAME_MAX_LENGTH`. `invoiceCorrectionMaxLengthOf`
  answers each detail's own bound, the country's two letters included.
  **Breaking**: `INVOICE_CORRECTION_MAX_LENGTH` is gone; the legal name's bound
  is `SUBSCRIBER_LEGAL_NAME_MAX_LENGTH`.
- `@saasicat/nest`: `TenantBillingDetailsOptions`; `GET` and
  `PATCH /billing/details` answer `tenantEditable`;
  `changeContactOfTenant` takes `options.changeable`. `ChangeBillingDetailsDto`
  declares every field without judging it; the sign-up DTO no longer measures
  a line of the address, nor the correction DTO any detail. Behind a pipe,
  step 4 and the correction answer one over its bound with
  `422 SUBSCRIBER_DETAIL_INVALID`, not `400`. The platform counts it once
  trimmed, in UTF-16 code units, as an input's `maxlength` does. The sign-up
  DTOs no longer measure the tenant name, the tax identifiers or the country,
  and `CancelInvoiceDto` declares `reason` and `deliverTo` without judging
  them.
- `@saasicat/spec`: the admin API schema names the bound each detail of an
  invoice's correction and of a correction of the legal identity holds, and
  says that a cancellation's reason and address are refused with `422`.
- `@saasicat/ui-vue`: `TenantBillingContactField` is an alias of
  `SubscriberContactField`. **Breaking** for code that builds the answer:
  `TenantBillingDetailsShape.tenantEditable` is required, and
  `useTenantBillingDetails` reports an answer without it as a failure to load.
  The invoice cancellation dialog stops each correction at its own bound, the
  identity dialog the legal name and the tax identifiers at theirs, and the
  pilot dialog the name and the VAT number at the legal name's and a tax
  identifier's.
- `@saasicat/ui-vue-tenant`: `TenantBillingSection` shows the details the
  application keeps as text, followed by `billingDetailsChangedElsewhere` from
  its `i18n` or the `changed-elsewhere` slot, for a link to that page, and
  stops each detail it takes where the server would refuse it.
