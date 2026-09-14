# ADR 0012 — The subscriber, not the tenant, owns contracts, invoices and payments

**Status:** accepted · **Date:** 2026-09-13

## Context

An operator runs one installation per application (`SC-SCOPE-002`) and concludes contracts online
with many tenants: a plan and any number of bundles. The operator has to invoice those contracts,
collect the money, and keep contracts and invoices for as long as tax law asks — which is longer
than a tenant lives. Applications delete a tenant some time after its contract ends.

Everything commercial hangs on the tenant. A contract names a `tenantId`, the account decided
in #214 was going to be per tenant, and the Prisma fragments suggest `onDelete: Cascade` towards the
tenant. A contract also carries no copy of whom it was concluded with. Deleting a tenant therefore
either destroys the tax record or, where an application forbids it, can never happen.

The catalogue said two things at once. `SC-SCOPE-004` and `SC-PRIC-001` left invoicing to the
integrator, while #214 decided that invoices would come to SaaSiCat later. Both consumers were
about to build invoicing, mandates and tenant deletion themselves, each differently.

Applications also invoice at their own level. AutohausPro invoices the people who buy cars, with
models named `Customer` and `Invoice`; VereinsFux collects fees from members, with `SepaMandate`,
`Payment` and dunning. The fragments are copied into the same `schema.prisma`, so a platform
model with one of those names cannot be added at all.

## Decision

**The tenant and the subscriber are two things.** The tenant is where the application keeps its
data, users and files. The subscriber is the party the contract is with: a customer number, the
master data an invoice needs, the payment method. A subscriber outlives its tenant for as long as a
document that has to be kept belongs to it. Every path that creates a tenant, self-registration or
an operator's, creates its subscriber in the same step, and no contract is frozen before the
subscriber's identity, its legal name, billing address and tax identifiers, is complete. Contact
details can change at any time; under a running contract the legal identity is only corrected, on
the operator's record with a reason, since another legal entity taking it over is a transfer. A
subscriber has one live tenant at most, and the tenants it had before stay in its history: a
customer who runs several tenants is a subscriber per tenant, which keeps every tenant-facing read
and change of the account, the payment method and the master data inside that tenant's own
authority. Sign-up never matches a new customer to an existing subscriber by an address somebody
typed; a customer who returns after its tenant was deleted is joined to the subscriber it had by the
operator, who declares it the same legal entity; the master data given at sign-up moves with the
subscription, and documents already issued keep their parties.

**A document carries the parties as they were.** A contract copies the subscriber and the issuer
when it is concluded; an invoice copies both when it is issued, taking the issuer's identity from
the contract its charges belong to. This is the discipline contracts already apply to prices and
terms, and it is what lets the subscriber's live master data shrink once the tenant is gone and no
claim is left, which lasts until the latest end of the reversal period among all its payments, each
fixed when that payment was recorded: every kept document brings its own.

**Contracts, the account, invoices, payments and the deletion record belong to the subscriber.**
The tenant's identifier stays on them as a trace, without a cascade.

**SaaSiCat invoices.** Every charge of a subscription is invoiced once, when it arises: the charges
a billing period opens with together, and a charge that arises later in the period, such as a bundle
booked mid-period, on an invoice of its own. An invoice covers one subscription, so a document stays
inside the tenant it was for and a tenant's download never shows another tenant's charges. One
number range per installation, with a prefix named in `config/saas.yaml` that cannot change once an
invoice exists. The number is assigned in the transaction that writes the invoice, so the range has
no gaps, and it is drawn only once the tax adapter has accepted the invoice's content, so content it
refuses leaves no number behind. The law asks for a unique, sequential number; the gapless range is
what spares an audit the
question of a missing one, and the prefix keeps two applications run by one issuer apart. The
rendered document is archived under that number afterwards, and the invoice is sent or offered for
download only once the archive confirms; an interrupted attempt is completed under the same number,
never issued again. The file is rendered from what the invoice records alone, and its checksum,
recorded before it is archived, is checked on every download. An invoice states the day it is due,
its dates count in the installation's time zone, a billing period with nothing but zero charges
issues none, and every invoice reaches the subscriber by email with its file attached; a
cancellation for a subscriber whose record no longer holds an email asks the operator for an address
to deliver to. An issued invoice is corrected by a cancellation invoice, never edited, and the
cancellation invoice carries the issuer and subscriber of the invoice it cancels. Where some or all
of the charges are still owed, a replacement invoice for exactly those, and for the charges
correcting any of them, follows under a new number, names the invoice it replaces line by line,
carries that invoice's issuer and subscriber with any party detail corrected at the cancellation,
and takes over what was paid on it, before or after the cancellation, so nothing paid is collected
twice, the oldest payment settling first and all of it written in one transaction with the two
invoices; without a replacement the payment is a credit. Cancelling an invoice, recording a payment
or a reversal against it and marking a collection for it as submitted take turns per invoice chain,
the invoice and all its replacements sharing one turn, each reading the chain once it holds the
turn, so an invoice is cancelled once, a payment always settles the invoice that stands, and no
invoice of a chain is collected while an attempt for any of them is unresolved. The issuer's
identity, its legal name and tax identifiers, is the counterparty a contract names: an installation
that names a different identity while contracts with the previous one run does not start, because
moving a contract to another legal entity is a transfer rather than a setting. The tax an invoice
charges, what it has to contain, how its tax is computed and the format it takes come from a tax
adapter for the issuer's country, German law first ([ADR 0013](0013-tax-law-is-an-adapter.md)).

