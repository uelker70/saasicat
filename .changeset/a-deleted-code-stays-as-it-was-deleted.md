---
'@saasicat/nest': patch
---

A deleted promo code is changed and deleted no further

`PromoCodesService.update` changed a code the operator had deleted, and
`softDelete` deleted it again, moving the day it was deleted; a code that never
existed failed in the store rather than as a missing code. Both now answer
`404 PROMO_CODE_NOT_FOUND` for a deleted or unknown code, as `findOne` already
did (`SC-PROMO-032`).
