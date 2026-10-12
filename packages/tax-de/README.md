# @saasicat/tax-de

## What this is

The tax adapter for an issuer in Germany: one class behind the `TaxAdapter`
port of `@saasicat/core`
([ADR 0013](../../docs/explanation/adr/0013-tax-law-is-an-adapter.md)). It
decides which treatment a charge takes and checks a VAT identification number
through VIES. Every answer names the adapter and the version it was published
as, so a contract or an invoice keeps saying why it carries its tax after the
adapter is updated.

**It is a template, not tax advice.** It encodes the cases below and nothing
else; the operator stays responsible for the tax it charges, and should have
its tax advisor confirm the cases before invoicing with it.

### What it decides

For an issuer in Germany (`SC-PRIC-064`):

| The subscriber                                                       | Treatment        | Rate                                          | Note on the document                                                       |
| -------------------------------------------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| in Germany, business or consumer                                     | `standard`       | the German rate on the last day of the period | none                                                                       |
| in Germany, where the issuer is a small business                     | `small-business` | 0                                             | the § 19 UStG note that no VAT is charged, in German                       |
| a business elsewhere in the European Union, its VAT number validated | `reverse-charge` | 0                                             | the reverse charge note of § 14a (5) UStG, with "Reverse charge" beside it |
| a business outside the European Union                                | `not-taxable`    | 0                                             | that the service is not taxable in Germany, in German and English          |

Everything else is answered as not supported, with a sentence saying why, so
that the platform refuses it rather than invoicing it with a guessed tax:

- an issuer outside Germany, or one whose country is not configured;
- a subscriber whose country is not known, or who has not said whether it is a
  business and is outside Germany;
- a consumer outside Germany;
- a business elsewhere in the Union whose VAT number is not validated;
- a VAT number of another state than the billing address — a German number
  for an address in Austria names a German establishment, which is supplied
  with German VAT — and a number of a member state with an address outside the
  Union, recognised by its prefix and the format of that state's numbers, so an
  identifier from elsewhere that happens to begin with a member state's code is
  not taken for one; Greek numbers carry `EL`;
- a reverse charge for an issuer without a VAT identification number of its
  own — the invoice has to name both numbers;
- a subscriber in Monaco, which belongs to the French VAT territory;
- a period ending before 1 January 2007, the first rate the adapter knows.

**The rate** is the one in force on the last day of the period a charge covers:
a continuing service is performed when its period ends. That day counts in the
installation's time zone, which the platform passes with every request
(`timeZone`); for an issuer in Germany that is `Europe/Berlin`. A period ends
just before its `until`. The adapter knows the German standard rate from 2007
on, including the 16 % of the second half of 2020.

**The small business exemption** of § 19 UStG reaches subscribers in Germany
only. A small business with a VAT identification number invoices a business
elsewhere in the Union under the reverse charge, and a business outside it as
not taxable, as any issuer does.

**A note** is recorded word for word with the contract and the invoice, in the
wording German law asks for; the exact texts are in `src/notes.ts`. Where a
subscriber abroad reads it, it carries English beside the German.

### What it asks of an invoice

**Its tax** by the rule of EN 16931, which ZUGFeRD computes by: once per rate,
over the lines' net amounts (`taxPerRate` in `@saasicat/core`).

**Its content**, checked before the platform draws its number (`SC-PRIC-027`):
both parties' full addresses, the issuer's tax number or VAT identification
number (§ 14 (4) UStG), both VAT identification numbers under the reverse
charge (§ 14a (1) UStG), the note its treatment carries, and a title on every
line. An invoice the adapter finds a gap in waits, without a number, until the
gap is filled.

