---
'@saasicat/nest': patch
---

A published version names the operator who published it

Publishing a plan or add-on version now records the operator's user id as
`publishedByUserId` on the version, and starting a draft records its author as
`createdByUserId`; both columns were always written empty. The audit log gains
an entry for each publish (`PLAN_VERSION_PUBLISH`, and the new
`BUNDLE_VERSION_PUBLISH`) and for ending a plan version
(`PLAN_VERSION_TERMINATE`), carrying the version, its dates and the overrides
the operator confirmed. A refused publish or end writes nothing.

The user id comes from the same helper the catalogue's other audit entries
use, so the publisher and the audit entry name the operator the same way.
Nothing changes for an application to wire.
