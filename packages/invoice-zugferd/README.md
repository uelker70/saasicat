# @saasicat/invoice-zugferd

## What this is

The default invoice renderer for SaaSiCat. It renders an issued invoice into
ZUGFeRD in the EN 16931 profile: a PDF/A-3 that a person reads, labelled in
German with English beside it, carrying the CII XML a program reads as
`factur-x.xml`. It implements the `InvoiceRenderer` port of `@saasicat/core`,
so an installation invoices without writing a renderer of its own
(`SC-PRIC-078`).

```ts
import { zugferdInvoiceRenderer } from '@saasicat/invoice-zugferd';

tenantBilling: {
    chargeJournal: {
        // …
        invoices: {
            invoiceRepository: persistence.entitlement!.subscriptionInvoiceRepository!,
            renderer: zugferdInvoiceRenderer(),
            archive: persistence.entitlement!.subscriptionInvoiceArchive!,
            mail: new YourInvoiceMail(),
        },
    },
},
```

### What the page says

An A4 letter laid out after DIN 5008:

- the issuer with its VAT identification number and tax number;
- the subscriber's address, with its country in capitals where it is abroad,
  and its VAT identification number where its record holds one;
- the invoice's number, issue date, service period, customer number and due
  date;
- its lines, running on over as many pages as they need;
- the tax per rate and the total;
- the note its treatment carries, such as the reverse charge;
- the footer lines `config/saas.yaml` named under `invoicing.footer` on the
  issue date, on every page, with the page's number (`SC-PRIC-093`); a line
  wider than the page goes on in the next, and the foot grows to hold it.

A name or an address line wider than its column goes on in the next line, and
what follows moves down with it. A character the font has no glyph for is shown
as `?`; the XML keeps it as it was written, unless XML cannot hold it at all, as
a control character pasted into an address, which is `?` there too. A carriage
return is written as the line feed every XML parser reads it as.

### What the XML says

The same figures as UN/CEFACT CII D16B in the EN 16931 profile, with the VAT
category EN 16931 names for each treatment:

| Treatment                  | Category | VAT ids named | Rate stated |
| -------------------------- | -------- | ------------- | ----------- |
| `standard`, `reduced`      | `S`      | yes           | yes         |
| `exempt`, `small-business` | `E`      | yes           | yes         |
| `reverse-charge`           | `AE`     | yes           | yes         |
| `not-taxable`              | `O`      | no (BR-O-02)  | no          |

Where no VAT identification number of the issuer stands, the issuer is
identified by it or by its tax number as its own identifier, which EN 16931
asks for (BR-CO-26). A line that takes something off, such as a discount, is
one unit taken back at a price that is not negative (BR-27).

### A cancellation invoice and its replacement

An invoice whose `correction` names the invoice it corrects is rendered as what
it is (`SC-PRIC-089`):

- a **cancellation** is titled "Stornorechnung / Cancellation invoice" — never
  "Gutschrift", which German VAT law reads as self-billing by the recipient. Its
  page states the cancelled amounts reversed, as the invoice records them, names
  no due date and no payment method, and says that nothing is to be paid. Its XML is a credit note
  (type `381`), stating those amounts as the cancelled invoice did;
- a **replacement** is an invoice (type `380`) like any other.

Both name the invoice they correct by number and issue date, beside the facts
and as the document reference of the XML (BT-25, BT-26), with the reason given
for the cancellation under the title and as a note. Each line names the line it
cancels or replaces, under its description and as the line's note (BT-127).

### The same file every time

The renderer takes everything from the invoice as it was issued: the file's
dates are the invoice's moment of issue, its identifier is derived from the
invoice, and nothing random reaches it. The same invoice renders into the same
bytes, which is what lets a repeated archiving attempt write the file whose
checksum was recorded (`SC-AUD-019`).

### Fonts

Roboto Regular and Bold 2.138, under the Apache License 2.0, cut down to the
characters of Latin, Greek and Cyrillic script with their punctuation, currency
and number signs (`fonts/README.md` lists them and says how). Each invoice
embeds the glyphs it uses. An application with a typeface of its own passes it:

```ts
zugferdInvoiceRenderer({ fonts: { regular: regularTtf, bold: boldTtf } });
```

pdf-lib's subsetting misplaces the glyphs of a TrueType font whose glyph data
has odd lengths, as the Roboto release's has, and the page then shows a few
letters while every validator passes. The renderer pads each font it is passed
before embedding it; `withEvenGlyphs(font)` does the same for an application
that embeds a font with pdf-lib itself.

### How it is checked

The tests read back what the page and the XML say for each treatment the
German adapter decides, and that every glyph on a page is drawn. CI hands the
same invoices to the format's own validators: Mustang, which runs veraPDF for
PDF/A-3b and the EN 16931 and Factur-X schematron. Its report judges the PDF
and the XML apart, and its exit code follows the XML only, so every
`<summary status="…"/>` in it has to read `valid`. To run it locally, with
Docker:

```bash
pnpm --filter @saasicat/invoice-zugferd build
node packages/invoice-zugferd/scripts/write-samples.mjs samples
curl -sfLO https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/2.26.0/Mustang-CLI-2.26.0.jar
docker run --rm -v "$PWD:/m" eclipse-temurin:21-jre \
    java -jar /m/Mustang-CLI-2.26.0.jar --action validate --source /m/samples/standard.pdf \
    | grep '<summary status='
```

## What this is not

- **Not XRechnung.** An invoice to a German public authority needs the
  XRechnung CIUS and a Leitweg-ID; this renders EN 16931 for business
  customers.
- **Not a full schematron run in the application.** The German adapter checks
  structure and figures at runtime; the full rule set runs in CI.
- **Not the archive or the mail.** Those are ports of their own
  (`InvoiceArchivePort`, `InvoiceMailPort`).

## Next

- [Wire the backend](../../docs/guides/wire-the-backend.md) — where the
  renderer goes, and the footer lines in `config/saas.yaml`.
- [`@saasicat/tax-de`](../tax-de/README.md) — the adapter whose format check
  every rendered file passes.
- [The requirements](../../docs/requirements.md) — `SC-PRIC-093` and
  `SC-PRIC-078`.
