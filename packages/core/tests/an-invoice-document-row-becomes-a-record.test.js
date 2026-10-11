// An invoice's document as either adapter reads it back: where it stands, and
// the archived file. A checksum, a size or a file of the wrong shape fails here,
// loudly, rather than reaching a download as a document nobody can check.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    INVOICE_ARCHIVE_TRIGGERS,
    invoiceArchiveProtectionProblem,
    isInvoiceDocumentChecksum,
    toArchivedInvoiceDocument,
    toSubscriptionInvoiceDocumentRecord,
} from '../dist/index.js';

const CHECKSUM = '0123456789abcdef'.repeat(4);
const AT = new Date('2026-02-01T05:30:00.000Z');

const documentRow = (overrides = {}) => ({
    invoiceId: 'invoice-1',
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'AHP-2026-000001.pdf',
    size: 2048,
    renderedAt: AT,
    archivedAt: AT,
    deliveryClaimedAt: null,
    deliveredAt: null,
    deliveredTo: null,
    ...overrides,
});

const archiveRow = (overrides = {}) => ({
    invoiceId: 'invoice-1',
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'AHP-2026-000001.pdf',
    content: new Uint8Array([0, 1, 255]),
    archivedAt: AT,
    ...overrides,
});

describe('a checksum as the platform records one', () => {
    for (const [what, value, expected] of [
        ['64 lower-case hex digits', CHECKSUM, true],
        ['63 of them', CHECKSUM.slice(1), false],
        ['65 of them', `${CHECKSUM}0`, false],
        ['upper-case hex', CHECKSUM.toUpperCase(), false],
        ['a letter beyond f', `${CHECKSUM.slice(1)}g`, false],
        ['empty', '', false],
        ['not text', 42, false],
    ]) {
        test(`${what}: ${expected ? 'is one' : 'is not'}`, () => {
            assert.equal(isInvoiceDocumentChecksum(value), expected);
        });
    }
});

describe('where an invoice’s document stands', () => {
    test('is read as it was written, its size as a number', () => {
        assert.deepEqual(toSubscriptionInvoiceDocumentRecord(documentRow({ size: 2048n })), {
            ...documentRow(),
            size: 2048,
        });
    });

    test('of no bytes is a size like any other', () => {
        assert.equal(toSubscriptionInvoiceDocumentRecord(documentRow({ size: 0 })).size, 0);
    });

    for (const [what, overrides, pattern] of [
        ['a checksum of another shape', { checksum: 'abc' }, /checksum of invoice-1/],
        ['a negative size', { size: -1 }, /size of invoice-1/],
        ['a fractional size', { size: 1.5 }, /size of invoice-1/],
        ['a size that is no number', { size: 'large' }, /size of invoice-1/],
    ]) {
        test(`with ${what} fails`, () => {
            assert.throws(
                () => toSubscriptionInvoiceDocumentRecord(documentRow(overrides)),
                pattern,
            );
        });
    }
});

describe('an archived file', () => {
    test('is read with bytes of its own, not a view into the driver’s buffer', () => {
        const pool = Buffer.from([9, 0, 1, 255, 9]);
        const row = archiveRow({ content: pool.subarray(1, 4) });

        const archived = toArchivedInvoiceDocument(row);
        pool[1] = 7;

        assert.deepEqual(archived.content, new Uint8Array([0, 1, 255]));
        assert.equal(archived.content.byteOffset, 0);
        assert.equal(archived.content.buffer.byteLength, 3);
    });

    test('with a checksum of another shape fails', () => {
        assert.throws(
            () => toArchivedInvoiceDocument(archiveRow({ checksum: CHECKSUM.toUpperCase() })),
            /subscription_invoice_archive\.checksum of invoice-1/,
        );
    });

    test('that is no file fails', () => {
        assert.throws(
            () => toArchivedInvoiceDocument(archiveRow({ content: 'bytes' })),
            /content of invoice-1 is not a file/,
        );
    });
});

// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
describe('the database archive', () => {
    const [kept, notEmptied] = INVOICE_ARCHIVE_TRIGGERS;

    test('with both of its triggers enabled keeps what it holds', () => {
        assert.equal(invoiceArchiveProtectionProblem([notEmptied, 'audit_trigger', kept]), null);
    });

    for (const [what, enabled, missing] of [
        ['with neither', [], [kept, notEmptied]],
        ['without the one against a truncate', [kept], [notEmptied]],
        ['without the one against an update or a delete', [notEmptied], [kept]],
    ]) {
        test(`${what} names what it lacks, and the file that adds it`, () => {
            const problem = invoiceArchiveProtectionProblem(enabled);

            assert.ok(problem.includes(`lacks ${missing.join(' and ')},`), problem);
            assert.ok(problem.includes('1.0-an-invoice-document-is-archived.postgres.sql'));
        });
    }
});
