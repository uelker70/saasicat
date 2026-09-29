---
'@saasicat/core': major
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/cli': minor
---

Wire a schema that leaves canonical models out, without a cast and without a
failure at the first request

An application that keeps its SuperAdmins in its own user table leaves the
SuperAdmin fragment out, as the fragment itself recommends, and its client
then has no `superAdminUser` or `superAdminMfa`. Six Prisma adapters that
never touch those tables still demanded the whole client type, so wiring one
needed `as unknown as PrismaLike`. They now ask only for the delegates they
use: the subscription contract repository, the four promo code repositories
and the promo subscription lookup.

`prismaPersistence()` and `drizzlePersistence()` built every member whatever
the schema held, so a schema without `promo_code_holds` failed in the middle
of a redemption. Both now take `notAdopted`, in the model names
`saasicat schema check` prints under "Not adopted" — which now hands over the
list for the models the bundle can leave out — and leave out the members that
need them.
A ready Prisma client passed to `prismaPersistence()` needs no delegate of a
model named there.

- `OPTIONAL_CANONICAL_MODELS` and `membersLeftOut` are new in
  `@saasicat/core`. A name the bundle cannot do without is refused with the
  ones it can.
- `SaaSiCatPersistenceCore.mfa` is optional: a bundle for a schema without
  `SuperAdminMfa` has none, and a start without an `MfaPort` of your own in
  `adapters` is refused.
- `passwordHasher` together with `notAdopted: ['SuperAdminUser']` is refused,
  since the hasher provisions into that table.
- `RegistrationModule` does not start beside checkout offers and promo
  codes without a `PromoCodeHoldRepository`, and says what to wire: a sign-up
  that names an offer holds its code from step 4 on, and an operator can put
  a code on an offer at any time. This stops an installation that starts
  today: one that wires `PromoCodesModule` by hand without `holdRepository`
  beside checkout offers and self-registration, and until now failed only at
  the first checkout of an offer carrying a code. Pass `holdRepository`, or
  drop `'PromoCodeHold'` from `notAdopted`, before you upgrade.
