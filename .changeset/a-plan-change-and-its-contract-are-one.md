---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

A plan change is refused where its contract cannot be written

A plan change wrote the subscription and only logged a contract that failed,
so the tenant was charged under the contract of the plan it had left. The
platform now asks the contract first, and a change whose contract would be
refused is refused with that reason and writes nothing (`SC-CHG-025`). Where
the store fails afterwards, a change made at once or a switch to a newer
version is put back as it was read and refused with
`503 PLAN_CHANGE_CONTRACT_NOT_WRITTEN`; a scheduled change stays due, is tried
again by every run and is audited as `SCHEDULED_PLAN_CHANGE_FAILED`
(`SC-CHG-026`); an activation in onboarding stands (`SC-CHG-027`). The journal
charges no plan period while the contract in force names another version than
the one bound, and writes that contract itself (`SC-PRIC-105`). See "A plan
change is refused where its contract cannot be written" in
`docs/guides/upgrade-to-1.0.md`.

- **Breaking:** `ContractFreezePort` gains `assertContractFor`; a port of your
  own, or a stand-in typed as one, implements it.
- **Breaking:** `POST billing/plan`, `billing/plan/preview` and
  `billing/onboarding/initial-subscription` take `billingCycle` as `MONTHLY`
  or `YEARLY` only, and refuse any other with 400.
- `@saasicat/core` adds the code with its German and English texts,
  `SubscriptionPutBack` and `columnsPutBack`, and
  `ImmediatePlanChangeInput.putsBack`, which both shipped adapters write. A
  `TenantSubscriptionWritePort` of your own writes it too; the persistence
  contract checks it.
- `@saasicat/nest`: `PendingPlanMaterializationService` takes
  `AdminAuditService` as an optional last argument, and
  `PlanChangePreviewService` gains `versionOnSaleOf`.
