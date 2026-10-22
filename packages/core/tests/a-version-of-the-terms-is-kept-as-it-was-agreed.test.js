// A version of the operator's terms as either adapter reads it back, how the
// file is recognised as a PDF, what a version may be called, and what the
// archive says about the triggers that keep it.

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    SETTINGS_ERROR_CODES,
    TERMS_ARCHIVE_TRIGGERS,
    TERMS_VERSION_PATTERN,
    bookingAgreementColumns,
    isPdf,
    pendingAgreementColumns,
    toContractAgreement,
    termsArchiveProtectionProblem,
    termsVersionChanged,
    toArchivedTermsVersion,
} from '../dist/index.js';

// Off the sibling package's directory, the way the codegen reads it: the
// schema is what validates `config/saas.yaml`, and the start's check of a
// version handed in as code has to ask the same question.
const planCatalogSchema = JSON.parse(
    readFileSync(new URL('../../spec/schemas/plan-catalog.schema.json', import.meta.url), 'utf8'),
);

const CHECKSUM = '0123456789abcdef'.repeat(4);
const AT = new Date('2026-10-22T08:00:00.000Z');

const termsRow = (overrides = {}) => ({
    version: '2026-10',
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'agb-2026-10.pdf',
    content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255]),
    archivedAt: AT,
    ...overrides,
});

describe('an archived version of the terms', () => {
    test('is read with bytes of its own, not a view into the driver’s buffer', () => {
        const pool = Buffer.from([9, 0x25, 0x50, 0x44, 0x46, 0x2d, 9]);
        const archived = toArchivedTermsVersion(termsRow({ content: pool.subarray(1, 6) }));
        pool[1] = 7;

        assert.deepEqual(
            archived,
            termsRow({ content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) }),
        );
        assert.equal(archived.content.byteOffset, 0);
        assert.equal(archived.content.buffer.byteLength, 5);
    });

    for (const [what, overrides, pattern] of [
        [
            'a checksum of another shape',
            { checksum: CHECKSUM.toUpperCase() },
            /terms_versions\.checksum of 2026-10/,
        ],
        [
            'another kind of file',
            { mediaType: 'text/html' },
            /mediaType of 2026-10 is text\/html, not a PDF/,
        ],
        ['content that is no file', { content: 'bytes' }, /content of 2026-10 is not a file/],
    ]) {
        test(`with ${what} fails`, () => {
            assert.throws(() => toArchivedTermsVersion(termsRow(overrides)), pattern);
        });
    }
});

describe('a PDF is recognised by its first bytes', () => {
    for (const [what, bytes, expected] of [
        ['a PDF', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], true],
        ['the five bytes and nothing after', [0x25, 0x50, 0x44, 0x46, 0x2d], true],
        ['four of them', [0x25, 0x50, 0x44, 0x46], false],
        ['the same text later in the file', [0x20, 0x25, 0x50, 0x44, 0x46, 0x2d], false],
        ['nothing', [], false],
    ]) {
        test(`${what}: ${expected ? 'is one' : 'is not'}`, () => {
            assert.equal(isPdf(new Uint8Array(bytes)), expected);
        });
    }
});

describe('what a version of the terms may be called', () => {
    test('is what the schema of config/saas.yaml asks for', () => {
        assert.equal(
            planCatalogSchema.properties.terms.properties.version.pattern,
            TERMS_VERSION_PATTERN.source,
        );
    });

    for (const [what, version, expected] of [
        ['a date', '2026-10', true],
        ['letters, digits, a dot and an underscore', 'v3.1_de', true],
        ['32 characters', 'v'.repeat(32), true],
        ['33 characters', 'v'.repeat(33), false],
        ['empty', '', false],
        ['a space', 'Oktober 2026', false],
        ['a slash', '2026/10', false],
        ['a letter outside ASCII', 'Fassung-ä', false],
    ]) {
        test(`${what}: ${expected ? 'may be' : 'may not be'}`, () => {
            assert.equal(TERMS_VERSION_PATTERN.test(version), expected);
        });
    }
});

