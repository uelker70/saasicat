---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

A retirement counts from the notice that reached the subscriber

A retirement's date, its notice-free cancellation, its reminder and its move
now count from its notice reaching at least one administrator of the tenant,
not from the moment it was recorded (`SC-SUB-035`, `SC-SUB-036`). A notice the
announcement sends at once changes nothing. Where sending failed:

- **Nothing happens before it arrives.** No move, no reminder, no switch
  offered and nothing shown beside the plan, and the charge journal prices the
  periods from the version the subscription is on.
- **A notice sent late names a later date:** the first end of a term at least
  three calendar months after its sending, and its last day to cancel with it.
- **Told to nobody is not told.** For a retirement notice, a
  `SubscriptionNoticePort` answer with no recipients counts as not sent: the
  run tries again every quarter of an hour and says so in the log once a day.
  Offer notices keep their rule: nobody, and done.
- **A subscription that left the version** before its notice could go out is
  not sent one.
- **A replacement cannot end** while a notice onto it has not arrived:
  `PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED`, with the count.
- **The plan cockpit** counts the subscriptions not told yet beside the retired
  version and marks them for a look, as it does a move overdue:
  `RetirementProgress.notTold`, the wording key
  `common.retirementProgress.notTold`, and the progress chip's modifier class
  `sa-retirement-progress--attention`.
