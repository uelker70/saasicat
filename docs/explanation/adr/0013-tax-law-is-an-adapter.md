# ADR 0013 — Tax law is an adapter for the issuer's country

**Status:** accepted · **Date:** 2026-09-14

## Context

An operator may run SaaSiCat in any country, with any application. ADR 0012 has SaaSiCat invoice
subscriptions, and an invoice is where tax law meets the product: which tax a subscriber is charged,
what the invoice has to say, how its tax is computed and in which format it is issued. None of that
is the same in two countries, and within one country it depends on who the subscriber is.

An installation names one `vatRate` in `config/saas.yaml` and applies it to everybody
(`SC-PRIC-009`). That holds while every subscriber sits in the issuer's own country. It stops holding
as soon as one does not: a business in another member state of the European Union is invoiced under
the reverse charge without the issuer's VAT, a business outside the Union is not taxable in the
issuer's country, and a small business issuer charges no VAT at all. An invoice that shows tax that
is not owed still makes the issuer owe it. Nor can a contract keep the rate it was concluded at when
the law changes the rate for the periods after the change (`SC-PRIC-016`).

The same law decides three more things, and they differ by country as well: how an invoice's tax is
computed, where Germany follows EN 16931 and applies each rate to the net total instead of adding up
the lines' rounded taxes; what an invoice has to contain and what its documents are called; and the
electronic format, which Germany makes mandatory between businesses from 2027 and 2028.

## Decision

**SaaSiCat interprets no tax law; a tax adapter for the issuer's country does.** The port lives in
`@saasicat/core`, each adapter is a package of its own, and `config/saas.yaml` names the one an
installation uses. What an adapter decides:

- **The treatment of each charge**: the standard or a reduced rate, an exemption, the reverse charge,
  not taxable in the issuer's country, or a small business's exemption, with the rate and the note
  the invoice carries. It decides from the issuer, the period the charge covers and the subscriber's
  origin as its record stands when the invoice is issued: the country of the billing address, whether
  the subscriber is a business, and its tax identifier once validated.
- **How a tax identifier is validated**, such as through the European Union's VIES service. A check
  that cannot complete counts as no identifier, never as a valid one.
- **How an invoice computes its tax**, what it has to contain and what its documents are called. An
  invoice missing a mandatory detail draws no number and is not issued: the content is checked
  before the number range is touched.
- **The format an invoice takes.** Rendering stays a port, as ADR 0012 has it, so an application's
  own renderer can produce the file; the adapter checks the rendered file before it is issued,
  against the same profile as the content, and a file it refuses anyway leaves the invoice waiting
  for its document under the number it already has until the defect is fixed.
- **Which cases it does not support.** Sign-up and an operator creating a subscriber are refused
  such a case before a contract exists, rather than invoicing it with a guessed tax.

SaaSiCat records each answer with the adapter's name and version, on the contract when it is
concluded and on each invoice when it is issued. A document keeps saying why it carries its tax after
the adapter is updated or replaced, and an update never changes a document already issued. A change
to the subscriber's country, business status or tax identifier is recorded with its date and applies
from the next invoice.

**German law is the first adapter, `@saasicat/tax-de`, and the template for the next.** It treats a
subscriber in Germany at the German rate, a business elsewhere in the European Union with a validated
VAT identification number under the reverse charge, a business outside the Union as not taxable in
Germany, and a small business issuer without VAT. It computes tax per rate from net totals and issues
ZUGFeRD in the EN 16931 profile. A consumer outside Germany and a business in another member state
without a validated number are refused until the adapter covers them.

**An adapter is a template, not tax advice.** The operator stays responsible for the tax it charges,
and each adapter's documentation says what it decides and on which basis.

## Alternatives considered

- **German rules in the core, other countries added beside them.** Every installation would carry
  every country's rules, and a change for one country would release all of them.
- **A table of rates per country in the configuration.** It holds a rate and nothing else: no reverse
  charge, no note, no validated identifier, no rule for computing the tax and no format.
- **An external tax service as the only way,** such as a payment gateway's tax product. Such a service
  fits behind the same port as one adapter; as the only option it would tie every installation to a
  provider and its prices.
- **Leave tax to the application.** Each application would decide again what an invoice SaaSiCat
  issues has to say, which is the duplication ADR 0012 removes.

## Consequences

- The requirements this decides are recorded as decided but not delivered: `SC-PRIC-037` to
  `SC-PRIC-044`, and `SC-PRIC-027` in the wording that names the adapter.
- For an installation that invoices, five current promises become false once the adapter is built:
  `SC-PRIC-008`, `SC-PRIC-009`, `SC-PRIC-016`, `SC-MKT-023` and `SC-CFG-034`. Each is superseded in
  the change that delivers the adapter, and what still holds, such as one currency per installation
  and an offer priced on the server, moves into its successor.
- A price shown before a subscriber's origin is known, such as on the pricing page, states the
  treatment for a subscriber in the issuer's country and says so.
- `@saasicat/tax-de` is a new package in the fixed group and needs its manual first publish.

## Migration

Additive. An installation that invoices names a tax adapter in `config/saas.yaml` and does not start
without one; its offers, contracts and invoices then take the rate from the adapter. `vatRate` stays
for an installation that does not invoice. For a subscriber in Germany the German adapter charges
what `vatRate: 19` charged, so an installation whose subscribers are all domestic sees the same
amounts. A contract concluded before the adapter records no treatment, and each of its invoices
takes the adapter's answer when it is issued.

## What breaks if you ignore this

An invoice to a business in Vienna shows German VAT, the issuer owes that tax although nobody paid
it, and nothing reports it. A total built from the lines' rounded taxes differs from the one the
electronic format computes, and the file is rejected. An adapter update that renders an old invoice
again hands out a document the subscriber never received.
