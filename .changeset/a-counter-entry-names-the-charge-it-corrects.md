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
charge stood on and the reason (`SubscriberChargeRecord.correction`), and moves
that charge towards nothing; `counterEntryOf` in `@saasicat/core` writes one. A
correction of nothing, or with a blank reason, is refused where it is written,
where it is read, by the database and by the JSON schema; one that is not what
`counterEntryOf` makes of the charge it names — another account, subscription,
contract line, period or currency, a correction corrected, the charge moved away
from nothing or past it — is refused by both adapters
(`assertCorrectionsFitTheirCharges`). Only the cancellation of that invoice
writes a correction and only its replacement invoices it, so
`listSubscriptionsWithUninvoicedCharges` and `listUninvoicedCharges` leave
corrections out in both adapters.

Fragment 15 gains `correctsChargeId`, `correctedInvoiceId` and
`correctionReason`; `1.0-the-journal-names-what-a-correction-corrects.postgres.sql`
adds them with their index, foreign key and the check
`subscriber_ledger_entries_correction_names_its_charge`, which
`constraints.postgres.sql` carries as well. The persistence contract holds both
adapters to it.
