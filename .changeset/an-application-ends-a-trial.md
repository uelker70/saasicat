---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

An application ends a trial that ran out unbought

`TrialEndService.endRanOut(tenantId, actor)` ends a trial whose end has
passed, once the application has decided it does not convert: its
cancellation lands at the moment the trial ran out, the entitlements, the
contract and the audit log hear of it as of a cancellation, and its end is
recorded at once with the deletion day. It refuses with `TRIAL_NOT_RUN_OUT`
where there is no trial that ran out unbought to end — one still running,
converted, never a trial, or ended another way, such as one its tenant
cancelled after it ran out — and the quarter-hourly run records any end that
landed, so a caller does not retry. Called again, it answers the same end.

The trial is ended through `TenantSubscriptionWritePort.endTrial`, one
conditional write: a trial that converted, moved its end or was cancelled
since it was read is left as it is. Both shipped adapters have it; a write
port of your own adds it.
