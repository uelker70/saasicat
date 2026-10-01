---
'@saasicat/ui-vue': major
---

Show in the admin whether a version is on sale, by the rule a booking follows

The admin answered "which version is on sale" four ways, none of them the
platform's: plan detail and the matrix called a version live until a successor
was published, the plan list ignored `supersededAt` and `endsAt`, the add-on
pages dropped a last day at midnight, and the marketing page treated a version
without a start as never valid. Every admin surface that shows where a plan or
add-on version stands now asks `isVersionActiveAt` and says it the same way
(`SC-PLAN-028`): a draft, on sale from a day, on sale (until its last day where
one is known), or off sale since a day. "Live" reads "on sale" throughout, and
"superseded" is no longer a state. Days are shown in the reader's language.

- New in `@saasicat/ui-vue/client`: `versionSale`, `versionOnSale`,
  `versionOnSaleOrNext`, `describeVersionSale`, `formatDay` and
  `availableBundle`, and the catalogue group `common.versionSale`.
- The plan pages offer an add-on beside the plans at its version on sale,
  otherwise its next one, and no longer offer one with neither — its empty list
  of plans read as every plan, so the matrix showed it as bookable everywhere.
- `resolvePlans` takes `now` (a `Date`) instead of `today`, resolves `onSale`
  instead of `currentLive`, and `countPlans` answers `onSale` instead of
  `live`. `isCurrentlyValid`, `isFutureScheduled`, `isExpired` and
  `todayIsoDate` are removed.
- Catalogue keys a consumer may have overridden:
    - `plans.list.statLive` is `statOnSale`; `chipLive`, `chipScheduled`,
      `chipDraft` and `validFrom` are gone; `chipNoLive` is `chipNothingOnSale`.
    - `plans.matrix.chipLiveVersion` and `chipDraftVersion` are one
      `chipVersion`; `chipNoLive` is `chipNothingOnSale`.
    - `plans.publishDialog.supersededNoteLead` and `supersededNoteTail` are one
      `predecessorNote`.
    - `marketing.admin.noLiveVersion` is `noVersion`; `live` is gone.
    - `bundles.status` keeps tooltips under `draft`, `scheduled`, `onSale` and
      `offSale`, and a label only for `retired`; `bundles.filter.live` and
      `superseded` are `onSale` and `offSale`; `bundles.kpis.totalSub` takes
      `{onSale}`; `bundles.statusBanner` is reduced to the sentence tails.
