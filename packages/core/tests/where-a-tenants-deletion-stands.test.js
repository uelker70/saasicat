// Where a tenant's deletion stands, decided once for the run that deletes it
// and for the pages that show it. The operator reads on the page what the run
// will do on the day, or why it did not; a page that phrased the decision a
// second time would one day say "due" for a tenant the run keeps.
//
// The installation's days are read in its zone: `Europe/Berlin` begins
// 1 December at 23:00 UTC on 30 November.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TENANT_DELETION_CAPABILITY,
    deletionDayHasCome,
    deletionGoesOn,
    deletionHeldBy,
    tenantDeletionStatusOf,
} from '../dist/index.js';

const ZONE = 'Europe/Berlin';
const DELETES_ON = '2026-12-01';
const LEASE_MS = 6 * 60 * 60_000;
const NOW = new Date('2026-12-01T10:00:00.000Z');
const STARTED = new Date('2026-11-30T23:15:00.000Z');
const END = { deletesOn: DELETES_ON };

const MATCHES = { kind: 'matches', identifier: 'ahp-prod' };
const UNMARKED = { kind: 'unmarked', expected: 'ahp-prod' };
const DIFFERS = { kind: 'differs', expected: 'ahp-prod', marked: 'ahp-staging' };
const NOTHING_HOLDS = { verdict: MATCHES, hasSubscriber: true, contractRunsPastEnd: false };

const COMMERCIAL = {
    subscriber: 1,
    contracts: 2,
    charges: 5,
    invoices: 3,
    payments: 3,
    credits: 0,
};
const FAILURE = { step: 'erase', store: 'files', code: 'ECONNRESET', at: STARTED };

/** An open deletion of two stores, the first erased, held by no run. */
function record(overrides = {}) {
    return {
        id: 'deletion-1',
        tenantId: 'tenant-1',
        subscriberId: 'subscriber-1',
        subscriptionId: 'subscription-1',
        subscriptionEndId: 'end-1',
        deletesOn: DELETES_ON,
        exportOfferedFrom: new Date('2026-10-31T12:00:00.000Z'),
        exportBlockedBySuspension: false,
        keep: [],
        commercialBefore: COMMERCIAL,
        commercialAfter: null,
        startedAt: STARTED,
        claimedAt: null,
        attempts: 0,
        lastFailure: null,
        halt: null,
        closedAt: null,
        stores: [
            { store: 'notes-data', position: 0, countedAt: STARTED, counts: [], erasedAt: STARTED },
            { store: 'files', position: 1, countedAt: STARTED, counts: [], erasedAt: null },
        ],
        ...overrides,
    };
}

function statusOf({ end = END, deletion = null, holds = NOTHING_HOLDS, now = NOW } = {}) {
    return tenantDeletionStatusOf({
        end,
        record: deletion,
        holds,
        now,
        timeZone: ZONE,
        leaseMs: LEASE_MS,
    });
}

/** `at` moved by `ms`. */
function shifted(at, ms) {
    return new Date(at.getTime() + ms);
}

