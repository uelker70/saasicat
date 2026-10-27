// The operator hands the invoices of a span of months to a tax advisor as of a
// moment: one ZIP with the three tables, `export.json` and a manifest naming
// every file's SHA-256, the same bytes whenever the same months are asked for as
// of the same moment, and a record in the audit log of who took which archive.
// Asked through the platform as an application composes it, so what is asserted
// is what the route serves, in the frame it runs in.

// @requirement SC-ADM-043

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

import 'reflect-metadata';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INVOICE_ERROR_CODES, localMomentInZone } from '@saasicat/core';
import { invoiceExportSchema } from '@saasicat/spec';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    ZONE,
    aRegisterPlatform,
    anInstallation,
    throughThePipe,
} from './helpers/invoice-register.js';
import { invoicingPlatform } from './helpers/invoicing-platform.js';
import { MemorySubscriberPayments } from './helpers/subscriber-payments.js';

const EXPORT_ROUTE = 'GET admin/invoice-export';
const EXPORTED = 'SUBSCRIPTION_INVOICES_EXPORTED';
const FILES = ['invoices.csv', 'lines.csv', 'settlements.csv', 'export.json', 'manifest.json'];
/** The operator behind the request, as a JWT names them. */
const REQUEST = { user: { sub: 'operator-1', email: 'anna@example.com' }, headers: {} };
/** February 2026, as of 12:34:59 on the 20th in Berlin. */
const FEBRUARY = { from: '2026-02', until: '2026-02', asOf: '2026-02-20T12:34:59' };

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The bytes of the file the route answers, and the headers it answers them with. */
async function downloaded(file) {
    const chunks = [];
    for await (const chunk of file.getStream()) chunks.push(chunk);
    return { bytes: Buffer.concat(chunks), headers: file.getHeaders() };
}

/** A DOS date and time, read back into a clock's reading. */
const dosMomentOf = (date, time) =>
    [
        `${(date >> 9) + 1980}-${String((date >> 5) & 15).padStart(2, '0')}-` +
            String(date & 31).padStart(2, '0'),
        [time >> 11, (time >> 5) & 63, (time & 31) * 2]
            .map((part) => String(part).padStart(2, '0'))
            .join(':'),
    ].join('T');

/**
 * The entries of `zip`, read as the ZIP application note lays an archive out:
 * the end record names the directory, each directory entry its local header,
 * and the bytes after that header carry the CRC-32 both name.
 */
function entriesOf(zip) {
    const end = zip.length - 22;
    assert.equal(zip.readUInt32LE(end), 0x06054b50, 'the archive ends with its end record');
    const count = zip.readUInt16LE(end + 10);
    const directoryBytes = zip.readUInt32LE(end + 12);
    let at = zip.readUInt32LE(end + 16);
    assert.equal(at + directoryBytes, end, 'the directory ends where the end record begins');
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        assert.equal(zip.readUInt32LE(at), 0x02014b50, 'a directory entry');
        const nameBytes = zip.readUInt16LE(at + 28);
        const name = zip.toString('utf8', at + 46, at + 46 + nameBytes);
        const offset = zip.readUInt32LE(at + 42);
        assert.equal(zip.readUInt32LE(offset), 0x04034b50, `${name} has a local header`);
        const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
        const content = zip.subarray(start, start + zip.readUInt32LE(at + 24));
        assert.equal(crc32(content), zip.readUInt32LE(at + 16), `${name} carries its CRC-32`);
        assert.equal(zip.readUInt32LE(offset + 14), zip.readUInt32LE(at + 16));
        entries.push({
            name,
            method: zip.readUInt16LE(at + 10),
            moment: dosMomentOf(zip.readUInt16LE(at + 14), zip.readUInt16LE(at + 12)),
            localMoment: dosMomentOf(zip.readUInt16LE(offset + 12), zip.readUInt16LE(offset + 10)),
            content,
        });
        at += 46 + nameBytes + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    return entries;
}

const fileOf = (entries, name) => entries.find((entry) => entry.name === name).content;
const jsonOf = (entries, name) => JSON.parse(fileOf(entries, name).toString('utf8'));

