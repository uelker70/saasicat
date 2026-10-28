---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/cli': minor
'@saasicat/ui-vue': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

The invoice register is exported for a tax advisor, as of a moment

The invoices page gains an "Export" button, the platform
`GET admin/invoice-export`, and the command line `saasicat invoices export`:
the invoices of the months picked, at most twelve, as of a moment on the
installation's clock, with their lines, tax treatment and rate, and the
settlements recorded against each by then, each with the moment it was
recorded. The moment is at most five minutes before the request, and that
where none is given; a later one is refused with
`SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE`.

It is one ZIP: `invoices.csv`, `lines.csv`, `settlements.csv` in German or
English notation, `export.json` with the same rows, and last a manifest with
every file's size and SHA-256. `export.json` and the manifest follow
`invoice-export.schema.json`, which `@saasicat/spec` exports as
`invoiceExportSchema`. The files are stored and dated the moment the export is
as of, so the same months as of the same moment in the same language are the
same bytes. The audit log records each export with the operator, the months,
the moment and the archive's SHA-256 (`SUBSCRIPTION_INVOICES_EXPORTED`) before
it is handed over, and an export it cannot record is not handed over; the
command line never writes over a file already there.

Nothing is stored and nothing is migrated. `SubscriptionInvoiceRepository`
gains `listCancellations` and `findDocuments`, `SubscriberPaymentRepository`
gains `listSettlements`, in both adapters; a repository of your own adds them.
A CLI module registers `InvoiceExportCliFlow` and `InvoicesExportCommand`.
`isLocalMoment`, `LOCAL_MOMENT_PATTERN`, `localMomentInZone`,
`firstMomentInZone` and the export's model and writers are new in
`@saasicat/core`; `invoicesResource` gains `export`, and `useInvoiceExport`
is new in `@saasicat/ui-vue`.
