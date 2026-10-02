---
'@saasicat/core': minor
'@saasicat/spec': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
'@saasicat/cli': minor
---

Let an operator retire a plan version for the subscriptions on it

A subscription keeps its version (`SC-SUB-024`). Retiring one is the orderly
way out: an operator names a replacement on sale, of the same plan or another,
and every subscription on the version is told that it continues on it at the
end of one of its terms at least three calendar months after its notice
reached an administrator (`SC-SUB-035`). Until then it may cancel without
notice (`SC-CANC-023`). A price increase is a
retirement whose replacement costs more.

- **`config/saas.yaml` needs `tenantBilling.orderlyRetirement.termsConfirmed`.**
  It is required, like the notice periods beside it, and a file without it no
  longer loads. `true` states that your terms carry the clause a retirement
  rests on; without it the administration does not offer the action and the
  server refuses it with `RETIREMENT_TERMS_NOT_CONFIRMED` (`SC-SUB-025`).
  The loader names the field it is missing; `saasicat init` writes `false`.
- Only a version no longer on sale can be retired, for a replacement priced in
  the rhythm each subscription is billed in by then; a retirement that reaches
  nobody is refused, and a subscription is reached at most once in twelve
  months (`SC-SUB-028`) and hears of a version's retirement once. The operator
  sees every subscription it reaches with its date, and every one it does not
  with the reason, before announcing; the announcement names them and is
  refused with `RETIREMENT_PREVIEW_CHANGED` where they changed meanwhile
  (`SC-SUB-026`).
- Routes: `GET` and `POST /admin/catalog/plan-versions/:id/retirement`, the
  second behind the second factor and audited as `PLAN_VERSION_RETIRE`, and
  `GET /admin/catalog/version-retirements`. The manifest carries
  `planVersions.retire` (`VERSION_RETIREMENT_CAPABILITY`) where they are
  served and the terms are confirmed.
- Each announcement is kept in the new `version_retirements` table, and each
  subscription it reaches gets a `version-retired` notice in the same
  transaction (`SC-SUB-029`). Adopt
  `prisma-fragments/18-version-retirement.prisma` and run
  `sql/1.0-a-retirement-is-announced.postgres.sql`; both bundles provide
  `tenantBilling.versionRetirements`, which
  `notAdopted: ['VersionRetirement']` leaves out. Confirmed terms with nowhere
  to keep an announcement refuse the start.
- `SubscriptionNotice` is `version-offered` or `version-retired`. A retirement
  notice carries both versions with their prices (`retired`, `replacement`,
  `changes`), the `billingCycle` it is billed in when the retirement takes
  effect, `effectiveAt` and `lastDayToCancel`. A `SubscriptionNoticePort`
  narrows on `kind`. A notice the port could not send, or the platform could
  not take on, is sent by the quarter-hourly run.
- `SubscriptionUsagePort.listBoundToVersion` is new and optional; both shipped
  adapters have it, and confirmed terms over a port without it refuse to
  start. A port of your own returns each subscription's
  `pendingChangeVersionId` (new, optional on `SubscriptionUsageRecord`) with
  it, or a subscriber who took a newer version's offer is reached as if they
  stayed.
  `SubscriptionNoticeRepository` gains `record`, `listOfKindSince` and
  `listUndelivered`. The persistence contract holds both; a harness gains the
  `versionRetirements` and `subscriptionUsage` members, or declares
  `gaps: ['versionRetirements', 'boundSubscriptions']`.
- `versionSale`, `versionOnSale` and `versionOnSaleOrNext` move to
  `@saasicat/core`, where the server decides by them; `@saasicat/ui-vue`
  re-exports them unchanged.
- `@saasicat/ui-vue`: the plan cockpit offers "Retire…" on a version no
  longer on sale, with a dialog that shows the replacement's prices, the
  dates, the subscriptions not reached and every blocker before anything is
  sent, and marks a retired version with its replacement. New:
  `useVersionRetirement`, the `versionRetirements` resource, and the catalogue
  keys `planDetail.versions.retire*`/`retired*` and `planDetail.retireDialog`.
  The tenant usage carries `retirement`.
- `@saasicat/ui-vue-tenant`: the plan section shows a retirement beside the
  plan — when the subscription continues on which version, at what price, and
  until when it may cancel without notice — and says the last again in the
  cancellation confirmation (`SC-SUB-030`). New wording keys
  `versionRetired*` and `cancelConfirmRetirement`.
