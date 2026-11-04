---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

Every user of a tenant sees what a change would cost

A plan change's preview (`POST /billing/plan/preview`) and an end at once's
(`GET /billing/feature-withdrawals/:id/end` and
`…/bookings/:subscriptionBundleId/end`) are open to every signed-in user of the
tenant, as the plan, the usage and an add-on's preview already are
(`SC-ADM-026`). Making the change still needs the tenant's administrator, and
is refused `403` with `TENANT_ADMIN_REQUIRED` otherwise.

The previews say which of the two their reader is, by the rule that refusal is
made by: `mayChange` on a plan change's and on an add-on's
(`POST /billing/subscription-bundles/preview`, booking and cancelling alike),
`mayEnd` on an end at once's. `PlanChangeWizard` stops at the preview where
`mayChange` is `false` and says that the account's administration makes the
change, rather than leading on to a refusal; the dialog of an end at once does
the same where `mayEnd` is `false`, and the add-on dialog where its preview's
`mayChange` is. Where a server sends neither field, all three go on as before.
The sentences are the catalogue keys `wizardChangedByAdministration`,
`endAtOnceByAdministration` and `bundlePreviewByAdministration`.

The changes that have no preview — cancelling the subscription, reinstating an
add-on, taking a newer version of the plan or of an add-on, and switching away
from a retired one — are no longer offered to a user who may not make them.
`GET /billing/usage` answers `mayChange` for them, and `TenantPlanSection` and
`MySubscriptionBundlesPage` say once instead that the account's administration
makes changes to the subscription (`subscriptionChangesByAdministration`).
`useTenantSubscriptionBundles` gains `mayChange` and `readMayChange()`, which
`MySubscriptionBundlesPage` calls once when it mounts.

`SC-ADM-013` is withdrawn: `SC-ADM-026` covers its ground, the billing
permission with it.
