// The export the invoices page asks for: the months the register shows, the
// moment the operator names or none, and the language of the tables — the
// screen's unless picked —, the archive handed to the browser as it arrived and
// a refusal left to the dialog that asked.

// @requirement SC-ADM-043

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ref } from 'vue';

import { invoiceExportLocaleOf, useInvoiceExport } from '../dist/vue/index.js';

const FILE = { content: Uint8Array.from([1, 2]), mediaType: 'application/zip', fileName: 'x.zip' };

/** An export over the months `from` and `until`, recording what it asked and what it saved. */
function anExport({ from = '2026-01', until = '2026-12', screen = 'de', refusal = null } = {}) {
    const asked = [];
    const saved = [];
    const flow = useInvoiceExport(
        {
            export: async (query) => {
                asked.push(query);
                if (refusal) throw refusal;
                return FILE;
            },
        },
        { from: ref(from), until: ref(until) },
        ref(screen),
        { save: (file) => saved.push(file) },
    );
    return { flow, asked, saved };
}

describe('what an export starts from', () => {
    test('is five minutes ago, in the screen’s language', () => {
        assert.deepEqual(anExport().flow.draft(), { asOf: '', locale: 'de' });
    });

    for (const [screen, locale] of [
        ['de', 'de'],
        ['de-AT', 'de'],
        ['en-GB', 'en'],
        ['fr', 'en'],
        ['deu', 'en'],
    ]) {
        test(`on a screen in ${screen} writes the tables in ${locale}`, () => {
            assert.equal(invoiceExportLocaleOf(screen), locale);
        });
    }
});

describe('the moment an export may be asked as of', () => {
    for (const [asOf, valid] of [
        ['', true],
        ['2027-01-15T10:00', true],
        ['2027-01-15T10:00:59', true],
        ['2027-01-15T24:00', false],
        ['2027-02-30T10:00', false],
        ['2027-01-15', false],
    ]) {
        test(`${JSON.stringify(asOf)} is ${valid ? '' : 'not '}one`, () => {
            assert.equal(anExport().flow.isValid({ asOf, locale: 'de' }), valid);
        });
    }
});

describe('an export downloaded', () => {
    test('asks for the register’s months as of the moment, in the language picked, and saves what came', async () => {
        const { flow, asked, saved } = anExport();

        const file = await flow.download({ asOf: '2027-01-15T10:00', locale: 'en' });

        assert.deepEqual(asked, [
            { from: '2026-01', until: '2026-12', asOf: '2027-01-15T10:00', locale: 'en' },
        ]);
        assert.deepEqual([file, saved], [FILE, [FILE]]);
    });

    test('asks for no month and no moment where the inputs are empty', async () => {
        const { flow, asked } = anExport({ from: '', until: '' });

        await flow.download({ asOf: '', locale: 'de' });

        assert.deepEqual(asked, [
            { from: undefined, until: undefined, asOf: undefined, locale: 'de' },
        ]);
    });

    test('that is refused throws the refusal and saves nothing', async () => {
        const refusal = new Error('too late');
        const { flow, saved } = anExport({ refusal });

        await assert.rejects(flow.download({ asOf: '', locale: 'de' }), refusal);
        assert.deepEqual(saved, []);
    });
});
