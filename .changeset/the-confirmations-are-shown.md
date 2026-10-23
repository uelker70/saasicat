---
'@saasicat/ui-vue': minor
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
---

The operator sees a tenant's contracts and downloads their files

`TenantDetailPage` shows every contract of the tenant, the newest first, with
its start, status, rhythm, price, terms and notice period and where its
confirmation stands, and downloads an archived confirmation; each invoice of
the payments section whose document is archived has a download of it beside
it. Both appear where the manifest announces `contracts.read` and
`invoices.read` (`useTenantContracts`, `useTenantDownloads`, `useFileDownload`,
`saveFile`); while one file is on its way the other downloads wait.

`AdminTenantInvoice` gains `documentArchived`, read through the new
`SubscriptionInvoiceRepository.listArchivedDocuments(invoiceIds)`, which both
adapters implement and the persistence contract holds. A repository of your
own adds it.

`HttpClient` takes `binary: true` for a file, and `HttpResponse` gains an
optional `bytes()` that hands the body over as it arrived; both
`createFetchHttpClient` and `createAxiosHttpClient` implement it, the axios one
by asking for an `arraybuffer` for that request alone. A client of your own
without `bytes()` keeps serving every other request, and a download through it
says so rather than saving a file decoded as text.
