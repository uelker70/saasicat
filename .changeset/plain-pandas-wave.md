---
'@saasicat/ui-vue': minor
---

Add `useResourceList`, the typed way to page through a platform list, plus the
first two list descriptors — `tenants` and `audit` — for it to run on.

A list built on `useApiList` needs an endpoint per call site, which is why every
page that renders one carries an `endpoint` prop and every consumer app spells
`/api/v1/admin/tenants` again. `useResourceList('tenants')` asks the resource
registry instead, which already knows the API base, the project and the locale,
and the row type comes from the operation rather than from a type argument the
caller asserts:

```ts
const list = useResourceList('tenants', { filter, pageSize: 25 });
// list.items is Ref<TenantDto[]> — no endpoint, no generic, no glue.
```

It returns `items`, `total`, `page`, `pageSize`, `pending`, `error`, `reload`,
`goToPage` and `setPageSize`. `error` is an `AdminError`, so a page can branch on
`status` and `code`, and the state around the load is `useAsyncData`'s — including
its generation guard, so two quick filter changes can no longer let the older
answer land last, which is what happens on `useApiList` today.

Three details worth knowing before you migrate a page:

- **`pageSize` is an option.** A page that had a page size to apply called
  `setPageSize()` in setup — and that loads, while the first load was already
  queued, so the list fetched the same rows twice on every mount. Passing the
  size removes the second request.
- **`page` and `pageSize` are not filter keys.** `TenantListFilter` and
  `AuditQuery` still declare them, and because a filter is serialised after the
  pagination, such a key wins on the wire while `page.value` keeps the number
  `goToPage()` set — the list then reports a page it is not showing.
  `useResourceList` refuses that filter and says so; the descriptors' filter
  types leave the two keys out.
- **`total` is what the endpoint reports**, and falls back to the rows in hand
  when it reports nothing. Several admin controllers answer with a bare array,
  including `GET /admin/tenants`, so a paginator bound to it is showing "rows
  received" for those.

`useApiList` is unchanged as the untyped escape hatch for an app's own endpoints,
and `useTenants` and `useAuditEntries` keep their signatures. What both now share
is one implementation of the query string, the page bounds and how an answer is
read — `createAdminResourceClient` had a third copy of the "omit empty values"
rule, and three copies of one decision is three chances for one of them to start
sending `status=null`. `ApiListResponse` is now an alias of `ResourceListPage`
and marked deprecated; it is the same shape, so nothing that imports it breaks.

One edge of `useApiList` did change with that consolidation: an envelope whose
`items` is not an array — `{ items: "three" }` — now yields an empty list
instead of being passed to the table as rows. Everything else it sends and
records is unchanged, and the descriptors are held to that by a test that drives
both sides and compares what reaches the client.