**SaaSiCat collects through a payment gateway.** A gateway port with adapters shipped as packages —
Stripe first, Mollie behind the same port. The means of payment stay with the gateway: the IBAN or
card is entered in the gateway's own form, and SaaSiCat keeps the gateway's reference and masked
details, which is why `SC-PRIV-005` holds as it is. Each reference records the gateway account that
issued it, and an account that still holds references stays configured after the settings name
another. The registration flow's `PaymentProvider` port and `PaymentEventLog` grow into this port
rather than a second payment path beside them, and claiming an event and recording what it changes
become one transaction, so a failed attempt is retried rather than discarded as a duplicate. In the
other direction, a request to collect carries a key that stays the same for that invoice and attempt
across retries, so a lost answer never becomes a second charge, an invoice has one active collection
attempt at a time, and a payment is recorded once by the gateway's reference for it however it is
reported. Sign-up activates on a confirmed payment method, and an invoice still unpaid past a grace
period, the first one included, makes the tenant read-only until it is settled. A tenant's access
state keeps every reason that holds, the strictest applies, and settling lifts only its own, so a
payment never reopens a tenant that is read-only after its subscription ended or is suspended. A
direct debit is announced on the invoice before it is collected, and a payment the gateway takes
back after confirming it, such as a returned debit or a chargeback, is recorded as a reversal that
takes back everything the payment settles by then, the replacement a cancellation moved it to and
the credit it became included. A refund the operator makes in the gateway is matched to the credit
it pays out and reopens nothing; a credit the gateway can no longer refund is paid out by the
operator outside it, and recorded against the credit. Paying an invoice by bank transfer is not
offered in this stage and stays open for a later one, for an enterprise subscriber who pays against
an invoice.

**Nothing kept for tax is deleted automatically**, in this stage. A retention period in
configuration can be set too short, and the first one runs out years from now.

**SaaSiCat runs the tenant's lifecycle; the application carries it out.** After a subscription ends,
a trial that never became a contract included, the tenant keeps a read-only period the installation
names, is reminded by email at the lead times the installation names, and is then deleted. Read-only
still lets a user with the billing permission
replace the payment method while an invoice is open, since the claim outlives the subscription, and
after the deletion the operator sends the gateway's payment page for it; a suspended tenant cannot
act at all. The application implements the ports for what only it knows: erasing its data, erasing
its files, a full export, reporting what the tenant should keep before it goes, and enforcing a
tenant's access state on every request, sign-in included. Rendering an invoice in the format its tax
adapter requires and archiving a document are ports as well, so an application's existing renderer
or document store becomes an adapter. A tenant downloads its invoices through the tenant routes
SaaSiCat already mounts behind the application's guards, and a download returns the archived
document rather than a new rendering; no further interface is needed. Concluding or changing a
contract archives a confirmation the subscriber receives and downloads like an invoice, and inside a
tenant only a user with the billing permission, which the application maps to its roles, sees
either; the permission governs the whole billing area, the account and the payment method included,
while the plan, the usage and a change's preview stay open to every signed-in user. The tenant's own
duty to keep records does not stop its deletion. Keeping them is the
tenant's obligation, not the operator's: the read-only period and the offered export are the time
and the means to take them along, and after that period everything of the tenant's is erased,
records it locks against deletion while in use included. Deleting a single record inside the
application still honours the application's own locks. A deletion run can be repeated without harm,
each eraser counting what it is about to erase first and treating what is already gone as done, and
it counts as done only once every store has confirmed. The deletion date is recorded and told to the
tenant whenever its subscription ends, by cancellation, by a trial running out or by the operator,
and holds against a later change to the configured period; the operator can delete earlier only for
a legal reason, after being shown that date and confirming, and the deletion record keeps both dates
and the reason. The operator acting as a tenant is not held to its access state, so support and an
export stay possible on a suspended tenant, until a deletion run begins; from then on nobody writes
to the tenant. A deletion leaves a record with the subscriber, as counts without personal data, and
not in the audit log, which an installation may prune. `TenantPort` and `ActivationOrchestrator` are
the seams these extend.

