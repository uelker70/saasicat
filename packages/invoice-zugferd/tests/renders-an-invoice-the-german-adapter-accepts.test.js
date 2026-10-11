// The default renderer: an issued invoice as ZUGFeRD in the EN 16931 profile,
// for each treatment the German adapter decides, read back the way a person
// and a program read it. Whether the file meets PDF/A-3 and the EN 16931 and
// Factur-X rules is for the format's own validators, which CI runs over the
// same invoices (`scripts/write-samples.mjs`); this suite holds what they do
// not see — what the page says, and that it says the same every time.

// @requirement SC-PRIC-078 — The shipped renderer issues an invoice the format's own validators accept
// @requirement SC-PRIC-042 — An invoice is issued in the format its tax adapter requires

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { GermanTaxAdapter } from '@saasicat/tax-de';

import { ZugferdInvoiceRenderer, zugferdInvoiceRenderer } from '../dist/index.js';
import { SAMPLES } from './support/invoices.js';
import { pageRuns, pageTexts } from './support/page-text.js';

const renderer = zugferdInvoiceRenderer();
const adapter = new GermanTaxAdapter();
const sample = (name) => SAMPLES.find((each) => each.name === name).invoice;
const render = (name) => renderer.render(sample(name));

/** The embedded XML of a rendered file. */
async function embeddedXml(content) {
    const pdf = await PDFDocument.load(content);
    const names = pdf.catalog.lookup(PDFName.of('Names'));
    const tree = names.lookup(PDFName.of('EmbeddedFiles'));
    const spec = tree.lookup(PDFName.of('Names')).lookup(1);
    const stream = spec.lookup(PDFName.of('EF')).lookup(PDFName.of('F'), PDFRawStream);
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
}

describe('an issued invoice rendered by the default renderer', () => {
    for (const { name, invoice } of SAMPLES) {
        test(`(${name}) is the file the German adapter asks for, named by its number`, async () => {
            const document = await renderer.render(invoice);

            assert.deepEqual(await adapter.invoiceDocumentGaps(document, invoice), []);
            assert.equal(document.mediaType, 'application/pdf');
            assert.equal(document.fileName, `${invoice.number}.pdf`);
        });
    }

    test('is the same bytes every time, whatever was rendered in between', async () => {
        const first = await render('standard');
        await render('many-lines');
        const again = await zugferdInvoiceRenderer().render(sample('standard'));

        assert.deepEqual(again.content, first.content);
    });

    test('is dated from the moment the invoice was issued, not the clock', async () => {
        const { content } = await render('standard');
        const pdf = await PDFDocument.load(content, { updateMetadata: false });

        assert.deepEqual(pdf.getCreationDate(), sample('standard').issuedAt);
        assert.deepEqual(pdf.getModificationDate(), sample('standard').issuedAt);
    });

    test('of another invoice is another file, under another identifier', async () => {
        const standard = await render('standard');
        const other = await renderer.render({
            ...sample('standard'),
            id: 'invoice-other',
            number: 'AHP-2026-000124',
        });

        assert.notDeepEqual(other.content, standard.content);
        const idOf = async (content) =>
            (await PDFDocument.load(content)).context.trailerInfo.ID.toString();
        assert.notEqual(await idOf(other.content), await idOf(standard.content));
    });
});

