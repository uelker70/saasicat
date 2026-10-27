// The invoice register's export as of a stated moment: which moment it may be
// as of, what it holds as of that moment — invoices issued, settlements and
// cancellations recorded, documents archived by then —, and the files it is
// written to, in either language, the same bytes every time.

// @requirement SC-ADM-043

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    CALENDAR_DAY_PATTERN,
    CALENDAR_MONTH_PATTERN,
    INVOICE_ERROR_CODES,
    INVOICE_EXPORT_FORMAT_VERSION,
    INVOICE_EXPORT_LOCALES,
    INVOICE_EXPORT_SETTLE_MS,
    INVOICE_SETTLEMENT_KINDS,
    TAX_TREATMENT_KINDS,
    invoiceExportAsOfOf,
    invoiceExportFileNameOf,
    invoiceExportFilesOf,
    invoiceExportManifestOf,
    invoiceExportOf,
    isLocalMoment,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';
const at = (iso) => new Date(iso);
const SPAN = { from: '2026-07', until: '2026-09' };

const PARTY = {
    customerNumber: 'K-10001',
    legalName: 'Northwind GmbH',
    vatId: 'DE123456789',
    taxNumber: null,
    addressLine1: 'Hauptstraße 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};
const STANDARD = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: 'tax-de', version: '1' },
};

/** An invoice issued at `issuedAt`, with one line of `net` and what it corrects, if anything. */
function invoiceOf(id, number, issuedAt, { net = 100, correction = null, lines } = {}) {
    const issueDate = issuedAt.slice(0, 10);
    return {
        id,
        number,
        issuedAt: at(issuedAt),
        issueDate,
        dueDate: issueDate,
        servicePeriodFrom: issueDate,
        servicePeriodUntil: issueDate,
        currency: 'EUR',
        totalNet: net,
        totalTax: Math.round(net * 19) / 100,
        totalGross: Math.round(net * 119) / 100,
        taxTreatment: STANDARD,
        subscriberId: 's-1',
        tenantId: 't-1',
        subscriber: PARTY,
        correction,
        lines: lines ?? [
            {
                id: `${id}-line-1`,
                invoiceId: id,
                position: 1,
                title: 'Pro',
                origin: 'renewal',
                source: 'plan',
                periodFrom: issueDate,
                periodUntil: issueDate,
                amountNet: net,
                taxRate: 19,
                correctedPosition: null,
            },
        ],
    };
}

const settlementOf = (id, invoiceId, kind, amount, recordedAt, extra = {}) => ({
    id,
    invoiceId,
    kind,
    amount,
    recordedAt: at(recordedAt),
    payment: { id: `p-${id}`, provider: 'stripe', gatewayAccount: 'main', gatewayRef: `pi_${id}` },
    reversal: null,
    cancellationId: null,
    ...extra,
});

const exportOf = (source, asOf = '2026-10-27T12:00:00.000Z') =>
    invoiceExportOf({ span: SPAN, asOf: at(asOf), timeZone: BERLIN, source });

describe('the moment an export is as of', () => {
    const now = at('2026-10-27T13:00:00.700Z');

    test('is five minutes before the request where none is asked for, to the whole second', () => {
        const { asOf } = invoiceExportAsOfOf(undefined, now, BERLIN);

        assert.equal(INVOICE_EXPORT_SETTLE_MS, 300_000);
        assert.equal(asOf.toISOString(), '2026-10-27T12:55:00.000Z');
    });

    test('is the one asked for on a clock of the installation’s zone, up to that latest moment', () => {
        assert.equal(
            invoiceExportAsOfOf('2026-10-27T13:55:00', now, BERLIN).asOf.toISOString(),
            '2026-10-27T12:55:00.000Z',
        );
        assert.equal(
            invoiceExportAsOfOf('2026-09-30T23:59:59', now, BERLIN).asOf.toISOString(),
            '2026-09-30T21:59:59.000Z',
        );
    });

    test('is refused a second after that latest moment, naming both', () => {
        assert.deepEqual(invoiceExportAsOfOf('2026-10-27T13:55:01', now, BERLIN), {
            asOf: null,
            refusal: {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE,
                params: { asOf: '2026-10-27T13:55:01', latest: '2026-10-27T13:55:00' },
            },
        });
    });

    test('that is no day and time is refused rather than guessed', () => {
        assert.throws(() => invoiceExportAsOfOf('2026-10-27', now, BERLIN), RangeError);
        assert.throws(() => invoiceExportAsOfOf('2026-02-30T10:00', now, BERLIN), RangeError);
    });

    test('that a clock shows twice is the first of the two, and one it skips the moment it jumps to', () => {
        const later = at('2027-01-01T00:00:00.000Z');
        assert.equal(
            invoiceExportAsOfOf('2026-10-25T02:30:00', later, BERLIN).asOf.toISOString(),
            '2026-10-25T00:30:00.000Z',
        );
        assert.equal(
            invoiceExportAsOfOf('2026-03-29T02:30:00', later, BERLIN).asOf.toISOString(),
            '2026-03-29T01:00:00.000Z',
        );
    });

    for (const [text, is] of [
        ['2026-10-27T00:00', true],
        ['2026-10-27T23:59:59', true],
        ['2026-10-27T24:00', false],
        ['2026-10-27T23:60', false],
        ['2026-10-27T23:59:60', false],
        ['2024-02-29T10:00', true],
        ['2026-02-29T10:00', false],
        ['1000-01-01T00:00', true],
        ['0999-12-31T23:59', false],
        ['2026-10-27T10', false],
        ['2026-10-27 10:00', false],
    ]) {
        test(`${text} is ${is ? '' : 'not '}a day and a time`, () => {
            assert.equal(isLocalMoment(text), is);
        });
    }
});

