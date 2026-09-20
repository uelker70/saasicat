---
'@saasicat/core': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/nest': minor
---

Say whose payment method a gateway reference is

A payment method is kept under the gateway's reference, and that reference is
unique within the gateway account rather than per subscriber. One read could
not say whose it was: `findByReference` was given the account and the reference
alone, so on the gateway's callback — which arrives without a session, where an
installation lifts the policy that keeps its tenants apart — it answered with
whichever subscriber's row held the reference. That the case does not arise
today is a property of the provider, not a promise of this platform's;
`SC-SEC-014` is the promise it makes instead.

- Breaking: `SubscriberPaymentMethodRepository.findByReference` takes the new
  `SubscriberPaymentMethodReference`, which carries `subscriberId`,
  `gatewayAccount` and `paymentMethodRef` together, and answers `null`
  wherever that subscriber holds nothing under the reference — another
  subscriber's payment method included.
  One argument rather than a subscriber added in front of the two strings,
  because `TransactionContext` is `unknown` and accepts a string: the
  positional form let an implementation written against the older shape
  compile untouched and read the account out of the subscriber's place. An
  object fails that implementation at the type level, which is where this
  break belongs.
- `recordConfirmed` refuses a reference another subscriber holds, rather than
  answering `already-recorded` with that subscriber's payment method. The
  refusal is the new `ForeignPaymentMethodReferenceError` from
  `@saasicat/core`, with `isForeignPaymentMethodReferenceError` beside it; it
  carries the account and the reference and names no subscriber the caller is
  not acting for.
- Two subscribers can reach one reference at the same time, because the lock is
  on the subscriber — so reading is not enough to decide it. An implementation
  **claims the reference with its first write**, conflict-free on that key, and
  refuses when the claim takes no row. That is now part of the port's contract:
  because the claim comes first, a refusal leaves the caller's transaction as it
  found it.
- Where the store cannot say which key refused the claim — Prisma's
  `skipDuplicates` names no conflict target — the adapter reads the reference
  back before it attributes the refusal to a subscriber, and says plainly that
  some other unique key refused the row when none holds it. The canonical
  schema has no such key; a consumer's copy of the fragment may.
- A gateway callback refused that way is logged at error level, naming the
  account, the reference and the subject the event was about. It still rolls the
  transaction back, so nothing durable would otherwise say why: by then the
  handler has marked a setup complete, or activated a whole sign-up.
- Both shipped adapters put the subscriber into the statement rather than
  checking what came back, so a policy on the table and the query bound the
  read the same way. The persistence contract comes at the boundary from the
  wrong side — two subscribers, one reference — for the read and the write
  alike.
