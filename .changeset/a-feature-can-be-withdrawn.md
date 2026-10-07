---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

Let an operator withdraw a feature from everybody who holds it

When a reason outside the platform takes a feature away — a service it depends
on stops, a law ends it — the operator withdraws it from a date, on the new
administration page "Withdrawn features": the reason the subscribers read, the
date, and a net reduction per plan and add-on in each rhythm, read against a
preview of every subscription it reaches, behind the second factor. From the
date the platform grants the feature to nobody, whatever grants it
(`SC-ENTL-025`); everybody who holds it, or will through a change already
scheduled, is told at once (`SC-SUB-042`, `SC-SUB-043`), pays less for the time
without it, written into the contract as a generated discount
(`SC-PRIC-072`), and may end the subscription — or the add-on that
grants it — at once while it is missing, with the unused rest credited to the
account (`SC-CANC-024`, `SC-BUN-062`, `SC-PRIC-074`). Lifting the withdrawal
grants the feature again and takes back what was reduced for days it was there
(`SC-PRIC-073`). Wherever a plan or an add-on is shown with what it includes, a
withdrawn feature is marked with its reason and date (`SC-CAT-017`).

To adopt it, run `sql/1.0-a-feature-is-withdrawn.postgres.sql`, adopt
`prisma-fragments/20-feature-withdrawal.prisma`, and handle the notice kinds
`feature-withdrawn`, `feature-withdrawal-lifted` and `ended-at-once` in your
`SubscriptionNoticePort`. The action is offered only where every subscription it
reaches can be found: a `SubscriptionUsagePort` of your own needs
`listBoundToVersion` and `listByIds`, a `SubscriptionBundleRepository` of your
own `listOfVersion`, and the plan repository `listVersions`. AutohausPro and
VereinsFux keep their own usage port without the first two and get the action
once they add them. Ending at once what is already cancelled for a later date
needs the new optional `endNow` on a `TenantSubscriptionWritePort` and a
`SubscriptionBundleRepository` of your own; without it that end is refused with
`FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED`.

The journal gains the origin `reductionTakenBack`, and credits now arise from
an end at once: `SC-PRIC-075` supersedes `SC-PRIC-003`, `SC-ENTL-026`
supersedes `SC-ENTL-021`, and `SC-BUN-063` to `SC-BUN-065` supersede
`SC-BUN-009`, `SC-BUN-015` and `SC-BUN-016`. `OnboardingConfigurator` and
`MySubscriptionBundlesPage` take the feature registry as `featureRegistry` to
mark withdrawn features. The steps are in the upgrade guide.