// The types are generated from the schema, so a kind the schema lacks fails the
// build; one it has beyond what core writes would pass it and let a reader's
// validation accept a value no export holds.
describe('the schema an export is published under', () => {
    const schema = JSON.parse(
        readFileSync(
            new URL('../../spec/schemas/invoice-export.schema.json', import.meta.url),
            'utf8',
        ),
    );
    const manifest = schema.$defs.InvoiceExportManifest;

    test('names the tax treatments, settlement kinds and languages core writes, no more', () => {
        assert.deepEqual(schema.$defs.InvoiceExportTaxTreatment.enum, [...TAX_TREATMENT_KINDS]);
        assert.deepEqual(schema.$defs.InvoiceExportSettlementKind.enum, [
            ...INVOICE_SETTLEMENT_KINDS,
        ]);
        assert.deepEqual(manifest.properties.locale.enum, [...INVOICE_EXPORT_LOCALES]);
    });

    test('names the format version core writes, in the export and in its manifest', () => {
        assert.equal(schema.properties.formatVersion.const, INVOICE_EXPORT_FORMAT_VERSION);
        assert.equal(manifest.properties.formatVersion.const, INVOICE_EXPORT_FORMAT_VERSION);
    });

    test('takes a day and a month in the shapes core reads them', () => {
        assert.equal(schema.$defs.InvoiceExportDay.pattern, CALENDAR_DAY_PATTERN.source);
        for (const bound of ['from', 'until']) {
            assert.equal(
                schema.$defs.InvoiceExportPeriod.properties[bound].pattern,
                CALENDAR_MONTH_PATTERN.source,
            );
        }
    });
});

