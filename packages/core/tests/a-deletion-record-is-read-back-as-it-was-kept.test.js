// Reading the record of a tenant's deletion back: it outlives the tenant and is
// read by people adding counts up, so both adapters read it alike — the stores
// in their order, the categories by their keys character by character — and a
// value the platform never writes stops at the read and names its row rather
// than reaching the page as something it is not.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    erasedCountColumns,
    keptCountColumns,
    tenantDeletionFailureColumn,
    toTenantDeletionRecord,
} from '../dist/index.js';

const STARTED = new Date('2027-02-01T03:15:00.123Z');
const COMMERCIAL = {
    subscriber: 1,
    contracts: 2,
    charges: 3,
    invoices: 1,
    payments: 1,
    credits: 0,
};
const ROW = {
    id: 'd-1',
    tenantId: 't-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    subscriptionEndId: 'end-1',
    deletesOn: new Date('2027-01-31T00:00:00.000Z'),
    exportOfferedFrom: new Date('2027-01-01T00:05:00.456Z'),
    exportBlockedBySuspension: true,
    commercialBefore: COMMERCIAL,
    commercialAfter: null,
    startedAt: STARTED,
    claimedAt: null,
    attempts: 1,
    lastFailure: { step: 'erase', store: 'files', code: 'ETIMEDOUT', at: STARTED.toISOString() },
    halt: null,
    closedAt: null,
    stores: [
        { store: 'files', position: 1, countedAt: STARTED, erasedAt: null },
        { store: 'notes-data', position: 0, countedAt: STARTED, erasedAt: STARTED },
    ],
    counts: [
        { kind: 'erased', store: 'notes-data', category: 'notes', count: 3, labels: null },
        { kind: 'erased', store: 'notes-data', category: 'note-links', count: 0, labels: null },
        { kind: 'erased', store: 'files', category: 'notes', count: 4, labels: null },
        {
            kind: 'kept',
            store: null,
            category: 'receipts',
            count: 12,
            labels: { en: 'Receipts', de: 'Belege' },
        },
        { kind: 'kept', store: null, category: 'contracts', count: 2, labels: { en: 'Contracts' } },
    ],
};

// @requirement SC-PRIV-023 — A tenant's deletion leaves a record with the subscriber that names no person
describe('a deletion record read back', () => {
    test('has its stores in their order, each with its own counts, and the kept lines apart', () => {
        const record = toTenantDeletionRecord(ROW);
        assert.equal(record.deletesOn, '2027-01-31');
        assert.deepEqual(record.stores, [
            {
                store: 'notes-data',
                position: 0,
                countedAt: STARTED,
                // By character: a collation that skips the hyphen would put `notes` first.
                counts: [
                    { category: 'note-links', count: 0 },
                    { category: 'notes', count: 3 },
                ],
                erasedAt: STARTED,
            },
            {
                store: 'files',
                position: 1,
                countedAt: STARTED,
                counts: [{ category: 'notes', count: 4 }],
                erasedAt: null,
            },
        ]);
        assert.deepEqual(record.keep, [
            { category: 'contracts', count: 2, labels: { en: 'Contracts' } },
            { category: 'receipts', count: 12, labels: { en: 'Receipts', de: 'Belege' } },
        ]);
        assert.deepEqual(record.commercialBefore, COMMERCIAL);
        assert.equal(record.commercialAfter, null);
        assert.deepEqual(record.lastFailure, {
            step: 'erase',
            store: 'files',
            code: 'ETIMEDOUT',
            at: STARTED,
        });
    });

    test('reads a day kept as text as the same day', () => {
        assert.equal(
            toTenantDeletionRecord({ ...ROW, deletesOn: '2027-01-31' }).deletesOn,
            '2027-01-31',
        );
    });

    test('a failure written is read back as it was', () => {
        const failure = { step: 'close', store: null, code: 'Error', at: STARTED };
        const column = tenantDeletionFailureColumn(failure);
        assert.deepEqual(column, { ...failure, at: STARTED.toISOString() });
        assert.deepEqual(
            toTenantDeletionRecord({ ...ROW, lastFailure: column }).lastFailure,
            failure,
        );
    });

    test('the one halt a record keeps is read back as it was', () => {
        assert.equal(
            toTenantDeletionRecord({ ...ROW, halt: 'commercial-record-lost' }).halt,
            'commercial-record-lost',
        );
    });

    test('the count rows to write say what each is', () => {
        assert.deepEqual(erasedCountColumns('files', [{ category: 'notes', count: 4 }]), [
            { kind: 'erased', store: 'files', category: 'notes', count: 4, labels: null },
        ]);
        assert.deepEqual(
            keptCountColumns([{ category: 'receipts', count: 12, labels: { en: 'Receipts' } }]),
            [
                {
                    kind: 'kept',
                    store: null,
                    category: 'receipts',
                    count: 12,
                    labels: { en: 'Receipts' },
                },
            ],
        );
    });

    const refused = [
        ['a halt the platform does not keep', { halt: 'installation-unmarked' }, /halt/],
        ['a halt said before the deletion has a record', { halt: 'no-subscriber' }, /halt/],
        ['a count of another kind', { counts: [{ ...ROW.counts[0], kind: 'deleted' }] }, /kind/],
        [
            'a commercial record missing a part',
            { commercialAfter: { subscriber: 1 } },
            /commercialAfter/,
        ],
        [
            'a commercial record with a fraction',
            { commercialBefore: { ...COMMERCIAL, charges: 1.5 } },
            /commercialBefore/,
        ],
        [
            'a failure without its moment',
            { lastFailure: { step: 'erase', store: null, code: 'X' } },
            /lastFailure/,
        ],
        [
            'a failure at a step there is none of',
            { lastFailure: { ...ROW.lastFailure, step: 'undo' } },
            /lastFailure 'undo'/,
        ],
        [
            'a failure whose store is not text',
            { lastFailure: { ...ROW.lastFailure, store: 3 } },
            /lastFailure/,
        ],
        ['a day that is none', { deletesOn: 'soon' }, /deletesOn/],
        [
            'kept words without English',
            { counts: [{ ...ROW.counts[3], labels: { de: 'Belege' } }] },
            /English/,
        ],
        [
            'kept words that are not text',
            { counts: [{ ...ROW.counts[3], labels: { en: 'Receipts', de: 7 } }] },
            /English/,
        ],
    ];
    test('refuses a value the platform never writes, naming its row', () => {
        for (const [what, change, message] of refused) {
            assert.throws(
                () => toTenantDeletionRecord({ ...ROW, ...change }),
                (error) => message.test(error.message) && error.message.includes('d-1'),
                `read ${what}`,
            );
        }
    });
});
