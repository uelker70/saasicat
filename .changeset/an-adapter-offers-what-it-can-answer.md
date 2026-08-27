---
'@saasicat/adapter-prisma': patch
---

An adapter offers only what it can answer

`PrismaPlanRepository` declared `findActivePlanVersion` and `terminate`
unconditionally and threw inside them when the schema could not support them.
Both are optional in the port, and every caller guards the way an optional
member invites — `findActivePlanVersion?.(…) ?? findLatestLivePlanVersion?.(…)`
in three services, `typeof this.repo.terminate !== 'function'` in
`PlanVersionsService`. Those guards test whether a member is **there**, not
whether it is willing, so all of them passed and the throw escaped.

For a consumer whose schema predates the validity-window columns that meant
HTTP 500 on the tenant bundle preview, the checkout offer and the public
marketing catalogue, instead of the newest-live fallback the error message
itself recommended — and a raw 500 on plan-version termination where the
service had `PLAN_TERMINATE_NOT_IMPLEMENTED` ready.

Both are now assigned in the constructor only when the schema carries the
columns, which is what `PrismaBundleRepository.findActiveBundleVersion` has
always done. No consumer on the current schema is affected.
