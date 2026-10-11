---
'@saasicat/nest': patch
---

A failure is recorded in the audit log once, even where a write failed or two
runs met

The quarter-hourly runs that move subscriptions and add-on bookings at a
retirement's date, and the one that makes an add-on switch taken for the end
of a term, record each failure in the audit log once per process. A failure
was marked recorded before the write, so a write that failed once was never
tried again until the next restart, and the operator never saw the failure. It
is now reserved before the write and released where the write fails: the next
run records it, and two runs at the same moment — an application's own
scheduler can start them — write it once between them. The invoice run records
the invoices it holds back the same way.