describe('an export as of a moment', () => {
    const july = invoiceOf('i-1', 'AHP-2026-000001', '2026-07-01T05:00:00.000Z');
    const august = invoiceOf('i-2', 'AHP-2026-000002', '2026-08-01T05:00:00.000Z');
    const lateIssued = invoiceOf('i-3', 'AHP-2026-000003', '2026-09-30T05:00:00.000Z');

    test('holds the invoices issued by then, by issue date and number, each with its party and treatment', () => {
        const exported = exportOf(
            {
                invoices: [
                    { invoice: july, cancelledBy: null },
                    { invoice: lateIssued, cancelledBy: null },
                ],
                cancellations: [],
                settlements: [],
                documents: [],
            },
            '2026-09-30T04:59:59.000Z',
        );

        assert.deepEqual(
            exported.invoices.map(({ number }) => number),
            ['AHP-2026-000001'],
        );
        assert.deepEqual(exported.invoices[0], {
            invoiceId: 'i-1',
            number: 'AHP-2026-000001',
            kind: 'invoice',
            corrects: null,
            issueDate: '2026-07-01',
            issuedAt: '2026-07-01T05:00:00.000Z',
            dueDate: '2026-07-01',
            servicePeriodFrom: '2026-07-01',
            servicePeriodUntil: '2026-07-01',
            currency: 'EUR',
            totalNet: 100,
            totalTax: 19,
            totalGross: 119,
            taxTreatment: 'standard',
            taxRate: 19,
            taxNote: null,
            subscriberId: 's-1',
            tenantId: 't-1',
            ...PARTY,
            cancelledBy: null,
            cancelledAt: null,
            documentChecksum: null,
            documentArchivedAt: null,
            documentFileName: null,
        });
        assert.deepEqual(
            [exported.asOf, exported.asOfLocal, exported.timeZone, exported.period],
            ['2026-09-30T04:59:59.000Z', '2026-09-30T06:59:59', BERLIN, SPAN],
        );
    });

    test('holds the settlements recorded by then, the period over too, and none recorded later', () => {
        const exported = exportOf(
            {
                invoices: [{ invoice: july, cancelledBy: null }],
                cancellations: [],
                settlements: [
                    settlementOf('st-3', 'i-1', 'PAYMENT', 19, '2026-10-27T12:00:00.001Z'),
                    settlementOf('st-2', 'i-1', 'REVERSAL', 100, '2026-10-27T12:00:00.000Z', {
                        reversal: { id: 'r-1', gatewayRef: 'du_1' },
                    }),
                    settlementOf('st-1', 'i-1', 'PAYMENT', 100, '2026-07-02T08:00:00.000Z'),
                ],
                documents: [],
            },
            '2026-10-27T12:00:00.000Z',
        );

        assert.deepEqual(
            exported.settlements.map(
                ({ settlementId, kind, amount, recordedAt, reversalReference }) => [
                    settlementId,
                    kind,
                    amount,
                    recordedAt,
                    reversalReference,
                ],
            ),
            [
                ['st-1', 'PAYMENT', 100, '2026-07-02T08:00:00.000Z', null],
                ['st-2', 'REVERSAL', 100, '2026-10-27T12:00:00.000Z', 'du_1'],
            ],
        );
        assert.deepEqual(exported.settlements[0], {
            settlementId: 'st-1',
            invoiceId: 'i-1',
            invoiceNumber: 'AHP-2026-000001',
            kind: 'PAYMENT',
            amount: 100,
            currency: 'EUR',
            recordedAt: '2026-07-02T08:00:00.000Z',
            paymentId: 'p-st-1',
            provider: 'stripe',
            gatewayAccount: 'main',
            paymentReference: 'pi_st-1',
            reversalReference: null,
            cancellationOf: null,
        });
    });

    test('names a cancellation recorded by then, its invoice issued after the period too, and none recorded later', () => {
        const cancellation = {
            id: 'c-1',
            cancelledInvoiceId: 'i-1',
            cancellationInvoiceId: 'i-9',
            replacementInvoiceId: 'i-10',
            reason: 'Wrong address',
            correctedSubscriber: null,
            deliverTo: null,
            cancelledBy: 'operator:op-1',
            cancelledAt: at('2026-11-02T09:00:00.000Z'),
        };
        const source = {
            invoices: [
                { invoice: july, cancelledBy: { invoiceId: 'i-9', number: 'AHP-2026-000009' } },
            ],
            cancellations: [cancellation],
            settlements: [],
            documents: [],
        };

        const before = exportOf(source, '2026-11-02T08:59:59.000Z');
        const after = exportOf(source, '2026-11-02T09:00:00.000Z');

        assert.deepEqual(
            [before.invoices[0].cancelledBy, before.invoices[0].cancelledAt],
            [null, null],
        );
        assert.deepEqual(
            [after.invoices[0].cancelledBy, after.invoices[0].cancelledAt],
            ['AHP-2026-000009', '2026-11-02T09:00:00.000Z'],
        );
    });

    test('names what a cancellation invoice and a replacement correct, and the cancellation a moved settlement came from', () => {
        const cancelling = invoiceOf('i-9', 'AHP-2026-000009', '2026-09-02T09:00:00.000Z', {
            net: -100,
            correction: {
                kind: 'cancellation',
                of: { invoiceId: 'i-0', number: 'AHP-2025-000099', issueDate: '2025-12-01' },
            },
        });
        const replacing = invoiceOf('i-10', 'AHP-2026-000010', '2026-09-02T09:00:00.000Z', {
            correction: {
                kind: 'replacement',
                of: { invoiceId: 'i-0', number: 'AHP-2025-000099', issueDate: '2025-12-01' },
            },
        });
        const exported = exportOf({
            invoices: [
                { invoice: cancelling, cancelledBy: null },
                { invoice: replacing, cancelledBy: null },
            ],
            cancellations: [
                {
                    id: 'c-0',
                    cancelledInvoiceId: 'i-0',
                    cancellationInvoiceId: 'i-9',
                    replacementInvoiceId: 'i-10',
                    reason: 'Wrong plan',
                    correctedSubscriber: null,
                    deliverTo: null,
                    cancelledBy: 'operator:op-1',
                    cancelledAt: at('2026-09-02T09:00:00.000Z'),
                },
            ],
            settlements: [
                settlementOf('st-9', 'i-10', 'MOVED_IN', 50, '2026-09-02T09:00:00.000Z', {
                    cancellationId: 'c-0',
                }),
            ],
            documents: [],
        });

        assert.deepEqual(
            exported.invoices.map(({ number, kind, corrects, totalNet }) => [
                number,
                kind,
                corrects,
                totalNet,
            ]),
            [
                ['AHP-2026-000009', 'cancellation', 'AHP-2025-000099', -100],
                ['AHP-2026-000010', 'replacement', 'AHP-2025-000099', 100],
            ],
        );
        assert.equal(exported.settlements[0].cancellationOf, 'AHP-2025-000099');
    });

    test('names a document’s checksum where the archive confirmed it by then, and none where later or never', () => {
        const document = (invoiceId, archivedAt) => ({
            invoiceId,
            checksum: `sha-${invoiceId}`,
            mediaType: 'application/pdf',
            fileName: `${invoiceId}.pdf`,
            size: 1,
            renderedAt: at('2026-07-01T05:00:00.000Z'),
            archivedAt: archivedAt && at(archivedAt),
            deliveryClaimedAt: null,
            deliveredAt: null,
            deliveredTo: null,
        });

        const exported = exportOf({
            invoices: [
                { invoice: july, cancelledBy: null },
                { invoice: august, cancelledBy: null },
            ],
            cancellations: [],
            settlements: [],
            documents: [
                document('i-1', '2026-07-01T05:01:00.000Z'),
                document('i-2', '2026-10-27T12:00:00.001Z'),
            ],
        });

        assert.deepEqual(
            exported.invoices.map(({ documentChecksum, documentArchivedAt, documentFileName }) => [
                documentChecksum,
                documentArchivedAt,
                documentFileName,
            ]),
            [
                ['sha-i-1', '2026-07-01T05:01:00.000Z', 'i-1.pdf'],
                [null, null, null],
            ],
        );
    });

    test('lists each invoice’s lines by position with the invoice’s treatment, and a settlement for no listed invoice not at all', () => {
        const twoLines = invoiceOf('i-4', 'AHP-2026-000004', '2026-08-15T05:00:00.000Z', {
            lines: [2, 1].map((position) => ({
                id: `l-${position}`,
                invoiceId: 'i-4',
                position,
                title: position === 1 ? 'Pro' : 'SMS',
                origin: 'renewal',
                source: position === 1 ? 'plan' : 'bundle',
                periodFrom: '2026-08-01',
                periodUntil: '2026-08-31',
                amountNet: 10 * position,
                taxRate: 19,
                correctedPosition: null,
            })),
        });

        const exported = exportOf({
            invoices: [{ invoice: twoLines, cancelledBy: null }],
            cancellations: [],
            settlements: [
                settlementOf('st-x', 'i-elsewhere', 'PAYMENT', 1, '2026-08-16T00:00:00.000Z'),
            ],
            documents: [],
        });

        assert.deepEqual(
            exported.lines.map(({ position, title, taxTreatment }) => [
                position,
                title,
                taxTreatment,
            ]),
            [
                [1, 'Pro', 'standard'],
                [2, 'SMS', 'standard'],
            ],
        );
        assert.deepEqual(exported.settlements, []);
    });

    test('is the same however the store happened to hand the settlements', () => {
        const settlements = [
            settlementOf('st-b', 'i-1', 'PAYMENT', 50, '2026-07-02T08:00:00.000Z'),
            settlementOf('st-a', 'i-1', 'PAYMENT', 50, '2026-07-02T08:00:00.000Z'),
        ];
        const source = (list) => ({
            invoices: [{ invoice: july, cancelledBy: null }],
            cancellations: [],
            settlements: list,
            documents: [],
        });

        assert.deepEqual(
            exportOf(source(settlements)),
            exportOf(source([...settlements].reverse())),
        );
        assert.deepEqual(
            exportOf(source(settlements)).settlements.map(({ settlementId }) => settlementId),
            ['st-a', 'st-b'],
        );
    });
});

