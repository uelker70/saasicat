// What the application answers a deletion with, checked before the platform
// keeps it: the counts each store makes before it erases, the lines of what the
// tenant keeps itself — and the comparison of the subscriber's commercial record
// before and after a store erased.
//
// The counts and the lines are the application's answer and land in the
// subscriber's deletion record, which outlives the tenant; one that cannot be
// read stops the run rather than reaching the record as something it is not. A
// category is a stable key, so a record years old still reads the same.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TENANT_DELETION_KEY_MAX_LENGTH,
    commercialRecordLost,
    isTenantDeletionKey,
    keepLinesProblem,
    tenantCountsProblem,
} from '../dist/index.js';

describe('a category or a store is named by a stable key', () => {
    test('lower-case letters, digits and dashes, beginning with a letter', () => {
        assert.equal(isTenantDeletionKey('notes'), true);
        assert.equal(isTenantDeletionKey('audit-entries2'), true);
        assert.equal(isTenantDeletionKey('Notes'), false);
        assert.equal(isTenantDeletionKey('2notes'), false);
        assert.equal(isTenantDeletionKey('-notes'), false);
        assert.equal(isTenantDeletionKey('notes data'), false);
        assert.equal(isTenantDeletionKey(''), false);
        assert.equal(isTenantDeletionKey(42), false);
    });

    test('the longest key is allowed, one character more is not', () => {
        assert.equal(TENANT_DELETION_KEY_MAX_LENGTH, 64);
        assert.equal(isTenantDeletionKey('a'.repeat(64)), true);
        assert.equal(isTenantDeletionKey('a'.repeat(65)), false);
    });

    test('a long run of text ending in a bad character is answered at once', () => {
        const started = performance.now();
        assert.equal(isTenantDeletionKey(`${'a'.repeat(63)}!`), false);
        assert.equal(isTenantDeletionKey(`${'a'.repeat(50_000)}!`), false);
        assert.ok(performance.now() - started < 100);
    });
});

describe('the counts a store answers', () => {
    test('none, or one per category, are counts', () => {
        assert.equal(tenantCountsProblem([]), null);
        assert.equal(tenantCountsProblem([{ category: 'notes', count: 3 }]), null);
        assert.equal(tenantCountsProblem([{ category: 'notes', count: 0 }]), null);
    });

    test('anything but a list is not a list', () => {
        assert.equal(tenantCountsProblem(null), 'not-a-list');
        assert.equal(tenantCountsProblem(undefined), 'not-a-list');
        assert.equal(tenantCountsProblem({ category: 'notes', count: 3 }), 'not-a-list');
    });

    test('a category that is not a stable key is refused', () => {
        assert.equal(tenantCountsProblem([{ category: 'Notes', count: 3 }]), 'category');
        assert.equal(tenantCountsProblem([{ count: 3 }]), 'category');
        assert.equal(tenantCountsProblem([null]), 'category');
        assert.equal(tenantCountsProblem([{ category: 'a'.repeat(64), count: 1 }]), null);
        assert.equal(tenantCountsProblem([{ category: 'a'.repeat(65), count: 1 }]), 'category');
    });

    test('a count is a whole number of at least zero that adds up exactly', () => {
        for (const count of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '3', null]) {
            assert.equal(
                tenantCountsProblem([{ category: 'notes', count }]),
                'count',
                String(count),
            );
        }
        assert.equal(
            tenantCountsProblem([{ category: 'notes', count: Number.MAX_SAFE_INTEGER }]),
            null,
        );
    });

    test('a category counted twice is refused', () => {
        assert.equal(
            tenantCountsProblem([
                { category: 'notes', count: 1 },
                { category: 'notes', count: 2 },
            ]),
            'duplicate-category',
        );
    });

    test('a long category ending in a bad character is answered at once', () => {
        const started = performance.now();
        assert.equal(
            tenantCountsProblem([{ category: `${'a'.repeat(50_000)}!`, count: 1 }]),
            'category',
        );
        assert.ok(performance.now() - started < 100);
    });
});

describe('the lines of what the tenant keeps', () => {
    const RECEIPTS = { category: 'receipts', count: 42, labels: { en: 'Receipts' } };

    test('none, or lines worded in English at least, are lines', () => {
        assert.equal(keepLinesProblem([]), null);
        assert.equal(keepLinesProblem([RECEIPTS]), null);
        assert.equal(
            keepLinesProblem([{ ...RECEIPTS, labels: { en: 'Receipts', de: 'Belege' } }]),
            null,
        );
    });

    test('are held to what counts are held to', () => {
        assert.equal(keepLinesProblem(null), 'not-a-list');
        assert.equal(keepLinesProblem([{ ...RECEIPTS, category: 'Receipts' }]), 'category');
        assert.equal(keepLinesProblem([{ ...RECEIPTS, count: -1 }]), 'count');
        assert.equal(keepLinesProblem([RECEIPTS, RECEIPTS]), 'duplicate-category');
    });

    test('without English words, or with a word that is not text, are refused', () => {
        for (const labels of [
            undefined,
            null,
            [],
            {},
            { de: 'Belege' },
            { en: '' },
            { en: '   ' },
            { en: 42 },
            { en: 'Receipts', de: 42 },
            { en: 'Receipts', de: ' ' },
        ]) {
            assert.equal(
                keepLinesProblem([{ ...RECEIPTS, labels }]),
                'labels',
                JSON.stringify(labels),
            );
        }
    });
});

describe("what a store's erasing took of the subscriber's commercial record", () => {
    const BEFORE = {
        subscriber: 1,
        contracts: 2,
        charges: 3,
        invoices: 3,
        payments: 1,
        credits: 1,
    };

    test('nothing, where every count stands', () => {
        assert.deepEqual(commercialRecordLost(BEFORE, { ...BEFORE }), []);
    });

    test('each count that fell, by name', () => {
        assert.deepEqual(commercialRecordLost(BEFORE, { ...BEFORE, invoices: 2 }), ['invoices']);
        assert.deepEqual(commercialRecordLost(BEFORE, { ...BEFORE, subscriber: 0, charges: 0 }), [
            'subscriber',
            'charges',
        ]);
    });

    test('nothing, where a count grew: an invoice may be issued while the run erases', () => {
        assert.deepEqual(commercialRecordLost(BEFORE, { ...BEFORE, contracts: 3 }), []);
    });
});
