// Whether a rendered invoice is ZUGFeRD in the EN 16931 profile, and says what
// the invoice records. Each case changes one thing about a file that passes,
// and the check names exactly what changed: a renderer is refused for the
// reason it gets wrong, not for a pile of follow-on gaps.

// @requirement SC-PRIC-042 — An invoice is issued in the format its tax adapter requires

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AFRelationship, PDFArray, PDFDict, PDFName, PDFString } from 'pdf-lib';

import { GermanTaxAdapter } from '../dist/index.js';
import { INVOICE, ciiOf, facturXOf, fileUnderAKid, xmpOf } from './support/factur-x.js';

const adapter = new GermanTaxAdapter();
const gapsOf = async (fileOptions, invoice = INVOICE) =>
    adapter.invoiceDocumentGaps(await facturXOf(fileOptions), invoice);

describe('a rendered invoice', () => {
    test('that is ZUGFeRD EN 16931 and says what the invoice records passes', async () => {
        assert.deepEqual(await gapsOf(), []);
    });

    test('that is not a PDF at all is refused as such, and nothing further is read', async () => {
        const notPdf = {
            content: new TextEncoder().encode('<html/>'),
            mediaType: 'application/pdf',
            fileName: 'x.pdf',
        };

        assert.deepEqual(await adapter.invoiceDocumentGaps(notPdf, INVOICE), ['format.pdf']);
        assert.deepEqual(
            await adapter.invoiceDocumentGaps(
                { ...(await facturXOf()), mediaType: 'text/html' },
                INVOICE,
            ),
            ['format.mediaType'],
        );
    });
});

describe('the container', () => {
    for (const [what, options, gaps] of [
        ['without PDF/A-3 in its metadata', { xmp: xmpOf({ part: '1' }) }, ['format.pdfa3']],
        [
            'without the Factur-X profile in its metadata',
            { xmp: xmpOf({ level: 'BASIC' }) },
            ['format.facturX'],
        ],
        [
            'naming another embedded file in its metadata',
            { xmp: xmpOf({ fileName: 'zugferd-invoice.xml' }) },
            ['format.facturX'],
        ],
        ['without any metadata', { xmp: null }, ['format.pdfa3', 'format.facturX']],
        [
            'declaring its PDF/A part twice, once as 3',
            {
                xmp: xmpOf().replace(
                    '<pdfaid:part>3</pdfaid:part>',
                    '<pdfaid:part>3</pdfaid:part><pdfaid:part>1</pdfaid:part>',
                ),
            },
            ['format.pdfa3'],
        ],
        ['without the embedded XML', { xml: null }, ['format.embeddedXml']],
        ['with the XML under another name', { attachedAs: 'invoice.xml' }, ['format.embeddedXml']],
        [
            'with the XML as mere data rather than the alternative',
            { relationship: AFRelationship.Data },
            ['format.relationship'],
        ],
        [
            'with the XML attached under no relationship',
            { relationship: null },
            ['format.relationship'],
        ],
        [
            'with XML that is not well-formed',
            { xml: '<rsm:CrossIndustryInvoice><unclosed>' },
            ['xml.wellFormed'],
        ],
        [
            'with XML holding a character XML forbids, a form feed in a name',
            { xml: ciiOf(INVOICE, { buyerName: `${INVOICE.subscriber.legalName}\f` }) },
            ['xml.wellFormed'],
        ],
    ]) {
        test(`${what} is refused`, async () => {
            assert.deepEqual(await gapsOf(options), gaps);
        });
    }
});

/** The embedded files' name tree of `pdf`, and the specification of the one file in it. */
function embeddedFilesOf(pdf) {
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
    const tree = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    const spec = tree.lookup(PDFName.of('Names'), PDFArray).lookup(1, PDFDict);
    return { tree, spec };
}

// A writer that puts another type where the format expects one is refused for
// that part, held and recorded — never a check that throws and counts as a run
// that failed.
describe('a container written with the wrong types', () => {
    for (const [what, reshape, gaps] of [
        [
            'naming its relationship as a string rather than a name',
            (pdf) =>
                embeddedFilesOf(pdf).spec.set(
                    PDFName.of('AFRelationship'),
                    PDFString.of('Alternative'),
                ),
            ['format.relationship'],
        ],
        [
            'whose embedded file is no stream',
            (pdf) =>
                embeddedFilesOf(pdf)
                    .spec.lookup(PDFName.of('EF'), PDFDict)
                    .set(PDFName.of('F'), pdf.context.obj({ Type: 'EmbeddedFile' })),
            ['format.embeddedXml'],
        ],
        [
            'whose metadata is no stream',
            (pdf) => pdf.catalog.set(PDFName.of('Metadata'), pdf.context.obj({ Type: 'Metadata' })),
            ['format.pdfa3', 'format.facturX'],
        ],
        [
            'whose metadata is encoded by a filter that cannot be undone',
            (pdf) =>
                pdf.catalog
                    .lookup(PDFName.of('Metadata'))
                    .dict.set(PDFName.of('Filter'), PDFName.of('JBIG2Decode')),
            ['format.pdfa3', 'format.facturX'],
        ],
        [
            'whose name tree leads back to itself',
            (pdf) => {
                const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
                const { tree } = embeddedFilesOf(pdf);
                // Filed by reference, so a kid can refer to it.
                const self = pdf.context.register(tree);
                names.set(PDFName.of('EmbeddedFiles'), self);
                tree.delete(PDFName.of('Names'));
                tree.set(PDFName.of('Kids'), pdf.context.obj([self]));
            },
            ['format.embeddedXml'],
        ],
    ]) {
        test(`${what} is refused for it`, async () => {
            assert.deepEqual(await gapsOf({ reshape }), gaps);
        });
    }
});