describe('another file under a version already archived', () => {
    test('is refused by its code, with both checksums beside it', () => {
        const refusal = termsVersionChanged('2026-10', CHECKSUM, 'f'.repeat(64));

        assert.equal(refusal.code, SETTINGS_ERROR_CODES.TERMS_VERSION_CHANGED);
        assert.deepEqual(refusal.params, {
            version: '2026-10',
            recorded: CHECKSUM,
            given: 'f'.repeat(64),
        });
    });
});

describe('the archive of the terms', () => {
    const [kept, notEmptied] = TERMS_ARCHIVE_TRIGGERS;

    test('with both of its triggers enabled keeps what it holds', () => {
        assert.equal(termsArchiveProtectionProblem([notEmptied, 'audit_trigger', kept]), null);
    });

    for (const [what, enabled, missing] of [
        ['with neither', [], [kept, notEmptied]],
        ['without the one against a truncate', [kept], [notEmptied]],
        ['without the one against an update or a delete', [notEmptied], [kept]],
    ]) {
        test(`${what} names what it lacks, and the file that adds it`, () => {
            const problem = termsArchiveProtectionProblem(enabled);

            assert.ok(problem.includes(`lacks ${missing.join(' and ')},`), problem);
            assert.ok(problem.includes('1.0-the-terms-are-a-version-and-a-file.postgres.sql'));
        });
    }
});

// @requirement SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to
describe('what a scheduled change or a booking recorded as agreed', () => {
    const AGREED_AT = new Date('2026-10-05T09:00:00.000Z');
    const columns = (overrides = {}) => ({
        termsVersion: '2026-10',
        cancellationNoticeDays: 14,
        agreedAt: AGREED_AT,
        ...overrides,
    });

    test('is read back as it was written, its terms none where none were named', () => {
        assert.deepEqual(toContractAgreement(columns(), 'Booking b-1'), {
            termsVersion: '2026-10',
            cancellationNoticeDays: 14,
            agreedAt: AGREED_AT,
        });
        assert.equal(
            toContractAgreement(columns({ termsVersion: null }), 'Booking b-1').termsVersion,
            null,
        );
    });

    test('is nothing where none was recorded, columns absent or null alike', () => {
        assert.equal(toContractAgreement({}, 'Booking b-1'), null);
        assert.equal(
            toContractAgreement(
                { termsVersion: null, cancellationNoticeDays: null, agreedAt: null },
                'Booking b-1',
            ),
            null,
        );
    });

    for (const [what, overrides] of [
        ['without its moment', { agreedAt: null }],
        ['without its days of notice', { cancellationNoticeDays: null }],
        ['with fewer days than none', { cancellationNoticeDays: -1 }],
        ['with part of a day', { cancellationNoticeDays: 14.5 }],
        ['with a moment that is none', { agreedAt: new Date('not a date') }],
        ['with a version no file could be called', { termsVersion: 'Oktober 2026' }],
    ]) {
        test(`${what} stops the read, naming whose it is`, () => {
            assert.throws(
                () => toContractAgreement(columns(overrides), 'Booking b-1'),
                /^Error: Booking b-1 records an agreement that is incomplete/,
            );
        });
    }

    test('is written in the columns of a scheduled change and of a booking, all null for none', () => {
        const agreement = toContractAgreement(columns(), 'Booking b-1');

        assert.deepEqual(pendingAgreementColumns(agreement), {
            pendingTermsVersion: '2026-10',
            pendingCancellationNoticeDays: 14,
            pendingAgreedAt: AGREED_AT,
        });
        assert.deepEqual(bookingAgreementColumns(agreement), {
            agreedTermsVersion: '2026-10',
            agreedCancellationNoticeDays: 14,
            agreedAt: AGREED_AT,
        });
        assert.deepEqual(Object.values(pendingAgreementColumns(null)), [null, null, null]);
        assert.deepEqual(Object.values(bookingAgreementColumns(null)), [null, null, null]);
    });
});
