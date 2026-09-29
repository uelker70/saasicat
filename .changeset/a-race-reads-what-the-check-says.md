---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

Answer a request that loses a race the way the check answers it, not with a 500

The platform checks before it writes, and where two requests pass that check
together — two operators creating one key, a double click asking for a second
draft, a cancellation arriving after another — the store decides. Both
adapters then threw a plain `Error` or let the database's unique violation
through, and the loser read a 500 that looked like a crash in the log. It now
reads the status, code and parameters the check gives a request arriving a
moment later.

- `@saasicat/core` builds the refusals: `planKeyTaken`, `bundleKeyTaken`,
  `marketingProjectionTaken`, `catalogDraftExists`, `subscriptionBundleGone`,
  `subscriptionBundleAlreadyCancelled`, `subscriptionGone`,
  `subscriptionChanged`, `noPendingPlanVersion`, `noActivePlanVersion` and
  `planNotInCatalog`, each worded by the shipped English catalogue.
- Both adapters create catalogue keys, drafts and marketing projections with
  `ON CONFLICT DO NOTHING`, so a refused create leaves a caller's transaction
  usable. `PrismaModelDelegateLike` declares `createManyAndReturn`, which
  Prisma has had since 5.14. A conflict on a unique index of your own is not
  reported as a key taken: Drizzle aims the conflict at the key, and Prisma,
  which cannot, looks the key up and otherwise fails with an error of its own.
- The Prisma and Drizzle subscription writes refuse a missing subscription, a
  pending version cleared or replaced meanwhile and a plan with no version in
  effect by code; a booking cancellation tells a booking that is gone from one
  cancelled first. The three configuration checks the Prisma write makes when
  it is constructed stay plain errors.
- Onboarding answers a refusal of the store the same way on both of its
  paths; the atomic one reported it as `ONBOARDING_CREATE_FAILED` before.
- `FakePlanRepository`, `FakeBundleRepository`,
  `FakeMarketingProjectionRepository` and `FakeSubscriptionBundleRepository`
  from `@saasicat/nest/testing` refuse the same way, and the plan fake refuses
  a second draft as the stores do.
- The persistence contract checks these refusals by code: a taken plan or
  bundle key, a second plan or bundle draft — also two asked for at once — a
  booking that is not there or already cancelled, a plan change for a tenant
  without a subscription or to a plan with no version in effect, and accepting
  where nothing is pending. A store of your own throws `PersistenceRefusal`
  for these, built with the functions above.