/**
 * An installation with February's invoices: one paid on the 11th and archived,
 * one cancelled on the 15th, and what the collections recorded of them.
 */
async function aFebruary() {
    const installation = anInstallation();
    const { store } = installation;
    const payments = new MemorySubscriberPayments(store.invoices, store.cancellations);
    const paid = await installation.issue('2026-02-10');
    await installation.archive(paid);
    const cancelled = await installation.issue('2026-02-12', { tenantId: 't2' });
    const cancellation = await installation.cancel(cancelled, '2026-02-15');
    const pay = (invoice, at, gatewayRef) =>
        payments.recordPayment({
            invoiceId: invoice.id,
            collectionId: `attempt-${invoice.id}`,
            gatewayAccount: 'stripe-main',
            provider: 'stripe',
            gatewayRef,
            amount: invoice.totalGross,
            currency: 'EUR',
            at,
        });
    await pay(paid, new Date('2026-02-11T10:00:00.000Z'), 'pi_paid');
    return { installation, payments, paid, cancelled, cancellation, pay };
}

/** The platform serving the export of `installation`, recording its reads and the audit log. */
async function anExporter(installation, { payments = null, through = false } = {}) {
    const written = [];
    const platform = await aRegisterPlatform(installation, {
        through,
        payments,
        written,
        reads: ['listIssued', 'listCancellations', 'findDocuments', 'listSettlements'],
    });
    const call = platform.call(EXPORT_ROUTE);
    return {
        ...platform,
        written,
        exported: async (query) => downloaded(await call(query, REQUEST)),
    };
}

describe('the archive an export is handed over as', () => {
    test('holds the three tables, export.json and the manifest last, each stored and named with its size and SHA-256', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const entries = entriesOf((await exporter.exported(FEBRUARY)).bytes);
        const manifest = jsonOf(entries, 'manifest.json');

        assert.deepEqual(
            entries.map(({ name }) => name),
            FILES,
        );
        assert.ok(
            entries.every(({ method }) => method === 0),
            'every file is stored',
        );
        assert.deepEqual(
            manifest.files,
            entries.slice(0, -1).map(({ name, content }) => ({
                name,
                bytes: content.byteLength,
                sha256: sha256Of(content),
            })),
        );
        assert.deepEqual(
            [manifest.period, manifest.asOfLocal, manifest.timeZone, manifest.locale],
            [{ from: '2026-02', until: '2026-02' }, FEBRUARY.asOf, ZONE, 'en'],
        );
        await exporter.moduleRef.close();
    });

    test('is written as the schema @saasicat/spec publishes it says, export.json and manifest.json alike', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });
        const ajv = new Ajv2020({ strict: true, allErrors: true });
        addFormats.default(ajv);
        ajv.addSchema(invoiceExportSchema);
        const id = invoiceExportSchema.$id;

        const entries = entriesOf((await exporter.exported(FEBRUARY)).bytes);
        const exported = jsonOf(entries, 'export.json');

        // The fixture reaches the nullable columns from both sides.
        assert.deepEqual(
            exported.invoices.map((row) => [row.kind, row.cancelledBy === null]),
            [
                ['invoice', true],
                ['invoice', false],
                ['cancellation', true],
            ],
        );
        for (const [file, schema] of [
            ['export.json', id],
            ['manifest.json', `${id}#/$defs/InvoiceExportManifest`],
        ]) {
            const validate = ajv.getSchema(schema);
            assert.ok(validate(jsonOf(entries, file)), JSON.stringify(validate.errors));
        }
        await exporter.moduleRef.close();
    });

    test('dates every file the moment it is as of, as a clock in the installation’s zone shows it, in two-second steps', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const entries = entriesOf((await exporter.exported(FEBRUARY)).bytes);

        for (const { name, moment, localMoment } of entries) {
            assert.deepEqual([name, moment, localMoment], [name, '2026-02-20T12:34:58', moment]);
        }
        await exporter.moduleRef.close();
    });

    test('dates it 1 January 1980, the earliest a ZIP names, as of a moment before then', async () => {
        const exporter = await anExporter(anInstallation());

        const entries = entriesOf(
            (await exporter.exported({ from: '1979-06', asOf: '1979-06-01T10:00:00' })).bytes,
        );

        assert.deepEqual(jsonOf(entries, 'manifest.json').counts, {
            invoices: 0,
            lines: 0,
            settlements: 0,
        });
        assert.ok(entries.every(({ moment }) => moment === '1980-01-01T00:00:00'));
        await exporter.moduleRef.close();
    });

    test('is downloaded as a ZIP under the months, the moment and the language', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const { bytes, headers } = await exporter.exported(FEBRUARY);

        assert.deepEqual(headers, {
            type: 'application/zip',
            disposition:
                'attachment; filename="invoices-2026-02-2026-02-as-of-2026-02-20T12-34-59-en.zip"',
            length: bytes.byteLength,
        });
        await exporter.moduleRef.close();
    });
});

