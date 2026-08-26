---
'@saasicat/adapter-drizzle': minor
---

Drizzle learns about bundles

`@saasicat/adapter-drizzle` had no bundle persistence at all — not three missing
columns, but zero bundle tables and zero bundle repositories. A consumer on
Drizzle could not sell an add-on, and the persistence contract skipped both
bundle scenarios by capability rather than failing them, so the gap was visible
but never closed.

Both halves are now implemented. `DrizzleBundleRepository` is the catalogue —
what may be sold, in which versions, and from when — with the same opt-in
validity windows `adapter-prisma` has: with them on, publishing closes the
predecessor's window the day before the successor opens, and
`findActiveBundleVersion` answers which version is bookable at a moment; with
them off the method is not offered rather than answering from columns the
adapter does not maintain. `DrizzleSubscriptionBundleRepository` is the booking
junction, carrying the rhythm and the window a bundle is billed for.

Both are registered in the persistence bundle, and the two contract scenarios
that used to skip now run against real PostgreSQL for this adapter as well.