describe('what the page says', () => {
    const unspaced = (text) => text.replaceAll(' ', '');

    test('the parties, the invoice’s facts, its lines and its total, labelled in German and English', async () => {
        const [page] = await pageTexts((await render('standard')).content);

        for (const text of [
            'AutohausPro Software GmbH',
            'USt-IdNr. / VAT ID: DE123456789',
            'Steuernummer / Tax number: 143/123/45678',
            'Autohaus Müller GmbH & Co. KG',
            'Rechnungsnummer / Invoice no.',
            'AHP-2026-000123',
            'Leistungszeitraum / Service period',
            '01.02.2026 – 28.02.2026',
            'K-10001',
            'Fällig am / Due date',
            '15.02.2026',
            'Willkommensrabatt 10 %',
            '-4,90',
            'USt 19 % auf 64,00 / VAT 19 % on 64,00',
            '12,16',
            'Gesamtbetrag / Total (EUR)',
            '76,16',
        ]) {
            assert.ok(page.includes(text), `the page does not say "${text}"`);
        }
    });

    test('the subscriber’s VAT id and its country by name, under the reverse charge', async () => {
        const [page] = await pageTexts((await render('reverse-charge')).content);

        assert.ok(page.includes('USt-IdNr. / VAT ID: ATU12345678'));
        assert.ok(page.includes('ÖSTERREICH'));
        assert.ok(
            page.includes(
                'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) / Reverse charge',
            ),
        );
        assert.ok(!page.some((text) => text.startsWith('USt 0')), 'a rate stood beside no tax');
    });

    test('the footer lines and the page’s number on every page of an invoice that runs on', async () => {
        const invoice = sample('many-lines');
        const pages = await pageTexts((await render('many-lines')).content);

        assert.equal(pages.length, 2);
        pages.forEach((page, index) => {
            for (const text of invoice.footer) assert.ok(page.includes(text), `page ${index + 1}`);
            assert.ok(page.includes(`Seite ${index + 1} von 2 / Page ${index + 1} of 2`));
            assert.ok(page.includes('Netto / Net (EUR)'), 'the table’s head on every page');
        });
        assert.ok(pages[1].includes('435,00'), 'the total after the last line');
    });

    test('a footer line wider than the page, broken onto the next line, on every page', async () => {
        const invoice = sample('widest-footer');
        const pages = await pageTexts((await render('widest-footer')).content);

        assert.ok(pages.length > 1, 'the table did not run on, so no page break was tried');
        pages.forEach((page, index) => {
            const said = unspaced(page.join(''));
            for (const text of invoice.footer) {
                assert.ok(said.includes(unspaced(text)), `page ${index + 1}: ${text}`);
                assert.ok(!page.includes(text), `page ${index + 1} set it on one line`);
            }
        });
    });

    test('a name or an address line wider than its column, all of it, line after line', async () => {
        const { issuer, subscriber } = sample('long-names');
        const [page] = await pageTexts((await render('long-names')).content);
        const said = unspaced(page.join(''));

        for (const text of [
            issuer.legalName,
            issuer.addressLine1,
            subscriber.legalName,
            subscriber.addressLine1,
            subscriber.addressLine2,
        ]) {
            assert.ok(said.includes(unspaced(text)), text);
            assert.ok(!page.includes(text), `set on one line: ${text}`);
        }
    });

    test('no footer where the invoice carries none', async () => {
        const [page] = await pageTexts(
            (await renderer.render({ ...sample('standard'), footer: [] })).content,
        );

        assert.ok(!page.some((text) => text.includes('Amtsgericht')));
        assert.ok(page.includes('Seite 1 von 1 / Page 1 of 1'));
    });

    test('Greek and Cyrillic in their letters, a character its font has no glyph for as ?, and the XML as it was written', async () => {
        const { content } = await render('unusual-characters');
        const [page] = await pageTexts(content);
        const xml = await embeddedXml(content);

        assert.ok(
            page.includes('z. Hd. Γιώργος Παπαδόπουλος / Ольга Иванова'),
            JSON.stringify(page),
        );
        assert.ok(page.includes('???? Müller & Söhne <GmbH>'), JSON.stringify(page));
        assert.ok(page.includes('Ringstraße 1?'), 'a form feed shown as ?');
        assert.ok(xml.includes('<ram:LineOne>Ringstraße 1?</ram:LineOne>'), 'and written as ?');
        assert.ok(!xml.includes('\f'));
        assert.ok(page.includes('Paket „Premium“ – 50 % auf <alles> & mehr ?'));
        assert.ok(xml.includes('<ram:Name>株式会社 Müller &amp; Söhne &lt;GmbH&gt;</ram:Name>'));
    });
});

describe('where the page sets its text', () => {
    const MM = 72 / 25.4;
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    /** DIN 5008: 25 mm from the left edge, 20 mm from the right; the rounding of a right-aligned figure. */
    const MARGIN = { left: 25 * MM, right: A4_WIDTH - 20 * MM, slack: 0.01 };

    /** The box a run of text covers: its advance across, a quarter below its baseline and three above. */
    const boxOf = ({ x, y, size, width }) => ({
        left: x,
        right: x + width,
        bottom: y - size / 4,
        top: y + (size * 3) / 4,
    });
    const overlap = (a, b) =>
        a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;

    for (const { name } of SAMPLES) {
        test(`(${name}) keeps every run of text between the margins, clear of every other`, async () => {
            const pages = await pageRuns((await render(name)).content);

            pages.forEach((runs, index) => {
                const outside = runs
                    .filter(
                        (run) =>
                            run.x < MARGIN.left - MARGIN.slack ||
                            run.x + run.width > MARGIN.right + MARGIN.slack ||
                            run.y - run.size / 4 < 0,
                    )
                    .map((run) => run.text);
                assert.deepEqual(outside, [], `page ${index + 1}`);

                const boxes = runs.map((run) => ({ text: run.text, ...boxOf(run) }));
                const crowded = boxes.flatMap((box, at) =>
                    boxes
                        .slice(at + 1)
                        .filter((other) => overlap(box, other))
                        .map((other) => `${box.text} | ${other.text}`),
                );
                assert.deepEqual(crowded, [], `page ${index + 1}`);
            });
        });

        test(`(${name}) leaves 5 mm at least between the foot and the text above it`, async () => {
            const pages = await pageRuns((await render(name)).content);

            pages.forEach((runs, index) => {
                // The foot: the page number and the footer lines, set at 7 points in the lower half.
                const inFoot = (run) => run.size === 7 && run.y < A4_HEIGHT / 2;
                const footTop = Math.max(...runs.filter(inFoot).map((run) => boxOf(run).top));
                const above = Math.min(
                    ...runs.filter((run) => !inFoot(run)).map((run) => boxOf(run).bottom),
                );

                assert.ok(above - footTop >= 5 * MM, `page ${index + 1}: ${above - footTop} pt`);
            });
        });
    }
});

