// Whether an invoice's file says it is a test exactly where the invoice was
// issued in a test operation: its XML states the notice of a test operation as
// the first note of the document (BT-22), in German and in English, and the
// XML of an invoice issued live states it in no note. The check reads the XML
// whichever renderer wrote it, so an application's own renderer is held to it
// too; the page it prints is not read here.

// @requirement SC-AUD-024 — Every document issued in a test operation says it is one

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_OPERATION_NOTICE } from '@saasicat/core';

import { GermanTaxAdapter } from '../dist/index.js';
import { INVOICE, ciiOf, facturXOf } from './support/factur-x.js';

const adapter = new GermanTaxAdapter();
const { de, en } = TEST_OPERATION_NOTICE.invoice;
const NOTICE = `${de} / ${en}`;
const OTHER_NOTE = 'Leistungszeitraum Februar 2026 / Service period February 2026';

const IN_A_TEST_OPERATION = { ...INVOICE, testOperation: true };

/** The gaps the adapter finds in the file of `invoice` whose XML states `notes`. */
const gapsWith = async (invoice, notes) =>
    adapter.invoiceDocumentGaps(await facturXOf({ xml: ciiOf(invoice, { notes }) }), invoice);

describe('the file of an invoice issued in a test operation', () => {
    test('stating the notice as its first note passes', async () => {
        assert.deepEqual(await gapsWith(IN_A_TEST_OPERATION, [NOTICE]), []);
        assert.deepEqual(await gapsWith(IN_A_TEST_OPERATION, [NOTICE, OTHER_NOTE]), []);
    });

    for (const [what, notes] of [
        ['stating no note at all', []],
        ['stating another note only', [OTHER_NOTE]],
        ['stating the notice after another note', [OTHER_NOTE, NOTICE]],
        ['stating its German half alone', [de]],
        ['stating its English half alone', [en]],
    ]) {
        test(`${what} is refused`, async () => {
            assert.deepEqual(await gapsWith(IN_A_TEST_OPERATION, notes), ['xml.testOperation']);
        });
    }
});

describe('the file of an invoice issued live', () => {
    test('stating no note, or another one, passes', async () => {
        assert.deepEqual(await gapsWith(INVOICE, []), []);
        assert.deepEqual(await gapsWith(INVOICE, [OTHER_NOTE]), []);
    });

    for (const [what, notes] of [
        ['stating the notice', [NOTICE]],
        ['stating the notice after another note', [OTHER_NOTE, NOTICE]],
        ['stating its German half in a note', [`Hinweis: ${de}`]],
        ['stating its English half in a note', [`Note: ${en}`]],
    ]) {
        test(`${what} is refused`, async () => {
            assert.deepEqual(await gapsWith(INVOICE, notes), ['xml.testOperation']);
        });
    }
});
