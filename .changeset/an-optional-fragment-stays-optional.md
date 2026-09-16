---
'@saasicat/cli': patch
---

`saasicat schema check` no longer makes an optional fragment compulsory

A relation field whose type names a model the consumer did not adopt was
reported as a missing field — `Subscriber.paymentMethods` pointing at
`SubscriberPaymentMethod`, in the same run that listed `SubscriberPaymentMethod`
under "Not adopted — not an error". Prisma cannot express a relation to a model
that is not there, so the only way to satisfy the missing field was to adopt the
fragment the run called optional. `Subscriber.contracts` from
`08-subscription-contract.prisma` had it too.

A spec field whose type is a model or an enum the consumer does not have now
belongs to that decision and is not drift. The exemption is bounded by what the
fragments declare: a field naming something the consumer owns and has not
written is still reported, and the field is required again the moment its model
is adopted — which is also when Prisma starts requiring it.

Adopting every fragment except `14-payments.prisma` reports three models as not
adopted and exits 0.
