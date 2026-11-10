---
'@saasicat/core': minor
'@saasicat/nest': minor
---

An application ends a trial that ran out unbought

`TrialEndService.endRanOut(tenantId, actor)` ends a trial whose end has
passed, once the application has decided it does not convert: its
cancellation lands at the moment the trial ran out, the entitlements, the
contract and the audit log hear of it as of a cancellation, and its end is
recorded at once with the deletion day. It refuses a trial whose end has not
passed and a subscription that is no trial with `TRIAL_NOT_RUN_OUT`, and
answers the same end when called again.