describe('an export as of a moment', () => {
    test('is the same archive, byte for byte, asked for again after more was recorded', async () => {
        const { installation, payments, pay } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const first = await exporter.exported(FEBRUARY);
        const late = await installation.issue('2026-02-25');
        await pay(late, new Date('2026-02-26T08:00:00.000Z'), 'pi_late');
        const again = await exporter.exported(FEBRUARY);
        const later = await exporter.exported({ ...FEBRUARY, asOf: '2026-02-28T23:00:00' });

        assert.equal(sha256Of(again.bytes), sha256Of(first.bytes));
        assert.deepEqual(jsonOf(entriesOf(later.bytes), 'manifest.json').counts, {
            invoices: 4,
            lines: 4,
            settlements: 2,
        });
        await exporter.moduleRef.close();
    });

    test('in another language writes other tables from the same export.json', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const english = entriesOf((await exporter.exported(FEBRUARY)).bytes);
        const german = entriesOf((await exporter.exported({ ...FEBRUARY, locale: 'de' })).bytes);

        assert.deepEqual(fileOf(german, 'export.json'), fileOf(english, 'export.json'));
        assert.notDeepEqual(fileOf(german, 'invoices.csv'), fileOf(english, 'invoices.csv'));
        assert.equal(jsonOf(german, 'manifest.json').locale, 'de');
        await exporter.moduleRef.close();
    });

    test('lists the settlements recorded by then, each with the payment the gateway reported', async () => {
        const { installation, payments, paid } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const entries = entriesOf((await exporter.exported(FEBRUARY)).bytes);

        assert.deepEqual(
            jsonOf(entries, 'export.json').settlements.map((row) => [
                row.invoiceNumber,
                row.kind,
                row.amount,
                row.recordedAt,
                row.provider,
                row.paymentReference,
            ]),
            [[paid.number, 'PAYMENT', 119, '2026-02-11T10:00:00.000Z', 'stripe', 'pi_paid']],
        );
        await exporter.moduleRef.close();
    });

    test('holds every invoice of the months, however many reads they take', async () => {
        const installation = anInstallation();
        const issued = 1201;
        for (let index = 0; index < issued; index += 1) {
            await installation.issue(`2026-02-${String((index % 28) + 1).padStart(2, '0')}`);
        }
        const exporter = await anExporter(installation);

        const entries = entriesOf(
            (await exporter.exported({ from: '2026-02', asOf: '2026-03-01T00:00:00' })).bytes,
        );
        const numbers = jsonOf(entries, 'export.json').invoices.map((row) => row.number);

        assert.equal(new Set(numbers).size, issued);
        assert.ok(
            exporter.reads.filter(({ name }) => name === 'listIssued').length > 1,
            'the invoices fit one read, so the test reaches no second',
        );
        await exporter.moduleRef.close();
    });

    // @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
    test("is read outside the tenants' row-level policy, every read of it", async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        await exporter.exported(FEBRUARY);

        assert.deepEqual([...new Set(exporter.reads.map(({ name }) => name))].sort(), [
            'findDocuments',
            'listCancellations',
            'listIssued',
            'listSettlements',
        ]);
        assert.ok(exporter.reads.every(({ bypassed }) => bypassed));
        await exporter.moduleRef.close();
    });
});

