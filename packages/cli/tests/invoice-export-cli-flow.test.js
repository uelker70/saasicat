// `<app> invoices export`, as an operator runs it to hand a tax advisor the
// invoices of a span of months as of a moment: the archive written where it is
// asked to be and never over another file, the operator recorded in the audit
// log, and the exit code a script sees when it is refused.
//
// The export itself is `@saasicat/nest`'s and tested there. Here it is stood in
// for, so that a test can tell what the command asked for, what it passed on,
// what it wrote and recorded, and what it printed.

// @requirement SC-ADM-047 — The invoice register's export is one archive whose bytes repeat

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UnprocessableEntityException } from '@nestjs/common';

import { InvoiceExportCliFlow, InvoicesExportCommand } from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

const FILE_NAME = 'invoices-2026-01-2026-12-as-of-2027-01-15T10-00-00-de.zip';
const ARCHIVE = {
    fileName: FILE_NAME,
    content: Buffer.from('the archive'),
    sha256: 'a'.repeat(64),
    manifest: {
        formatVersion: 1,
        period: { from: '2026-01', until: '2026-12' },
        asOf: '2027-01-15T09:00:00.000Z',
        asOfLocal: '2027-01-15T10:00:00',
        timeZone: 'Europe/Berlin',
        locale: 'de',
        csv: {
            delimiter: ';',
            decimalSeparator: ',',
            encoding: 'UTF-8, with a byte order mark',
            lineEnding: 'CRLF',
        },
        counts: { invoices: 120, lines: 130, settlements: 118 },
        files: [],
    },
};
const OPTIONS = { from: '2026-01', until: '2026-12', asOf: '2027-01-15T10:00', locale: 'de' };

function setUp({ refusal = null } = {}) {
    const asked = [];
    const exports = {
        async export(request) {
            asked.push(request);
            if (refusal) throw refusal;
            return ARCHIVE;
        },
    };
    const ctx = recordingContext();
    const out = mkdtempSync(join(tmpdir(), 'invoice-export-'));
    return { ctx, asked, out, flow: new InvoiceExportCliFlow(ctx, exports) };
}

describe('an export the command writes', () => {
    test('is the archive the export hands, under its name in --out, asking for no second factor or confirmation', async () => {
        const { flow, ctx, out } = setUp();

        const exported = await flow.export({ ...OPTIONS, out });

        assert.equal(exported.path, join(out, FILE_NAME));
        assert.deepEqual(readFileSync(exported.path), ARCHIVE.content);
        assert.deepEqual(ctx.asked, ['identity', 'super-admin', 'audit']);
    });

    test('passes the months, the moment and the language on as typed, and nothing where none is given', async () => {
        const { flow, asked, out } = setUp();

        await flow.export({ ...OPTIONS, out });
        await flow.export({ out: mkdtempSync(join(tmpdir(), 'invoice-export-')) });

        assert.deepEqual(asked, [
            OPTIONS,
            { from: undefined, until: undefined, asOf: undefined, locale: undefined },
        ]);
    });

    test('is written into the current directory where no --out is given', async () => {
        const { flow, out } = setUp();
        const before = process.cwd();
        process.chdir(out);
        try {
            const exported = await flow.export(OPTIONS);

            assert.equal(exported.path, FILE_NAME);
            assert.deepEqual(readdirSync(out), [FILE_NAME]);
        } finally {
            process.chdir(before);
        }
    });

    test('is recorded in the audit log under the operator, with the months, the moment and its SHA-256', async () => {
        const { flow, ctx, out } = setUp();

        await flow.export({ ...OPTIONS, out });

        assert.deepEqual(ctx.logged, [
            {
                identity: {
                    email: 'ops@example.com',
                    host: 'deploy-host',
                    actor: 'cli:ops@example.com:deploy-host',
                },
                userId: 'user-ops',
                entity: 'SubscriptionInvoiceExport',
                entityId: ARCHIVE.sha256,
                action: 'SUBSCRIPTION_INVOICES_EXPORTED',
                changes: {
                    from: '2026-01',
                    until: '2026-12',
                    asOf: '2027-01-15T09:00:00.000Z',
                    asOfLocal: '2027-01-15T10:00:00',
                    timeZone: 'Europe/Berlin',
                    locale: 'de',
                    fileName: FILE_NAME,
                    bytes: ARCHIVE.content.byteLength,
                    sha256: ARCHIVE.sha256,
                    invoices: 120,
                    lines: 130,
                    settlements: 118,
                },
            },
        ]);
    });
});

