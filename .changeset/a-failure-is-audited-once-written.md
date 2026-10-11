---
'@saasicat/nest': patch
---

A failure the audit log could not take is recorded by the next run

The quarter-hourly runs that move subscriptions and add-on bookings at a
retirement's date, and the one that makes an add-on switch taken for the end
of a term, record each failure in the audit log once per process. A failure
was marked recorded before the write, so a write that failed once was never
tried again until the next restart, and the operator never saw the failure.
It is now marked once written, as the invoice run's holds are.