describe('the audit log', () => {
    test('records who took which archive: the months, the moment, the language, what it holds and its SHA-256', async () => {
        const { installation, payments } = await aFebruary();
        const exporter = await anExporter(installation, { payments });

        const { bytes } = await exporter.exported({ ...FEBRUARY, locale: 'de' });

        assert.deepEqual(exporter.written, [
            {
                actor: {
                    userId: 'operator-1',
                    email: 'anna@example.com',
                    source: 'web',
                    context: 'admin',
                },
                entity: 'SubscriptionInvoiceExport',
                entityId: sha256Of(bytes),
                action: EXPORTED,
                changes: {
                    from: '2026-02',
                    until: '2026-02',
                    asOf: '2026-02-20T11:34:59.000Z',
                    asOfLocal: FEBRUARY.asOf,
                    timeZone: ZONE,
                    locale: 'de',
                    fileName: 'invoices-2026-02-2026-02-as-of-2026-02-20T12-34-59-de.zip',
                    bytes: bytes.byteLength,
                    sha256: sha256Of(bytes),
                    invoices: 3,
                    lines: 3,
                    settlements: 1,
                    actor: 'web:anna@example.com:admin',
                },
            },
        ]);
        await exporter.moduleRef.close();
    });
});

describe('the exports refused', () => {
    for (const [why, query, code] of [
        [
            'as of a moment later than five minutes before the request',
            () => ({ from: '2026-02', asOf: localMomentInZone(new Date(), ZONE) }),
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE,
        ],
        [
            'for months until before from',
            () => ({ from: '2026-03', until: '2026-02' }),
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED,
        ],
    ]) {
        test(`${why}, with its code, nothing read and nothing recorded`, async () => {
            // A bypass that calls through hands the route's answer back as it
            // is, so a refusal thrown rather than rejected would escape here.
            const exporter = await anExporter(anInstallation(), { through: true });

            await assert.rejects(exporter.exported(query()), (error) => {
                assert.ok(error instanceof UnprocessableEntityException);
                assert.equal(error.getResponse().code, code);
                return true;
            });
            assert.deepEqual([exporter.reads, exporter.written], [[], []]);
            await exporter.moduleRef.close();
        });
    }

    test('as of a moment too late, naming the latest one it may be as of', async () => {
        const exporter = await anExporter(anInstallation(), { through: true });
        const asOf = localMomentInZone(new Date(), ZONE);

        await assert.rejects(exporter.exported({ asOf }), (error) => {
            const { params } = error.getResponse();
            assert.equal(params.asOf, asOf);
            assert.ok(params.latest < asOf, `${params.latest} is not before ${asOf}`);
            return true;
        });
        await exporter.moduleRef.close();
    });
});

describe('what the export takes', () => {
    test('two months, a moment and a language, and nothing else', async () => {
        const taken = await throughThePipe(EXPORT_ROUTE, {
            ...FEBRUARY,
            locale: 'de',
            tenant: 't1',
        });

        assert.deepEqual({ ...taken }, { ...FEBRUARY, locale: 'de' });
    });

    test('a moment without its seconds', async () => {
        const taken = await throughThePipe(EXPORT_ROUTE, { asOf: '2026-02-20T12:34' });

        assert.equal(taken.asOf, '2026-02-20T12:34');
    });

    for (const [why, query] of [
        ['a midnight written as 24:00', { asOf: '2026-02-20T24:00' }],
        ['a day the calendar does not have', { asOf: '2026-02-30T10:00' }],
        ['a day without a time', { asOf: '2026-02-20' }],
        ['a language it does not write', { locale: 'fr' }],
        ['a thirteenth month', { from: '2026-13' }],
    ]) {
        test(`refuses ${why}`, async () => {
            await assert.rejects(throughThePipe(EXPORT_ROUTE, query), BadRequestException);
        });
    }
});

test('the manifest names what the export writes to the audit log', async () => {
    const root = SaaSiCatModule.forRoot(invoicingPlatform());
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    try {
        const manifest = await moduleRef.get(AdminManifestService).getManifest();

        assert.ok(manifest.audit.actions.some((action) => action.key === EXPORTED));
    } finally {
        await moduleRef.close();
    }
});
