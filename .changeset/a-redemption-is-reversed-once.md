---
'@saasicat/core': major
'@saasicat/nest': patch
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
---

Reverse any redemption not reversed yet, and give its slot back once

`PromoCodesService.reverse` reversed a redemption only while its status read
`ACTIVE`, so for one whose term had ended the answer depended on whether the
nightly sweep had marked it `EXPIRED` yet: before the sweep its slot came back,
after it not. And two reversals at the same moment both gave the slot back.

- `reverse` rolls back any redemption not reversed yet, an expired one
  included, and gives its slot to the code again (`SC-PROMO-001`). It is what
  a withdrawal or a rollback calls; an ordinary end never calls it.
- `PromoCodeRedemptionRepository.setReversed` claims: it reverses the
  redemption only while it is not reversed, in one conditional statement, and
  answers `null` where it already was. Only the reversal that wins gives the
  slot back. Both shipped adapters do; a repository of your own does the same,
  and the persistence contract runs two reversals at once against it.
