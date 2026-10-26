---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

The administration lists what subscribers still owe and are still owed

A new standard page, `openItems`, lists every invoice that still owes something
— its gross less what is settled against it, a cancelled invoice and a
cancellation invoice never among them — whichever tenant it was for, the oldest
due date first, fifty to a page, each with the days it is overdue in the
installation's time zone, how it is paid and how its latest collection attempt
ended, narrowed to the overdue ones on request; the credits the operator still
owes, the oldest first, each paid out from its row with the second factor as
from the subscriber's record; and per currency what is owed, of it what is
overdue, and what the credits hold.

`GET admin/open-items`, `GET admin/open-credits` and `GET admin/open-item-totals`
are new, under `payments.read`. Nothing is stored for them and nothing is
migrated: what is owed and what is open are read in SQL by the same signed sums
`owedByInvoice` and `openOfCredit` compute, the signs passed from
`@saasicat/core`, and the persistence contract checks after every scenario that
the lists agree with that rule. `SubscriberPaymentRepository` gains
`listOpenInvoices`, `listOpenCredits` and `openItemTotals`,
`SubscriptionInvoiceRepository` and `SubscriberRepository` gain `findByIds`, and
`InvoiceCollectionRepository` gains `listByInvoices`, in both adapters; a
repository of your own adds them.
