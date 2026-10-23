---
'@saasicat/ui-vue': minor
---

The operator sees a tenant's contracts and downloads their files

`TenantDetailPage` shows every contract of the tenant, the newest first, with
its start, status, rhythm, price, terms and notice period and where its
confirmation stands, and downloads an archived confirmation; each invoice of
the payments section has a download of its archived document beside it. Both
appear where the manifest announces `contracts.read` and `invoices.read`
(`useTenantContracts`, `useTenantDownloads`, `useFileDownload`, `saveFile`).

`HttpClient` takes `binary: true` for a file, and `HttpResponse` gains an
optional `bytes()` that hands the body over as it arrived; both
`createFetchHttpClient` and `createAxiosHttpClient` implement it, the axios one
by asking for an `arraybuffer` for that request alone. A client of your own
without `bytes()` keeps serving every other request, and a download through it
says so rather than saving a file decoded as text.
