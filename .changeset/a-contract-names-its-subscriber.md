---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/spec': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/cli': major
---

Conclude every contract with its subscriber, and copy both parties onto it

A tenant holds the application's data; the subscriber is the party a contract
is concluded with: a customer number and the master data a contract names.
Every contract names its subscriber and copies the subscriber and the issuer
from `config/saas.yaml` when it is concluded, and a later change to either
leaves the copy alone. A contract belongs to its subscriber, and its `tenantId`
is kept as a trace without a relation to the tenant.

- New `Subscriber`, `SubscriberTenant` and `SubscriberCorrection` fragments,
  and `subscriberId`, `subscriberSnapshot`, `issuerSnapshot` and
  `partiesMigrated` on `SubscriptionContract`. Remove the relation from
  `SubscriptionContract` to your `Tenant` model: `saasicat schema check` fails
  while it cascades.
- Run `sql/1.0-a-contract-names-its-subscriber.postgres.sql` before `db push`.
  It gives every tenant with a subscription or a contract a subscriber named
  from your tenant table's `name`, attaches its contracts with copies marked
  `partiesMigrated`, and makes the link required; it stops, naming the tenants,
  where it cannot name one. Safe to run twice.
- `SubscriberService` in the new `@saasicat/nest/subscriber` entry creates the
  subscriber where your application creates a tenant, on the same transaction,
  with only the legal name required. Customer numbers count from 10001 behind
  `subscribers.customerNumberPrefix`. Contact details change at any time; the
  legal name and tax identifiers change only as a declared correction of the
  same legal entity, recorded with the values replaced, the reason and who made
  it.
- `SubscriptionContractService.create`, `replaceActiveContract`, the contract
  freeze and `CheckoutOfferService.conclude` refuse a tenant without a
  subscriber with `SUBSCRIBER_REQUIRED`, and so do a plan change and booking an
  add-on where contracts are frozen, before anything is written. `conclude`
  takes `subscriber` to create a sign-up's subscriber on its transaction, and
  `FinalActivationResult` carries `subscriberId`.
- `SubscriptionContractModule`, the `conclusion` of `CheckoutOfferModule` and
  `tenantBilling.contractFreeze` require `subscriberRepository`; both shipped
  persistence bundles supply it.
- `config/saas.yaml` takes an optional `issuer`. A database catalogue now
  carries every settings block of the file, this one included.
- `persistenceAdapterContract` checks the subscriber port under the new gap
  `subscribers`, and the contract scenarios need the seed writer
  `createSubscriber`.
