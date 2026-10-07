// What an invoice of an issuer in Germany has to carry, and how its tax is
// computed. The content is checked before the invoice's number is drawn, so a
// gap is named as the field to fill in; the tax is computed once per rate, the
// rule ZUGFeRD computes it by.

// @requirement SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it
// @requirement SC-PRIC-041 — An invoice computes its tax once per rate, by the rule its tax adapter names

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GermanTaxAdapter } from '../dist/index.js';

const adapter = new GermanTaxAdapter();

const ISSUER = {
    legalName: 'AutohausPro.de GbR',
    vatId: 'DE123456789',
    taxNumber: '12/345/67890',
    addressLine1: 'Hauptstraße 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};
const SUBSCRIBER = {
    legalName: 'Autohaus Wien GmbH',
    vatId: 'ATU12345678',
    taxNumber: null,
    addressLine1: 'Ringstraße 1',
    addressLine2: null,
    postalCode: '1010',
    city: 'Wien',
    country: 'AT',
};
const treatment = (kind, note = null) => ({
    kind,
    rate: kind === 'standard' ? 19 : 0,
    note,
    adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
});

/** A complete draft, with `changes` laid over it. */
function draft(changes = {}) {
    return {
        issuer: { ...ISSUER, ...changes.issuer },
        subscriber: { ...SUBSCRIBER, ...changes.subscriber },
        treatment: changes.treatment ?? treatment('standard'),
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        servicePeriod: { from: '2026-10-01', until: '2026-10-31' },
        lines: changes.lines ?? [{ title: 'Paket Standard', net: 49, rate: 19 }],
    };
}

describe('what an invoice of an issuer in Germany has to carry', () => {
    test('a complete invoice lacks nothing', () => {
        assert.deepEqual(adapter.invoiceContentGaps(draft()), []);
    });

    for (const side of ['issuer', 'subscriber']) {
        for (const field of ['addressLine1', 'postalCode', 'city', 'country']) {
            test(`the ${side}'s ${field}, missing or blank, is named`, () => {
                assert.deepEqual(adapter.invoiceContentGaps(draft({ [side]: { [field]: null } })), [
                    `${side}.${field}`,
                ]);
                assert.deepEqual(adapter.invoiceContentGaps(draft({ [side]: { [field]: '  ' } })), [
                    `${side}.${field}`,
                ]);
            });
        }
        test(`the ${side}'s second address line may be missing`, () => {
            assert.deepEqual(
                adapter.invoiceContentGaps(draft({ [side]: { addressLine2: null } })),
                [],
            );
        });
    }

    test("the issuer's tax number or its VAT number — either is enough, neither is a gap", () => {
        assert.deepEqual(adapter.invoiceContentGaps(draft({ issuer: { vatId: null } })), []);
        assert.deepEqual(adapter.invoiceContentGaps(draft({ issuer: { taxNumber: null } })), []);
        assert.deepEqual(
            adapter.invoiceContentGaps(draft({ issuer: { taxNumber: null, vatId: null } })),
            ['issuer.taxIdentifier'],
        );
    });

    test("the reverse charge names both parties' VAT numbers, and its note", () => {
        const reverseCharge = treatment(
            'reverse-charge',
            'Steuerschuldnerschaft des Leistungsempfängers',
        );
        assert.deepEqual(adapter.invoiceContentGaps(draft({ treatment: reverseCharge })), []);
        assert.deepEqual(
            adapter.invoiceContentGaps(
                draft({
                    treatment: reverseCharge,
                    issuer: { vatId: null },
                    subscriber: { vatId: null },
                }),
            ),
            ['issuer.vatId', 'subscriber.vatId'],
        );
    });

    test('a standard invoice asks for no VAT number of the subscriber', () => {
        assert.deepEqual(adapter.invoiceContentGaps(draft({ subscriber: { vatId: null } })), []);
    });

    for (const kind of ['reverse-charge', 'not-taxable', 'small-business']) {
        test(`a ${kind} invoice says why it carries no German VAT`, () => {
            assert.deepEqual(
                adapter.invoiceContentGaps(draft({ treatment: treatment(kind, 'why') })),
                [],
            );
            assert.deepEqual(
                adapter.invoiceContentGaps(draft({ treatment: treatment(kind, null) })),
                ['treatment.note'],
            );
        });
    }

    test('an invoice without lines, or with a line nobody named, is not complete', () => {
        assert.deepEqual(adapter.invoiceContentGaps(draft({ lines: [] })), ['lines']);
        assert.deepEqual(
            adapter.invoiceContentGaps(draft({ lines: [{ title: ' ', net: 49, rate: 19 }] })),
            ['lines.title'],
        );
    });

    test('every gap is named, in the order an invoice reads', () => {
        assert.deepEqual(
            adapter.invoiceContentGaps(
                draft({
                    issuer: { city: null, taxNumber: null, vatId: null },
                    subscriber: { postalCode: null },
                    lines: [],
                }),
            ),
            ['issuer.city', 'issuer.taxIdentifier', 'subscriber.postalCode', 'lines'],
        );
    });
});

describe("an invoice's tax, once per rate", () => {
    test('is the rate applied to the net total, not the sum of the lines’ rounded taxes', () => {
        const lines = Array.from({ length: 10 }, () => ({ net: 12.34, rate: 19 }));

        assert.deepEqual(adapter.invoiceTax(lines), {
            rates: [{ rate: 19, net: 123.4, tax: 23.45 }],
            net: 123.4,
            tax: 23.45,
            gross: 146.85,
        });
    });

    test('keeps each rate apart, the lowest first, and a discount lowers its rate’s net', () => {
        assert.deepEqual(
            adapter.invoiceTax([
                { net: 49, rate: 19 },
                { net: 10, rate: 7 },
                { net: -9.8, rate: 19 },
            ]),
            {
                rates: [
                    { rate: 7, net: 10, tax: 0.7 },
                    { rate: 19, net: 39.2, tax: 7.45 },
                ],
                net: 49.2,
                tax: 8.15,
                gross: 57.35,
            },
        );
    });
});
