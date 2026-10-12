---
'@saasicat/core': minor
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': patch
---

A deleted promo code is changed and deleted no further

`PromoCodesService.update` changed a code the operator had deleted, and
`softDelete` deleted it again, moving the day it was deleted; a code that never
existed failed in the store rather than as a missing code. Both now answer
`404 PROMO_CODE_NOT_FOUND` for a deleted or unknown code, as `findOne` already
did (`SC-PROMO-032`) — also where the code is deleted between the platform's
read and its write. For that, `PromoCodeRepository.update` answers `null` and
`softDelete` answers `false` where no live code is under the id, and both
shipped adapters write only to a code that is not deleted. A `softDelete` of
your own that answers nothing no longer compiles; the persistence contract
checks the rest.