describe('an export the command refuses', () => {
    for (const [why, options, code] of [
        ['a month that is none', { from: '2026-13' }, 'INVOICE_EXPORT_MONTH_INVALID'],
        ['a last month that is none', { until: '2026-1' }, 'INVOICE_EXPORT_MONTH_INVALID'],
        [
            'a midnight written as 24:00',
            { asOf: '2027-01-15T24:00' },
            'INVOICE_EXPORT_AS_OF_INVALID',
        ],
        ['a day without a time', { asOf: '2027-01-15' }, 'INVOICE_EXPORT_AS_OF_INVALID'],
        ['a language it does not write', { locale: 'fr' }, 'INVOICE_EXPORT_LOCALE_INVALID'],
    ]) {
        test(`for ${why}, with exit code 1, before it asks who acts`, async () => {
            const { flow, ctx, asked, out } = setUp();

            const error = await cliErrorOf(() => flow.export({ ...options, out }));

            assert.deepEqual([error.code, error.exitCode], [code, 1]);
            assert.deepEqual([ctx.asked, asked, readdirSync(out)], [[], [], []]);
        });
    }

    test('as the route does, with the export’s code and exit code 1, writing nothing', async () => {
        const { flow, ctx, out } = setUp({
            refusal: new UnprocessableEntityException({
                code: 'SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE',
                message: 'The export can be as of 2027-01-15T09:55:00 at the latest.',
            }),
        });

        const error = await cliErrorOf(() => flow.export({ ...OPTIONS, out }));

        assert.deepEqual(
            [error.code, error.exitCode, error.message],
            [
                'SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE',
                1,
                'The export can be as of 2027-01-15T09:55:00 at the latest.',
            ],
        );
        assert.deepEqual([ctx.logged, readdirSync(out)], [[], []]);
    });

    test('over a file of its name, with exit code 6, leaving the file as it was and recording nothing', async () => {
        const { flow, ctx, out } = setUp();
        writeFileSync(join(out, FILE_NAME), 'handed over before');

        const error = await cliErrorOf(() => flow.export({ ...OPTIONS, out }));

        assert.deepEqual([error.code, error.exitCode], ['INVOICE_EXPORT_FILE_EXISTS', 6]);
        assert.equal(readFileSync(join(out, FILE_NAME), 'utf8'), 'handed over before');
        assert.deepEqual(ctx.logged, []);
    });
});

// The command stands in for the flow's I/O, so nothing the test runner writes to
// stdout between two events lands in what the command printed.
async function aCommand() {
    const { flow, out } = setUp();
    const exported = await flow.export({ ...OPTIONS, out });
    const passed = [];
    const command = new InvoicesExportCommand({
        export: async (flags) => {
            passed.push(flags);
            return exported;
        },
        formatExported: (each) => flow.formatExported(each),
    });
    return { command, exported, passed, out };
}

describe('the command', () => {
    test('prints where it wrote the archive, what it holds and its SHA-256', async () => {
        const { command, passed, out } = await aCommand();

        const text = await printed(command, { ...OPTIONS, out });

        assert.deepEqual(passed, [{ ...OPTIONS, out }]);
        assert.equal(
            text,
            [
                `Wrote ${join(out, FILE_NAME)}: the invoices of 2026-01 to 2026-12 as of ` +
                    '2027-01-15T10:00:00 (Europe/Berlin).',
                'Invoices 120, lines 130, settlements 118; 11 bytes.',
                `SHA-256 ${'a'.repeat(64)}`,
                '',
            ].join('\n'),
        );
    });

    test('prints the same as JSON with -o json', async () => {
        const { command, out } = await aCommand();

        const text = await printed(command, { ...OPTIONS, out, output: 'json' });

        assert.deepEqual(JSON.parse(text), {
            path: join(out, FILE_NAME),
            sha256: ARCHIVE.sha256,
            bytes: 11,
            manifest: ARCHIVE.manifest,
        });
    });
});
