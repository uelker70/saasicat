---
'@saasicat/core': minor
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

A deleted promo code keeps its name, and a taken name answers 400

Creating a code under the name of a deleted one passed the platform's
duplicate check, because `findByCode` hid deleted codes, and then ran into the
unique index: a 500 where the platform meant to say the code exists. The name
stays taken now, since contracts, offers and redemptions name a code by its
text; `findByCode` returns deleted codes too, and every caller that redeems or
previews already checks `deletedAt`. Two creates of one name that race past the
check are answered the same way: the adapters insert with
`ON CONFLICT DO NOTHING` and refuse with `promoCodeTaken`, and the service
turns that into `400 PROMO_CODE_ALREADY_EXISTS`.

The message for `PROMO_CODE_ALREADY_EXISTS` now says that a deleted code may
carry the name, since the admin list does not show deleted codes, and the
refusal from the duplicate check carries `params.deleted` so an interface can
tell the two cases apart.

The nightly expiry no longer writes to deleted codes.

- `promoCodeTaken` is new in `@saasicat/core`.
- A promo code repository of your own returns deleted codes from `findByCode`,
  refuses a taken name with `promoCodeTaken`, and leaves deleted codes out of
  `expireDueCodes`; the persistence contract checks all three.
