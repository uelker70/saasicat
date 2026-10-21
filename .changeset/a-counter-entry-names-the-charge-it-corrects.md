---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': patch
---

A correction in the charge journal names the charge it corrects

A charge of origin `correction` names the charge it corrects, the invoice that
charge stood on and the reason (`SubscriberChargeRecord.correction`), and takes
the amount off; `counterEntryOf` in `@saasicat/core` writes one. A correction
that takes nothing off, adds, or gives a blank reason is refused where it is
written, where it is read, by the database and by the JSON schema. Only the
cancellation of that invoice writes a correction and only its replacement
invoices it, so `listSubscriptionsWithUninvoicedCharges` and
`listUninvoicedCharges` leave corrections out in both adapters.

Fragment 15 gains `correctsChargeId`, `correctedInvoiceId` and
`correctionReason`; `1.0-the-journal-names-what-a-correction-corrects.postgres.sql`
adds them with their index, foreign key and the check
`subscriber_ledger_entries_correction_names_its_charge`, which
`constraints.postgres.sql` carries as well. The persistence contract holds both
adapters to it.