**Its file**, checked once it is rendered and before it is archived
(`SC-PRIC-042`): ZUGFeRD in the EN 16931 profile — a PDF/A-3 a person reads,
declared Factur-X `EN 16931` in its metadata, carrying `factur-x.xml` as its
alternative, in the profile `urn:cen.eu:en16931:2017` — whose XML states what
the invoice records: its number, its dates and period, its currency, the
issuer's name and tax numbers, the subscriber's name, the tax per rate, the
totals, and each line's amount and, in its one VAT breakdown, its rate, every
breakdown in the VAT category EN 16931 gives the treatment. A VAT identification
number it names for the subscriber is the one the invoice records, and under the
reverse charge it has to name it; neither party names more than one, and outside
the scope of VAT neither names one and no rate is stated, as EN 16931 asks
(BR-O-02, BR-O-05). A recorded name holding a character XML cannot hold is
compared with `?` in its place, as the XML has to write it. A file that lacks
any of it, states another figure, or states once more what the format gives
once, is refused, and the invoice waits under its number for a renderer that
gets it right. The check reads the file itself; it does not run EN 16931's full
Schematron rules.

### How a VAT identification number is checked

Through VIES, the European Commission's service, with the number split into its
country prefix and the rest. Where the issuer has a VAT identification number,
the request names it as the requester, so the answer carries the request
identifier that confirms the check was made. The answer is recorded as VIES
sent it, every text field of it, dated by the platform's clock when it arrived
(`SC-PRIC-040`).

- **Valid or invalid** — a completed check.
- **A number VIES cannot read as one** (`INVALID_INPUT`) — a completed check
  that found it invalid.
- **Anything else** — a failure VIES reports, such as a member state that cannot
  answer right now, an HTTP error, an answer the adapter cannot read, no answer
  within the timeout, a service that cannot be reached — is a check that did not
  complete. It never counts as valid.

Greek numbers carry the prefix `EL`, as VIES knows them; a number entered as
`GR…` is found invalid.

An installation names the adapter in `config/saas.yaml` and binds its factory, which builds it
from the options the file gives:

```ts
import { germanTaxAdapterFactory } from '@saasicat/tax-de';

SaaSiCatModule.forRoot({
    // …
    tax: { adapter: germanTaxAdapterFactory() },
});
```

```yaml
timeZone: Europe/Berlin
tax:
    adapter: '@saasicat/tax-de'
    options:
        smallBusiness: false
```

The file may name `smallBusiness` and nothing else; another key is an error at the start. What only
code can give goes to the factory, `germanTaxAdapterFactory({ fetch, viesTimeoutMs, now })`, and
`new GermanTaxAdapter({ … })` builds one directly with every option.

| Option          | Default        | What it does                                                           |
| --------------- | -------------- | ---------------------------------------------------------------------- |
| `smallBusiness` | `false`        | The issuer uses the small business exemption of § 19 UStG.             |
| `viesTimeoutMs` | `10000`        | How long a VIES check may take before it counts as not completed.      |
| `fetch`         | global `fetch` | What reaches VIES — for a proxy, and for tests against a local server. |
| `now`           | the clock      | What dates a check — for tests.                                        |

## What this is not

- **Not every case.** The country of the billing address decides; a territory
  whose VAT status differs from its country's — the Canary Islands, Büsingen,
  Heligoland, Åland, Mount Athos — is decided by its country. A reduced rate,
  an exemption and a consumer abroad are not decided at all.
- **Not every identifier.** A number from outside the Union that has the exact
  shape of a member state's — a Mexican RFC beginning `FR`, whose two letters
  and nine digits are also a French VAT number's — is taken for that state's,
  and the case is refused rather than decided as not taxable. No format can tell
  the two apart.
- **Not a renderer.** It checks the file an invoice is issued as; it does not
  write one.
- **Not a store.** The adapter decides and checks; the platform records the
  treatment with the contract and every check with the subscriber.

## Next

- [ADR 0013](../../docs/explanation/adr/0013-tax-law-is-an-adapter.md) — why
  tax law is an adapter, and what an adapter decides.
- [The requirements](../../docs/requirements.md) — `SC-PRIC-037` to
  `SC-PRIC-045` and `SC-PRIC-064`.
