---
'@saasicat/core': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
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
  refusal is `refuseForeignPaymentMethodReference`, new in `@saasicat/core`, so
  every implementation gives it in the same words and names no subscriber the
  caller is not acting for.
- Both shipped adapters put the subscriber into the statement rather than
  checking what came back, so a policy on the table and the query bound the
  read the same way. The persistence contract comes at the boundary from the
  wrong side — two subscribers, one reference — for the read and the write
  alike.
