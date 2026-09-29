---
'@saasicat/core': minor
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

Publish a draft once, and tell the second publisher so by code

Two operators, or one double click, could publish the same plan draft with
`@saasicat/adapter-prisma`: both requests passed the check, and the second
overwrote when, by whom and from when the version was published, and closed its
predecessor a second time. The same held for add-on drafts outside validity
mode, where the two writes did not even share a transaction. Discarding a plan
draft that was published in between reported success. Both adapters now claim
the draft while it still is one, close the predecessor in the same
transaction, and refuse otherwise.

The refusal reaches the operator as the platform's own check would answer:
`422 PLAN_VERSION_ALREADY_PUBLISHED` or `BUNDLE_VERSION_ALREADY_PUBLISHED`, and
`404` for a version that is gone — not a 500. The English and German texts of
the two `…_ALREADY_PUBLISHED` codes no longer say "cannot be discarded" to
somebody who was publishing: they say the version is neither published again
nor discarded.

- `PersistenceRefusal` is new in `@saasicat/core`: an error an adapter throws
  when a row is no longer what its caller read, carrying the platform's code.
  `catalogVersionGone` and `catalogVersionAlreadyPublished` build the two
  catalogue cases, with the parameters each code's message interpolates.
- `FakePlanRepository` and `FakeBundleRepository` from `@saasicat/nest/testing`
  refuse the same way: a version published once is not published again, and
  the refusal carries the code. A test of yours that published one draft twice
  through them now sees the refusal.
- The persistence contract publishes a plan draft twice, one after the other
  and at the same moment, discards one published meanwhile, and publishes a
  version that is not there. A plan repository of your own throws
  `PersistenceRefusal` for these, or its harness declares the new gaps
  `planDraftPublish` and `planDraftDiscard`.