describe('a figure', () => {
    /** The standard sample with one line of `amount`, its tax at 19 %. */
    const invoiceOf = (amount) => {
        const invoice = sample('standard');
        const tax = Math.round(amount * 19) / 100;
        return {
            ...invoice,
            lines: [{ ...invoice.lines[0], amountNet: amount }],
            taxes: [{ rate: 19, net: amount, tax }],
            totalNet: amount,
            totalTax: tax,
            totalGross: Math.round((amount + tax) * 100) / 100,
        };
    };

    for (const [amount, page, xml] of [
        [0, '0,00', '0.00'],
        [0.01, '0,01', '0.01'],
        [999.99, '999,99', '999.99'],
        [1000, '1.000,00', '1000.00'],
        [1234567.89, '1.234.567,89', '1234567.89'],
    ]) {
        test(`of ${amount} reads ${page} on the page and ${xml} in the XML`, async () => {
            const { content } = await renderer.render(invoiceOf(amount));
            const [text] = await pageTexts(content);

            assert.ok(text.includes(page), JSON.stringify(text));
            assert.ok((await embeddedXml(content)).includes(`<ram:LineTotalAmount>${xml}<`));
        });
    }

    test('taken off at the smallest amount reads -0,01, as one unit taken back at 0.01', async () => {
        const invoice = sample('standard');
        const { content } = await renderer.render({
            ...invoice,
            lines: [...invoice.lines.slice(0, 2), { ...invoice.lines[2], amountNet: -0.01 }],
        });
        const [text] = await pageTexts(content);
        const xml = await embeddedXml(content);

        assert.ok(text.includes('-0,01'));
        assert.ok(xml.includes('<ram:ChargeAmount>0.01</ram:ChargeAmount>'));
        assert.ok(xml.includes('<ram:LineTotalAmount>-0.01</ram:LineTotalAmount>'));
    });
});

describe('the XML it carries', () => {
    test('takes a line off as one unit taken back at a price that is not negative', async () => {
        const xml = await embeddedXml((await render('standard')).content);

        assert.ok(
            xml.includes(
                '<ram:ChargeAmount>4.90</ram:ChargeAmount></ram:NetPriceProductTradePrice>',
            ),
        );
        assert.ok(xml.includes('<ram:BilledQuantity unitCode="C62">-1</ram:BilledQuantity>'));
        assert.ok(xml.includes('<ram:LineTotalAmount>-4.90</ram:LineTotalAmount>'));
    });

    test('names the categories and reasons EN 16931 asks for each treatment', async () => {
        const categories = {};
        for (const name of ['standard', 'small-business', 'reverse-charge', 'not-taxable']) {
            const xml = await embeddedXml((await render(name)).content);
            const at = xml.indexOf('<ram:CategoryCode>');
            categories[name] = xml.slice(at + 18, xml.indexOf('<', at + 18));
        }

        assert.deepEqual(categories, {
            standard: 'S',
            'small-business': 'E',
            'reverse-charge': 'AE',
            'not-taxable': 'O',
        });
    });

    test('outside the scope of VAT, names no VAT id and no rate, and identifies the seller otherwise', async () => {
        const xml = await embeddedXml((await render('not-taxable')).content);

        assert.ok(!xml.includes('schemeID="VA"'));
        assert.ok(!xml.includes('RateApplicablePercent'));
        assert.ok(xml.includes('<ram:SellerTradeParty><ram:ID>DE123456789</ram:ID>'));
        assert.ok(
            xml.includes(
                '<ram:ExemptionReason>Nicht im Inland steuerbare Leistung / Service not taxable in Germany</ram:ExemptionReason>',
            ),
        );
    });

    test('of a small business with a tax number only, identifies the seller by it', async () => {
        const xml = await embeddedXml((await render('small-business-tax-number-only')).content);

        assert.ok(xml.includes('<ram:SellerTradeParty><ram:ID>143/123/45678</ram:ID>'));
        assert.ok(xml.includes('<ram:ID schemeID="FC">143/123/45678</ram:ID>'));
    });

    test('under the reverse charge, names both VAT ids', async () => {
        const xml = await embeddedXml((await render('reverse-charge')).content);

        assert.ok(xml.includes('<ram:ID schemeID="VA">DE123456789</ram:ID>'));
        assert.ok(xml.includes('<ram:ID schemeID="VA">ATU12345678</ram:ID>'));
    });
});

describe('a font the application passes', () => {
    test('is the one the page is set in', async () => {
        const bold = await readFile(new URL('../fonts/Roboto-Bold.ttf', import.meta.url));
        const boldOnly = new ZugferdInvoiceRenderer({ fonts: { regular: bold, bold } });

        const own = await boldOnly.render(sample('standard'));
        const shipped = await render('standard');

        assert.notDeepEqual(own.content, shipped.content);
        assert.deepEqual(await adapter.invoiceDocumentGaps(own, sample('standard')), []);
    });
});
