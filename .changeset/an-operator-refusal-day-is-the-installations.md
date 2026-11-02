---
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

An operator reads a refusal's days in the installation's zone and format

Two refusals named a day as a raw ISO timestamp.
`SUBSCRIBER_RECONCILIATION_CASE_CLOSED`, which the reconciliation page shows
when a case was closed in the meantime, named the moment it was closed; it now
names the day it was closed on in the installation's zone
(`config/saas.yaml#timeZone`, UTC where it names none).
`PLAN_TERMINATE_DATE_NOT_FUTURE` named the end it refused as
`2026-11-02T23:59:59.000Z`; its `endsAt` now names the day the operator
picked, while the English `message` keeps the moment refused. The shipped plan
page answers that code with a sentence of its own, so the day reaches a page of
yours that words it from the catalogue. Both say which of
their values are days in `dayParams` (`SC-ADM-048`).

The administration writes every day a refusal names that way with the day
formatter it writes every other day with: `adminErrorMessage(err, messages,
intlLocale)` takes the interface's locale as a new, required third argument,
and `useAdminErrorText()` gives a page or a composable the function with the
catalogue and the locale bound — the shipped pages and composables use it. The
two feature withdrawal refusals the operator reads, which name their days in
`dayParams` as well, are written the same way.