test('the operator view of a deletion is announced as one capability', () => {
    assert.equal(TENANT_DELETION_CAPABILITY, 'deletions.read');
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('a deletion not begun waits for its day in the installation', () => {
    for (const { now, kind } of [
        { now: new Date('2026-11-30T22:59:59.999Z'), kind: 'scheduled' },
        { now: new Date('2026-11-30T23:00:00.000Z'), kind: 'due' },
    ]) {
        test(`at ${now.toISOString()} it is ${kind}`, () => {
            assert.equal(statusOf({ now }).kind, kind);
        });
    }

    test('nothing to show for a tenant with neither an end nor a record', () => {
        assert.equal(statusOf({ end: null }), null);
    });

    for (const [today, hasCome] of [
        ['2026-11-30', false],
        ['2026-12-01', true],
        ['2026-12-02', true],
    ]) {
        test(`its day has ${hasCome ? '' : 'not '}come on ${today}`, () => {
            assert.equal(deletionDayHasCome(END, today), hasCome);
        });
    }
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('what holds a due deletion before it begins', () => {
    test('an unmarked database holds it on its day, naming what the process expects', () => {
        assert.deepEqual(statusOf({ holds: { ...NOTHING_HOLDS, verdict: UNMARKED } }), {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [{ reason: 'installation-unmarked', expected: 'ahp-prod' }],
        });
    });

    test('a database marked for another installation names both identifiers', () => {
        assert.deepEqual(statusOf({ holds: { ...NOTHING_HOLDS, verdict: DIFFERS } }).heldBy, [
            { reason: 'installation-differs', expected: 'ahp-prod', marked: 'ahp-staging' },
        ]);
    });

    test('before its day it is scheduled, with what would hold it were the day today', () => {
        assert.deepEqual(
            statusOf({
                holds: { ...NOTHING_HOLDS, verdict: UNMARKED },
                now: new Date('2026-11-20T10:00:00.000Z'),
            }),
            {
                kind: 'scheduled',
                deletesOn: DELETES_ON,
                wouldBeHeldBy: [{ reason: 'installation-unmarked', expected: 'ahp-prod' }],
            },
        );
    });

    test('before its day with nothing that would hold it, the forecast is empty', () => {
        assert.deepEqual(statusOf({ now: new Date('2026-11-20T10:00:00.000Z') }), {
            kind: 'scheduled',
            deletesOn: DELETES_ON,
            wouldBeHeldBy: [],
        });
    });

    test('every reason that holds is named, in the order the run asks them', () => {
        assert.deepEqual(
            deletionHeldBy({ verdict: UNMARKED, hasSubscriber: false, contractRunsPastEnd: true }),
            [
                { reason: 'installation-unmarked', expected: 'ahp-prod' },
                { reason: 'no-subscriber' },
                { reason: 'contract-runs-past-end' },
            ],
        );
    });

    for (const { name, holds, heldBy } of [
        {
            name: 'a tenant without a subscriber',
            holds: { ...NOTHING_HOLDS, hasSubscriber: false },
            heldBy: [{ reason: 'no-subscriber' }],
        },
        {
            name: 'a tenant whose contract runs past the end',
            holds: { ...NOTHING_HOLDS, contractRunsPastEnd: true },
            heldBy: [{ reason: 'contract-runs-past-end' }],
        },
    ]) {
        test(`${name} is held by that alone`, () => {
            assert.deepEqual(statusOf({ holds }), {
                kind: 'halted',
                deletesOn: DELETES_ON,
                heldBy,
            });
        });
    }

    test('a marked database, a subscriber and no contract past the end leave it due', () => {
        assert.deepEqual(statusOf(), { kind: 'due', deletesOn: DELETES_ON });
        assert.deepEqual(deletionHeldBy(NOTHING_HOLDS), []);
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('a begun deletion stands where its record says', () => {
    test('a run holding a fresh claim is erasing, counting the stores done', () => {
        const claimedAt = shifted(NOW, -60_000);
        assert.deepEqual(statusOf({ deletion: record({ claimedAt }) }), {
            kind: 'running',
            deletesOn: DELETES_ON,
            startedAt: STARTED,
            storesErased: 1,
            storesTotal: 2,
            lastFailure: null,
        });
    });

    for (const { name, claimedAt, kind } of [
        {
            name: 'exactly one lease ago is still held',
            claimedAt: shifted(NOW, -LEASE_MS),
            kind: 'running',
        },
        {
            name: 'one millisecond more has gone stale',
            claimedAt: shifted(NOW, -LEASE_MS - 1),
            kind: 'retrying',
        },
        { name: 'none at all after a failure', claimedAt: null, kind: 'retrying' },
    ]) {
        test(`a claim ${name}: ${kind}`, () => {
            const deletion = record({ claimedAt, attempts: 3, lastFailure: FAILURE });
            assert.equal(statusOf({ deletion }).kind, kind);
        });
    }

    test('a deletion retried names its attempts and the failure it met last', () => {
        const deletion = record({ attempts: 3, lastFailure: FAILURE });
        assert.deepEqual(statusOf({ deletion }), {
            kind: 'retrying',
            deletesOn: DELETES_ON,
            startedAt: STARTED,
            attempts: 3,
            lastFailure: FAILURE,
        });
    });

    test('begun, held by no run and failed nowhere, it waits for the next run as under way', () => {
        assert.equal(statusOf({ deletion: record() }).kind, 'running');
    });

    test('a call that timed out keeps its claim, and the deletion is under way with that failure', () => {
        const timedOut = { ...FAILURE, code: 'timeout' };
        const deletion = record({ claimedAt: shifted(NOW, -60_000), lastFailure: timedOut });
        const status = statusOf({ deletion });
        assert.equal(status.kind, 'running');
        assert.deepEqual(status.lastFailure, timedOut);
    });

    test('a store that took the commercial record along halts it, naming the store and the parts', () => {
        const deletion = record({
            claimedAt: shifted(NOW, -60_000),
            commercialAfter: { ...COMMERCIAL, invoices: 2 },
            lastFailure: {
                step: 'guard',
                store: 'notes-data',
                code: 'commercial-record-lost',
                at: STARTED,
            },
            halt: 'commercial-record-lost',
        });
        assert.deepEqual(statusOf({ deletion }), {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [{ reason: 'commercial-record-lost', store: 'notes-data', lost: ['invoices'] }],
        });
    });

    test('a mark that does not match holds an open deletion before its next store', () => {
        const deletion = record({ claimedAt: shifted(NOW, -60_000) });
        assert.deepEqual(statusOf({ deletion, holds: { ...NOTHING_HOLDS, verdict: DIFFERS } }), {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [
                { reason: 'installation-differs', expected: 'ahp-prod', marked: 'ahp-staging' },
            ],
        });
    });

    test('a subscriber or a contract asked before the beginning holds nothing once it began', () => {
        const deletion = record({ claimedAt: shifted(NOW, -60_000) });
        const holds = { verdict: MATCHES, hasSubscriber: false, contractRunsPastEnd: true };
        assert.equal(statusOf({ deletion, holds }).kind, 'running');
    });

    test('a closed deletion is done, also once no end holds its tenant any more', () => {
        const closedAt = shifted(STARTED, 26 * 60_000);
        assert.deepEqual(statusOf({ end: null, deletion: record({ closedAt }) }), {
            kind: 'deleted',
            deletesOn: DELETES_ON,
            closedAt,
        });
    });

    for (const [name, overrides, goesOn] of [
        ['an open deletion', {}, true],
        ['a halted one', { halt: 'commercial-record-lost' }, false],
        ['a closed one', { closedAt: NOW }, false],
    ]) {
        test(`a run ${goesOn ? 'goes on with' : 'leaves'} ${name}`, () => {
            assert.equal(deletionGoesOn(record(overrides)), goesOn);
        });
    }
});
