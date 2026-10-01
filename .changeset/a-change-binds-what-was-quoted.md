---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': major
---

Bind a plan change to the version its preview showed, or to nothing

A plan change is previewed at one moment and submitted at another. When a
successor's start passed in between, the change bound the version then on sale
— at a price the customer was never shown. A change to another plan now names
the version its preview showed, and the platform reads the preview again when
it is submitted: it changes only while that version is still the one on sale,
and binds that version and no other (`SC-CHG-023`). A change scheduled for the
end of the term is held to the same.

- `POST billing/plan` takes `planVersionId`, the preview's
  `target.planVersionId`. Naming none where the preview names one is refused
  with 400 `PLAN_CHANGE_VERSION_NOT_NAMED`; naming a version no longer on sale
  is refused with 409 `PLAN_CHANGE_QUOTE_CHANGED`, which carries the current
  `preview`. A change that keeps the plan, and one where nothing reads
  versions, names none.
- `@saasicat/core` adds both codes with their messages.
- `@saasicat/ui-vue`: `useTenantBilling().changePlan` takes the version as its
  third argument, and `PlanChangePreviewShape.target` carries `planVersionId`.
- `@saasicat/ui-vue-tenant`: `PlanChangeWizard` sends the version of the
  preview on screen, shows the preview a refusal carries, and words a refused
  change in the reader's language; its `changePlan` prop takes the version as
  its third argument.
