---
'@saasicat/spec': major
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
---

A contract line records the currency and the tax it was booked with

`ContractLineItem` gains three required columns — `currency`, `taxRate` and
`taxAmount` — and `ContractLineItemRecord`, `NewContractLineItemData` and
`InvoiceLineItemSnapshot` gain the matching fields. An installation configures
one currency and one rate at a time, so a line never chooses them; what the
column is for is that a row keeps meaning what it meant after either is
changed, which is why changing a currency once contracts exist is a migration
rather than an edit.

`taxRate` is stored even though net and gross both are, because the ratio
between them is not the rate: it cannot be reproduced for a gross that was
rounded, it cannot express an exempt or a reverse-charge line, and it does not
survive a rate change. `taxAmount` is the gap between the line's own net and
gross, so the row cannot disagree with itself and no reader rounds a second
time.

**Run `sql/1.0-line-items-record-their-money.postgres.sql` before `db push`.**
The columns are NOT NULL, which `db push` cannot add to a table that already
holds rows. The migration adds them, fills them from each line's own contract —
`priceSnapshot` already records the currency and the VAT rate that were agreed
— and only then makes them required. It refuses, naming the contract, where a
snapshot states no currency or a rate that is not a number between 0 and 100,
rather than inventing one; and it does nothing at all on a second run.

**If you implement the persistence ports, your build breaks here.** A
repository adapter has to read and write the three fields.
`ContractFreezeSourcePort.loadBookedBundles` deliberately does not: its
`lineItems` are now `PricedContractLineItem`, the same shape without them,
because a source prices what it sells and the platform records the
installation's currency and rate. An adapter that annotates its result as
`NewContractLineItemData[]` needs that annotation dropped or changed.

**The rate is recorded in per cent on both paths, which the checkout path did
not do before.** A checkout offer prices its lines as `net * (1 + vatRate)` and
so states the rate as a fraction, while the catalogue states per cent; recorded
as they stand, one column would hold both. Which unit an offer's breakdown
carries is now read off that breakdown's own totals rather than assumed.
`SubscriptionContractPriceSnapshot.vatRate` is unchanged and still carries
whichever unit the contract was concluded with — it now says so — and
`ContractLineItemRecord.taxRate` is the one that is always per cent.

**`SubscriptionContractService.create` refuses a line that disagrees with its
contract.** `SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH` where `taxAmount` is
not exactly `priceGross - priceNet`, and
`SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH` where the line's currency is
not the one the contract was priced in. Both platform paths satisfy them, so
these only reach a caller supplying its own line items — but a contract is
append-only, and an invoice stating one currency in its total and another on
every line is a record nobody can correct afterwards.

`@saasicat/spec` also ships `schemas/tenant-ledger.schema.json`, naming the
shapes of a per-tenant account — a charge, a payment, the origins a charge can
have, and the account read model — with the generated types in `@saasicat/core`. A
payment carries no tax split: the net, the rate and the tax belong to the
charges it settles, and asking a payment for them would make an integrator
write a number nobody knows. Nothing reads the shapes yet; the persistence and
the service that writes charges follow.