describe('the embedded XML', () => {
    const differing = (overrides) => ({ xml: ciiOf(INVOICE, overrides) });

    for (const [what, overrides, gap] of [
        ['in another profile', { profile: 'urn:factur-x.eu:1p0:basic' }, 'xml.profile'],
        ['as a credit note', { typeCode: '381' }, 'xml.typeCode'],
        ['under another number', { number: 'AHP-2026-000124' }, 'xml.number'],
        ['on another issue date', { issueDate: '20260202' }, 'xml.issueDate'],
        ['due on another day', { dueDate: '20260301' }, 'xml.dueDate'],
        ['for another period', { periodUntil: '20260301' }, 'xml.servicePeriod'],
        ['in another currency', { currency: 'CHF' }, 'xml.currency'],
        ['naming another seller', { sellerName: 'AutohausPro GmbH' }, 'xml.seller.name'],
        ["with another seller's VAT id", { sellerVatId: 'DE999999999' }, 'xml.seller.vatId'],
        [
            "with another seller's tax number",
            { sellerTaxNumber: '99/999/99999' },
            'xml.seller.taxNumber',
        ],
        ['naming another buyer', { buyerName: 'Autohaus Meier GmbH' }, 'xml.buyer.name'],
        [
            "with a buyer's VAT id the invoice does not record",
            { buyerVatId: 'DE999999999' },
            'xml.buyer.vatId',
        ],
        ['with another tax at the rate', { taxes: [{ rate: 19, net: 49, tax: 9.3 }] }, 'xml.taxes'],
        ['at another rate', { taxes: [{ rate: 7, net: 49, tax: 9.31 }] }, 'xml.taxes'],
        ['with a line too few', { lines: [53.9] }, 'xml.lines'],
        ['with a line of another amount', { lines: [53.9, -4.8] }, 'xml.lines'],
        ['with a line at another rate', { lineRates: [19, 7] }, 'xml.lines'],
        ['with a line that states no rate', { lineRates: [19, null] }, 'xml.lines'],
        ['with a line of two VAT breakdowns', { lineRates: [[19, 7], 19] }, 'xml.lines'],
        ['with a line of no VAT breakdown', { lineRates: [[], 19] }, 'xml.lines'],
        [
            'naming a second VAT id for the seller',
            { sellerVatId: ['DE123456789', 'DE999999999'] },
            'xml.seller.vatId',
        ],
    ]) {
        test(`${what} is refused`, async () => {
            assert.deepEqual(await gapsOf(differing(overrides)), [gap]);
        });
    }

    test('stating what the format gives once twice, once as the invoice records it, is refused', async () => {
        const xml = ciiOf(INVOICE);
        const twice = (once, again) => xml.replace(once, `${once}${again}`);

        assert.deepEqual(
            await gapsOf({
                xml: twice('<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>381</ram:TypeCode>'),
            }),
            ['xml.typeCode'],
        );
        assert.deepEqual(
            await gapsOf({
                xml: twice(
                    '</ram:SellerTradeParty>',
                    '<ram:SellerTradeParty><ram:Name>AutohausPro GmbH</ram:Name></ram:SellerTradeParty>',
                ),
            }),
            ['xml.seller.name', 'xml.seller.vatId', 'xml.seller.taxNumber'],
        );
    });

    test('stating 58.30 where the invoice is 58.31 is refused, wherever in the totals it says so', async () => {
        for (const overrides of [
            { totalGross: 58.3 },
            { duePayable: 58.3 },
            { totalTax: 9.3 },
            { totalNet: 48.99 },
        ]) {
            assert.deepEqual(
                await gapsOf(differing(overrides)),
                ['xml.totals'],
                JSON.stringify(overrides),
            );
        }
    });

    test('stating a total as nothing, or as no number, is refused', async () => {
        for (const totalGross of ['', 'n/a']) {
            assert.deepEqual(await gapsOf(differing({ totalGross })), ['xml.totals'], totalGross);
        }
    });

    test('stating a day in another format than 102 is refused', async () => {
        for (const issueDate of ['2026-02-01', '2026020X']) {
            assert.deepEqual(await gapsOf(differing({ issueDate })), ['xml.issueDate'], issueDate);
        }
    });

    test('that holds nothing but its root names everything the invoice records as missing', async () => {
        const xml =
            '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';

        assert.deepEqual(await gapsOf({ xml }), [
            'xml.profile',
            'xml.typeCode',
            'xml.number',
            'xml.issueDate',
            'xml.dueDate',
            'xml.servicePeriod',
            'xml.currency',
            'xml.seller.name',
            'xml.seller.vatId',
            'xml.seller.taxNumber',
            'xml.buyer.name',
            'xml.taxes',
            'xml.totals',
            'xml.lines',
        ]);
    });

    test('filed in a kid of the name tree, its name a literal string, is found and passes', async () => {
        assert.deepEqual(await gapsOf({ reshape: fileUnderAKid }), []);
    });

    describe("the buyer's VAT id", () => {
        const recorded = {
            ...INVOICE,
            subscriber: { ...INVOICE.subscriber, vatId: 'DE111111111' },
        };
        const reverseCharge = {
            ...recorded,
            subscriber: { ...recorded.subscriber, vatId: 'ATU12345678', country: 'AT' },
            taxTreatment: {
                ...INVOICE.taxTreatment,
                kind: 'reverse-charge',
                rate: 0,
                note: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) / Reverse charge',
            },
            taxes: [{ rate: 0, net: 49, tax: 0 }],
            totalTax: 0,
            totalGross: 49,
            lines: INVOICE.lines.map((line) => ({ ...line, taxRate: 0 })),
        };

        test('the invoice records one: stated as recorded, or left out, passes', async () => {
            assert.deepEqual(await gapsOf({ xml: ciiOf(recorded) }, recorded), []);
            assert.deepEqual(
                await gapsOf({ xml: ciiOf(recorded, { buyerVatId: null }) }, recorded),
                [],
            );
        });

        test('under the reverse charge, stated as recorded passes', async () => {
            assert.deepEqual(await gapsOf({ xml: ciiOf(reverseCharge) }, reverseCharge), []);
        });

        test('under the reverse charge, left out, another one, or a second one is refused', async () => {
            for (const buyerVatId of [null, 'ATU99999999', ['ATU12345678', 'ATU99999999']]) {
                assert.deepEqual(
                    await gapsOf({ xml: ciiOf(reverseCharge, { buyerVatId }) }, reverseCharge),
                    ['xml.buyer.vatId'],
                    String(buyerVatId),
                );
            }
        });
    });

    describe('outside the scope of VAT', () => {
        const notTaxable = {
            ...INVOICE,
            subscriber: { ...INVOICE.subscriber, vatId: 'CHE-123.456.789', country: 'CH' },
            taxTreatment: {
                ...INVOICE.taxTreatment,
                kind: 'not-taxable',
                rate: 0,
                note: 'Nicht im Inland steuerbare Leistung / Service not taxable in Germany',
            },
            taxes: [{ rate: 0, net: 49, tax: 0 }],
            totalTax: 0,
            totalGross: 49,
        };
        const outside = (overrides = {}) =>
            ciiOf(notTaxable, {
                sellerVatId: null,
                buyerVatId: null,
                taxes: [{ rate: null, net: 49, tax: 0 }],
                lineRates: [null, null],
                ...overrides,
            });

        test('names no VAT id and states no rate, as EN 16931 asks, and passes', async () => {
            assert.deepEqual(await gapsOf({ xml: outside() }, notTaxable), []);
        });

        test('naming the seller’s VAT id is refused (BR-O-02)', async () => {
            const xml = outside({ sellerVatId: notTaxable.issuer.vatId });

            assert.deepEqual(await gapsOf({ xml }, notTaxable), ['xml.seller.vatId']);
        });

        test('naming the buyer’s VAT id is refused (BR-O-02)', async () => {
            const xml = outside({ buyerVatId: notTaxable.subscriber.vatId });

            assert.deepEqual(await gapsOf({ xml }, notTaxable), ['xml.buyer.vatId']);
        });

        test('stating a rate is refused (BR-O-05)', async () => {
            const xml = outside({ taxes: [{ rate: 0, net: 49, tax: 0 }] });

            assert.deepEqual(await gapsOf({ xml }, notTaxable), ['xml.taxes']);
        });

        test('stating a rate on a line is refused (BR-O-05)', async () => {
            const xml = outside({ lineRates: [0, null] });

            assert.deepEqual(await gapsOf({ xml }, notTaxable), ['xml.lines']);
        });

        test('stating a rate on a line in a second VAT breakdown is refused (BR-O-05)', async () => {
            const xml = outside({ lineRates: [[null, 0], null] });

            assert.deepEqual(await gapsOf({ xml }, notTaxable), ['xml.lines']);
        });
    });

    test('of an issuer without a tax number may leave the registration out', async () => {
        const invoice = { ...INVOICE, issuer: { ...INVOICE.issuer, taxNumber: null } };

        assert.deepEqual(await gapsOf({ xml: ciiOf(invoice) }, invoice), []);
    });

    test('of an issuer with a tax number must carry it', async () => {
        const without = { ...INVOICE, issuer: { ...INVOICE.issuer, taxNumber: null } };

        assert.deepEqual(await gapsOf({ xml: ciiOf(without) }, INVOICE), ['xml.seller.taxNumber']);
    });
});
