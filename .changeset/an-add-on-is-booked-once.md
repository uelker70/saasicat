---
'@saasicat/core': patch
'@saasicat/nest': patch
'@saasicat/ui-vue-tenant': patch
---

Book an add-on once per subscription, and never one that has been deleted

A subscription holds an add-on once, whichever version each booking names, as
`SC-BUN-027` says. A tenant holding version 1 of an add-on could book version
2 beside it and pay twice for what the two have in common. The booking now
refuses that with `BUNDLE_ALREADY_SUBSCRIBED` until the first booking has
ended, and the booking preview says so first. The tenant's add-on store says
the add-on is booked instead of offering the newer version, and counts a
booking cancelled for a day still to come as running, as the server does. A
checkout offer refuses two versions of one add-on as a duplicate, when it is
made and when it is concluded.

A version of a deleted add-on can no longer be booked (`SC-BUN-036`). Deleting
an add-on leaves its versions' dates as they were, and only the tenant's price
read asked about the add-on itself. So a version still inside its window was
booked, previewed and put into checkout offers, although the catalogue no
longer showed it.

- `@saasicat/core`: a new code, `BUNDLE_DELETED`, with its text in English and
  German.
- `@saasicat/nest`: the booking and its preview refuse a deleted add-on's
  version with `BUNDLE_DELETED`. A checkout offer refuses it with
  `CHECKOUT_OFFER_BUNDLE_NOT_OFFERED` and the reason `bundle_deleted` when it
  is made, and with `CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE` when it is
  concluded.

Nothing changes for an application's own repositories. Bookings already
running are left as they are, and the booking reads the add-on through
`BundleRepository.findById`, which every repository already implements.

A test fake of `BundleRepository` does need to answer `findById` for the
add-on of every version it books. An answer of `null` reads as a deleted
add-on, a fake without the method fails, and `FakeBundleRepository` from
`@saasicat/nest/testing` answers only for add-ons given to `seedBundle`.
