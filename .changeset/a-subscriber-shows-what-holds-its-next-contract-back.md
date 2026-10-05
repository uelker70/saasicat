---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A subscriber shows what holds its next contract back

Where `config/saas.yaml` names a tax adapter, a contract names its subscriber
only with the whole address an invoice names (`SC-PRIC-069`), and the operator
and the tenant both see what holds a subscriber's next contract back
(`SC-PRIC-070`). Without an adapter nothing is refused and nothing is marked.

- **Every way a contract comes about** — a sign-up, an offer, a plan change,
  an add-on, a full re-freeze — refuses a subscriber without its street and
  number, postal code, city and country with the new code
  `422 SUBSCRIBER_IDENTITY_INCOMPLETE`, the empty fields in `params.missing`,
  before the adapter is asked. A refresh that keeps the parties a running
  contract names is not refused. Fill in the address of every subscriber a
  sign-up did not create through `SubscriberService.changeContactOfTenant`
  before deploying with an adapter. A scheduled retirement move refused this
  way records `identity-incomplete`, the empty fields in `missing`.
- **`SubscriberService.readinessFor`** answers a subscriber's standing — the
  empty address fields and the adapter's sentence where it supports no
  treatment — computed from the record and the adapter as they are then; `null`
  without an adapter. An adapter that fails is not read as a refusal.
- **The operator** sees a tenant's subscriber beside the tenant,
  `GET admin/tenants/:slug/subscriber`, announced as `subscribers.read`: its
  address, whether it acts as a business, its VAT id and whether the check that
  counts found it valid, and its standing. `GET admin/subscribers/attention`
  answers which of up to 200 tenants are held back and why; the manifest
  announces `subscribers.attention` only where an adapter decides. Both are
  mounted wherever `adminResources` is on and a subscriber repository is
  composed, and run inside the RLS bypass. `TenantDetailPage` shows the
  subscriber with a warning naming each reason, and `TenantsPage` and
  `SubscriptionsPage` mark each tenant held back.
- **The tenant** reads `business` and `readiness` from `GET` and
  `PATCH billing/details`; `TenantBillingSection` shows the customer type and
  what to add, and the notice goes once nothing holds the contract back.
- **Ports.** `SubscriberRepository.listForTenants(tenantIds, tx?)` is new and
  required — both shipped adapters and the persistence contract have it — and
  `AdminSubscriptionListRow.tenant` carries the tenant's `id`, which
  `PrismaAdminResourcesAdapter` gives. `TenantBillingDetailsShape` gains
  `business` and `readiness`.
- **A contract is decided for the party it copies.** The subscriber is read
  once per contract, and its rate decided from that read: a change landing in
  between can no longer leave a contract naming one party at a rate decided
  for another. `SubscriberService.contractPartiesFor` is now
  `contractPartyFor(tenantId, { forTaxAdapter }, tx?)`, answering the parties
  and the tax origin of the same read.