describe('the files an export is written to', () => {
    const awkward = invoiceOf('i-1', 'AHP-2026-000001', '2026-07-01T05:00:00.000Z', {
        net: 1234.5,
    });
    const exported = exportOf({
        invoices: [
            {
                invoice: {
                    ...awkward,
                    subscriber: {
                        ...PARTY,
                        legalName: '=HYPERLINK("x"); Müller, "GmbH"',
                        addressLine2: '-2. Etage\nHinterhaus',
                    },
                },
                cancelledBy: null,
            },
        ],
        cancellations: [],
        settlements: [settlementOf('st-1', 'i-1', 'REVERSAL', 1469.06, '2026-07-02T08:00:00.000Z')],
        documents: [],
    });
    const named = (files, name) => files.find((file) => file.name === name).content;

    test('are the three tables and export.json, in that order', () => {
        assert.deepEqual(
            invoiceExportFilesOf(exported, 'de').map(({ name }) => name),
            ['invoices.csv', 'lines.csv', 'settlements.csv', 'export.json'],
        );
    });

    for (const [locale, delimiter, amount] of [
        ['de', ';', '1234,50'],
        ['en', ',', '1234.50'],
    ]) {
        test(`in ${locale}: separated by ${delimiter}, amounts as ${amount}, a byte order mark first and CRLF after each row`, () => {
            const csv = named(invoiceExportFilesOf(exported, locale), 'invoices.csv');
            const [header, row] = csv.slice(1).split('\r\n');

            assert.equal(csv[0], '﻿');
            assert.ok(csv.endsWith('\r\n'));
            assert.ok(
                header.startsWith(['invoiceId', 'number', 'kind', 'corrects'].join(delimiter)),
            );
            assert.ok(row.includes(`${delimiter}${amount}${delimiter}`), row);
        });
    }

    test('defuse a text cell a spreadsheet would read as a formula, and quote what holds a separator, a quote or a line break', () => {
        const csv = named(invoiceExportFilesOf(exported, 'de'), 'invoices.csv');

        assert.ok(csv.includes(`"'=HYPERLINK(""x""); Müller, ""GmbH"""`), 'the legal name');
        assert.ok(csv.includes(`"'-2. Etage\nHinterhaus"`), 'the second address line');
    });

    test('write an amount as a number, never defused, and a missing value as an empty cell', () => {
        const settlements = named(invoiceExportFilesOf(exported, 'en'), 'settlements.csv');
        const cancelling = exportOf({
            invoices: [
                {
                    invoice: invoiceOf('i-9', 'AHP-2026-000009', '2026-08-01T05:00:00.000Z', {
                        net: -100,
                        correction: {
                            kind: 'cancellation',
                            of: {
                                invoiceId: 'i-1',
                                number: 'AHP-2026-000001',
                                issueDate: '2026-07-01',
                            },
                        },
                    }),
                    cancelledBy: null,
                },
            ],
            cancellations: [],
            settlements: [],
            documents: [],
        });
        const negative = named(invoiceExportFilesOf(cancelling, 'en'), 'invoices.csv');

        assert.ok(settlements.includes(',1469.06,'), settlements);
        assert.ok(negative.includes(',-100.00,-19.00,-119.00,'), negative);
        assert.ok(
            settlements.split('\r\n')[1].endsWith(',,'),
            'no reversal reference and no cancellation',
        );
    });

    test('write export.json from the same model, the same text every time', () => {
        const json = named(invoiceExportFilesOf(exported, 'de'), 'export.json');

        assert.equal(json, `${JSON.stringify(exported, null, 2)}\n`);
        assert.deepEqual(JSON.parse(json), exported);
        assert.deepEqual(
            invoiceExportFilesOf(exported, 'de'),
            invoiceExportFilesOf(exported, 'de'),
        );
    });

    test('are named in a manifest with the period, the moment, the notation, the counts and every file as measured', () => {
        const files = [{ name: 'invoices.csv', bytes: 12, sha256: 'abc' }];

        assert.deepEqual(invoiceExportManifestOf(exported, 'de', files), {
            formatVersion: 1,
            period: SPAN,
            asOf: '2026-10-27T12:00:00.000Z',
            asOfLocal: '2026-10-27T13:00:00',
            timeZone: BERLIN,
            locale: 'de',
            csv: {
                delimiter: ';',
                decimalSeparator: ',',
                encoding: 'UTF-8, with a byte order mark',
                lineEnding: 'CRLF',
            },
            counts: { invoices: 1, lines: 1, settlements: 1 },
            files,
        });
    });

    test('are archived under the period and the moment, with nothing a file system refuses', () => {
        assert.equal(
            invoiceExportFileNameOf(exported),
            'invoices-2026-07-2026-09-as-of-2026-10-27T13-00-00.zip',
        );
    });
});