**Every model this adds carries `Subscription` or `Subscriber` in its name** — `Subscriber`,
`SubscriptionInvoice`, `SubscriberMandate`. The prefix keeps them clear of the names applications
use for their own invoicing; because it cannot rule out a name nobody has seen, `saasicat schema
check` reports an application model that carries a platform model's name with a different shape. The
German interface does not call the subscriber's page _Kundenakte_: AutohausPro already uses that
word for a dealer's record of its buyers.

**Settings live in `config/saas.yaml`**: the issuer's details, the tax adapter, the time zone
invoice dates count in, the payment term, the version of the operator's terms, which a contract
records when it is concluded or changed, the invoice number
prefix, the gateway accounts, the one for new payment methods with the methods it offers and any
still holding references, the direct debit lead time, the read-only period, the grace period for an
unpaid invoice, and how long a payment can still be reversed. Each account's keys and webhook secret
come from the environment.

**The model cut lands before 1.0.0.** Introducing the subscriber, the party copy on the contract and
the contract's link to the subscriber breaks the contract model, and 1.0.0 is where a break belongs.

## Alternatives considered

- **Leave invoicing to each application**, as `SC-SCOPE-004` says. Two implementations of the same
  tax-relevant logic, each deciding again what a customer bought, over a contract model that would
  then exist twice.
- **A billing service shared by all installations.** One number range across applications, at the
  price of coupling installations that `SC-SCOPE-002` keeps apart. Tax law accepts separate number
  ranges as long as every number is unique, which the prefix already gives.
- **Keep everything on the tenant and refuse to delete a tenant with a contract.** The tax record
  survives, the application's data never goes, and the contract still does not say whom it was
  with.
- **Keep the full IBAN in SaaSiCat and write the collection file.** No gateway dependency, but
  SaaSiCat would hold the means of payment and still neither collect nor learn what was paid.
- **Let the gateway invoice**, as a subscription product like Stripe Billing does. Its invoices
  follow neither the contracts nor the number range nor the retention here, and changing the gateway
  would split the tax record in two.
- **Several live tenants per subscriber.** It would suit a customer who runs several tenants, and it
  needs an authority above a single tenant for the shared account, payment method and master data.
  Nothing defines that authority, and a tenant's administrator standing in for it could change what
  another tenant is charged. Until one is defined, such a customer is a subscriber per tenant.
- **Name the subscriber `Customer`.** It collides with AutohausPro's own model of the same name.

## Consequences

- The requirements this decides are recorded as decided but not delivered: `SC-SCOPE-011` to
  `SC-SCOPE-013`, `SC-SUB-016` and `SC-SUB-017`, `SC-PRIC-022` to `SC-PRIC-036` except
  `SC-PRIC-027`, `SC-PRIC-045` to `SC-PRIC-049`, `SC-REG-021` and `SC-REG-022`, `SC-ADM-019` to
  `SC-ADM-027`, `SC-CANC-020` to `SC-CANC-022`, `SC-UI-022` to `SC-UI-024`, `SC-PRIV-011` to
  `SC-PRIV-018`, and `SC-AUD-012` to `SC-AUD-016`.
- Seven promises become false once their replacements are built: `SC-SCOPE-004`, `SC-PRIC-001`,
  `SC-REG-016`, `SC-REG-018`, `SC-ADM-006` and `SC-ADM-013`, which are current, and `SC-PRIC-019`,
  which was decided for the tenant rather than for whoever holds the billing permission. Each is
  superseded in the change that delivers its successor, not before — most of them are proved by
  tests of what is true today, and a superseded requirement proves nothing.
- Persistence grows in both adapters, under the executable contract, and every migration is applied
  twice.
- Each gateway adapter is a new package in the fixed group and needs its manual first publish.
- An application implements the tenant ports. Its own invoicing — the people it sells to, the members
  it collects from — stays its own and is not touched by any of this.
- Two installations hand two exports to the tax advisor; the operator's bookkeeping is where they
  meet. A DATEV export and a cash book are not part of this.

## Migration

Additive first: the subscriber and the contract's link to it arrive nullable, both applications
create a subscriber per tenant from the tenant's master data and attach its contracts, and the link
becomes required afterwards. A party copy made during that backfill says it was made then, is never
presented as what was true when the contract was concluded, and is confirmed by the operator against
the contract before that contract is invoiced. An existing tenant without a gateway payment method
is asked to add one; its invoices are issued and stay open until it does. AutohausPro keeps its
restricting foreign key on contracts until the subscriber link exists.

## What breaks if you ignore this

A contract that cascades with its tenant takes the tax record with it on the first deletion, and
nothing reports it. An invoice edited in place is no longer the document the subscriber received. A
fragment model named like an application's own table cannot be added to that application's schema,
and the integrator finds out while copying it.
