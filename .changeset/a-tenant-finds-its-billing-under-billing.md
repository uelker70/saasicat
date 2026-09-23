---
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant finds its billing under billing

The payment method sat at the foot of the plan page, where a tenant looking for
its billing under billing did not find it. `TenantBillingSection` in
`@saasicat/ui-vue-tenant` holds the payment method and the billing details in
one section an application mounts where it keeps billing (`SC-UI-025`); the
invoices and the account arrive in it later, with nothing to change for a page
that mounts it now.

- `GET` and `PATCH /billing/details`, mounted with the tenant's payment method
  routes behind the same guards and the billing permission. A tenant changes
  the address and the invoice email; the street, postal code, city, country and
  invoice email can be replaced but not cleared (`SC-SUB-018`), and the legal
  name and tax identifiers are refused by name — the operator corrects them.
  `SubscriberService.changeContactOfTenant` is the rule behind the route.
- `useTenantBillingDetails` in `@saasicat/ui-vue` reads and changes them, and
  hides itself on a 403 or 404 as the payment method does.
- `TenantPlanSection` takes `showPaymentMethod` (default `true`); set it to
  `false` where `TenantBillingSection` is mounted, so the payment method is in
  one place.
- `TenantPaymentMethodCard` moved to the top level:
  `@saasicat/ui-vue-tenant/TenantPaymentMethodCard.vue`. Its old path under
  `tenant-plan-section/` is gone. It styles its own text now instead of
  borrowing the plan section's, so it reads right wherever it is mounted.
- `TenantPlanSectionI18n` gains the `billingDetails*` texts, in English and
  German.
