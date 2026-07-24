---
'@saasicat/adapter-prisma': minor
'@saasicat/nest': minor
'@saasicat/persistence-testing': minor
'@saasicat/spec': minor
'@saasicat/types': minor
---

Add explicit, backwards-compatible Prisma schema profiles for semantic
plan-key and normalized Plan UUID bindings, configurable catalog and
entitlement delegates, opt-in PlanVersion and BundleVersion validity windows,
and atomic tenant plan/PlanVersion writes including onboarding rollback.
Atomic onboarding is exposed only through an explicit schema opt-in; pending
PlanVersion acceptance now uses a compare-and-set guard, and active-version
selection consistently puts legacy null validity dates last.
Opt-in SubscriptionBundle booking counts let the shared subscription adapter
preserve BundleVersion editability without requiring the junction table.
Active subscription counts now derive their authoritative plan identity from
PlanVersion and Plan, stay scoped to the requested project, and ignore drifted
denormalized Subscription plan values. The configured
`tenantSubscription.delegate` is now honored by every subscription ORM
operation, including transactional reads; locked reads retain the canonical
physical `subscriptions` table contract.

Extend the executable persistence contract with semantic identity,
plan-binding, validity-window, auto-succession, and transactional promo
redemption rollback scenarios. Catalog lifecycle scenarios now take their
project identity from the required contract `projectKey` option.

Run the optional contract freeze after every successful onboarding plan
change, regardless of whether the adapter uses atomic onboarding or the
legacy sequential fallback.
