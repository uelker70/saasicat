// The run that deletes a tenant on the day its end names (`SC-PRIV-022`):
// only in the installation the database is marked as (`SC-PRIV-021`), only
// for one tenant named (`SC-PRIV-016`), store by store in the application's
// order, and once — however often it is repeated, broken off or run twice at
// once (`SC-PRIV-018`).
//
// The service runs over the in-memory ports the platform ships for tests. The
// two writes a deletion begins with are kept here in a transaction that takes
// back what was written in it where it fails, as a database does; a write made
// outside it stays.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';

import {
    DELETION_CLAIM_LEASE_MS,
    DELETION_STEP_TIMEOUT_MS,
    InstallationMarkService,
    SubscriptionEndCron,
    TenantDeletionService,
} from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import {
    FakeInstallationMarkRepository,
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
    FakeTenantDeletionRepository,
} from '../dist/testing/index.js';
import { THIS_INSTALLATION, aKeepReport } from './helpers/installation-mark.js';

const ZONE = { timeZone: 'Europe/Berlin' };
const ENDED_AT = new Date('2026-10-31T12:00:00.000Z');
const DELETES_ON = '2026-12-01';
/** The last second of 30 November in Berlin, and the first of 1 December. */
const EVE = new Date('2026-11-30T22:59:59.000Z');
const DAY = new Date('2026-11-30T23:00:00.000Z');
const RUN = 'job:platform:subscription-ends';

/** Reasons that a failed transaction takes back where they were written in it. */
class TransactionalHolds extends FakeTenantAccessHoldRepository {
    async record(hold, tx) {
        const recorded = await super.record(hold);
        if (recorded && tx) {
            tx.undo.push(() =>
                this.holds.splice(
                    this.holds.findIndex((h) => h.id === recorded.id),
                    1,
                ),
            );
        }
        return recorded;
    }
}

/** Deletions that a failed transaction takes back where they were begun in it. */
class TransactionalDeletions extends FakeTenantDeletionRepository {
    async begin(record, tx) {
        const begun = await super.begin(record);
        if (begun && tx) {
            tx.undo.push(() =>
                this.deletions.splice(
                    this.deletions.findIndex((d) => d.id === begun.id),
                    1,
                ),
            );
        }
        return begun;
    }
}

/** A runner whose transaction takes back what was written in it where it fails; `failNext` fails one. */
function aTransactionRunner() {
    const runner = {
        failNext: false,
        async run(work) {
            const tx = { undo: [] };
            try {
                const result = await work(tx);
                if (runner.failNext) {
                    runner.failNext = false;
                    throw new Error('the transaction failed');
                }
                return result;
            } catch (error) {
                for (const undo of tx.undo.reverse()) undo();
                throw error;
            }
        },
    };
    return runner;
}

/**
 * Stores named `names` that note each call in `calls`. Each counts 12 notes
 * until it erased, and nothing after; `answers` replaces a store's `count` or
 * `erase` with its own.
 */
function storesNoting(calls, names, answers = {}) {
    return names.map((name) => {
        let erased = false;
        return {
            name,
            async count(tenantId) {
                calls.push(`${name}.count:${tenantId}`);
                if (answers[name]?.count) return answers[name].count();
                return erased ? [] : [{ category: 'notes', count: 12 }];
            },
            async erase(tenantId) {
                calls.push(`${name}.erase:${tenantId}`);
                erased = true;
                if (answers[name]?.erase) await answers[name].erase();
            },
        };
    });
}

/** A logger that keeps what it is told, by level. */
function aQuietLogger() {
    const said = { log: [], warn: [], error: [] };
    return {
        said,
        log: (message) => said.log.push(message),
        warn: (message) => said.warn.push(message),
        error: (message) => said.error.push(message),
    };
}

/**
 * The run over in-memory ports, the database marked as this installation's
 * unless `marked` says otherwise, every tenant with a subscriber unless
 * `subscribers` says otherwise. `shared` hands it another run's ports, as a
 * second instance over the same database.
 */
async function setUp({
    erasers,
    names = ['files', 'data'],
    answers,
    marked = THIS_INSTALLATION,
    keep = aKeepReport(),
    subscribers = { findByTenantId: async (tenantId) => ({ id: `subscriber-${tenantId}` }) },
    shared,
} = {}) {
    const calls = [];
    const ports = shared ?? {
        holds: new TransactionalHolds(),
        ends: new FakeSubscriptionEndRepository(),
        records: new TransactionalDeletions(),
        marks: new FakeInstallationMarkRepository(),
        transactions: aTransactionRunner(),
    };
    if (!shared && marked) {
        await ports.marks.markIfUnmarked({
            identifier: marked,
            markedAt: ENDED_AT,
            markedBy: 'cli:ops',
        });
    }
    const service = new TenantDeletionService(
        erasers ?? storesNoting(calls, names, answers),
        keep,
        ports.records,
        subscribers,
        ports.transactions,
        ports.ends,
        new InstallationMarkService(ports.marks, THIS_INSTALLATION, null),
        ZONE,
        ports.holds,
        null,
        null,
    );
    const logger = aQuietLogger();
    service.logger = logger;
    service.onModuleInit();
    return { ...ports, ports, service, calls, said: logger.said };
}

/** Ends the subscription of `tenantId` with its deletion day, holding the tenant to reading. */
async function ended(run, tenantId, deletesOn = DELETES_ON) {
    const subscriptionId = `subscription-${tenantId}`;
    await run.holds.record({
        tenantId,
        kind: 'ended',
        reference: subscriptionId,
        note: null,
        since: ENDED_AT,
        recordedBy: RUN,
    });
    return run.ends.record({
        tenantId,
        subscriptionId,
        endsAt: ENDED_AT,
        deletesOn,
        recordedAt: ENDED_AT,
        recordedBy: RUN,
    });
}

/** The open reasons of `tenantId`, by kind. */
async function openKinds(run, tenantId) {
    return (await run.holds.listOpen(tenantId)).map((hold) => hold.kind).sort();
}

const recordOf = (run, tenantId) => run.records.deletions.find((d) => d.tenantId === tenantId);

afterEach(() => mock.timers.reset());

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('a tenant whose subscription ended', () => {
    test('is not deleted in the last second before its day in the installation zone, and is on the first', async () => {
        const run = await setUp();
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(EVE), { deleted: 0, halted: 0, failed: 0 });
        assert.deepEqual(run.calls, []);
        assert.equal(recordOf(run, 't1'), undefined);

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
        assert.equal(recordOf(run, 't1').closedAt instanceof Date, true);
    });

    test('is deleted where its day passed already', async () => {
        const run = await setUp();
        await ended(run, 't1', '2026-11-20');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
    });

    test('is not deleted where the reason holding it to reading was lifted, though its end stands', async () => {
        const run = await setUp();
        await ended(run, 't1', '2026-11-20');
        const [hold] = await run.holds.listOpen('t1');
        await run.holds.lift(hold.id, ENDED_AT, 'web:ops@example.com:s1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 0 });
        assert.deepEqual(run.calls, []);
    });

    test('is held back from then on, even from the operator acting as it and only reading', async () => {
        const run = await setUp();
        await ended(run, 't1');
        await run.service.deleteDue(DAY);

        assert.deepEqual(await openKinds(run, 't1'), ['deleting']);
        const access = new TenantAccessService(run.holds, new Reflector());
        await assert.rejects(
            access.assertAllowed('t1', { actingAsOperator: true, writes: false }),
            (error) => error.getResponse().code === 'TENANT_BEING_DELETED',
        );
    });

    test('has nothing erased and no record begun where it has no subscriber to keep the record with', async () => {
        const run = await setUp({ subscribers: { findByTenantId: async () => null } });
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.deepEqual(run.calls, []);
        assert.equal(recordOf(run, 't1'), undefined);
        assert.deepEqual(await openKinds(run, 't1'), ['ended']);
    });
});

// @requirement SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period
describe('the record of when the export could be taken', () => {
    async function suspendedFrom(since, liftedAt) {
        const run = await setUp();
        await ended(run, 't1');
        const hold = await run.holds.record({
            tenantId: 't1',
            kind: 'suspended',
            reference: null,
            note: null,
            since,
            recordedBy: 'web:ops@example.com:s1',
        });
        if (liftedAt) await run.holds.lift(hold.id, liftedAt, 'web:ops@example.com:s1');
        await run.service.deleteDue(DAY);
        return recordOf(run, 't1');
    }

    test('says a suspension kept it from being taken where one held after the end', async () => {
        const record = await suspendedFrom(
            new Date('2026-09-01T00:00:00Z'),
            new Date('2026-11-02T00:00:00Z'),
        );
        assert.equal(record.exportBlockedBySuspension, true);
        assert.deepEqual(record.exportOfferedFrom, ENDED_AT);
    });

    test('says none did where the suspension was lifted before the end', async () => {
        const record = await suspendedFrom(
            new Date('2026-09-01T00:00:00Z'),
            new Date('2026-10-01T00:00:00Z'),
        );
        assert.equal(record.exportBlockedBySuspension, false);
    });
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('the installation mark in front of the run', () => {
    test('over a database unmarked, or marked as another installation, nothing begins and the log says so once for the run', async () => {
        for (const marked of [null, 'staging']) {
            const run = await setUp({ marked });
            await ended(run, 't1');
            await ended(run, 't2');

            assert.deepEqual(await run.service.deleteDue(DAY), {
                deleted: 0,
                halted: 2,
                failed: 0,
            });
            assert.deepEqual(run.calls, []);
            assert.deepEqual(run.records.deletions, []);
            assert.deepEqual(await openKinds(run, 't1'), ['ended']);
            assert.deepEqual(await openKinds(run, 't2'), ['ended']);
            assert.equal(run.said.warn.length, 1, run.said.warn.join('\n'));
            assert.match(run.said.warn[0], /2 tenant\(s\) due/);
            assert.match(run.said.warn[0], /installation mark probe/);
        }
    });

    test('a mark changed while a deletion is under way stops it before the next store, and the record stays open', async () => {
        const marks = new FakeInstallationMarkRepository();
        const run = await setUp({
            answers: {
                files: {
                    erase: () =>
                        marks.replace(THIS_INSTALLATION, {
                            identifier: 'staging',
                            markedAt: DAY,
                            markedBy: 'cli:ops',
                        }),
                },
            },
            shared: {
                holds: new TransactionalHolds(),
                ends: new FakeSubscriptionEndRepository(),
                records: new TransactionalDeletions(),
                marks,
                transactions: aTransactionRunner(),
            },
        });
        await marks.markIfUnmarked({
            identifier: THIS_INSTALLATION,
            markedAt: ENDED_AT,
            markedBy: 'cli:ops',
        });
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.ok(!run.calls.includes('data.erase:t1'), run.calls.join());
        const record = recordOf(run, 't1');
        assert.equal(record.closedAt, null);
        assert.equal(record.claimedAt, null, 'the claim is let go for the next run');
        assert.ok(record.stores.find((part) => part.store === 'files').erasedAt);
    });
});

// @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
describe('the beginning of a deletion', () => {
    test('records the deletion and holds the tenant back in one transaction: where it fails, neither stands', async () => {
        const run = await setUp();
        await ended(run, 't1');
        run.transactions.failNext = true;

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        assert.deepEqual(run.records.deletions, []);
        assert.deepEqual(await openKinds(run, 't1'), ['ended']);
        assert.deepEqual(run.calls, []);

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
    });

    test('keeps what the tenant was told to keep, and stops at lines nobody can read', async () => {
        const line = { category: 'receipts', count: 42, labels: { en: 'Receipts' } };
        const kept = await setUp({ keep: { keep: async () => [line] } });
        await ended(kept, 't1');
        await kept.service.deleteDue(DAY);
        assert.deepEqual(recordOf(kept, 't1').keep, [line]);

        const unreadable = await setUp({
            keep: { keep: async () => [{ category: 'Receipts', count: 1 }] },
        });
        await ended(unreadable, 't1');
        assert.deepEqual(await unreadable.service.deleteDue(DAY), {
            deleted: 0,
            halted: 0,
            failed: 1,
        });
        assert.deepEqual(unreadable.records.deletions, []);
    });
});

// @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
describe('the stores', () => {
    test('all count before the first erases, each in the order the application lists them', async () => {
        const run = await setUp({ names: ['files', 'data'] });
        await ended(run, 't1');

        await run.service.deleteDue(DAY);

        assert.deepEqual(run.calls, [
            'files.count:t1',
            'data.count:t1',
            'files.erase:t1',
            'data.erase:t1',
        ]);
        assert.deepEqual(
            recordOf(run, 't1').stores.map(({ store, counts }) => [store, counts]),
            [
                ['files', [{ category: 'notes', count: 12 }]],
                ['data', [{ category: 'notes', count: 12 }]],
            ],
        );
    });

    test('a count nobody can read stops the deletion before anything is erased', async () => {
        const run = await setUp({
            answers: { data: { count: async () => [{ category: 'Notes', count: 1 }] } },
        });
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        assert.ok(!run.calls.some((call) => call.includes('.erase')), run.calls.join());
        assert.deepEqual(recordOf(run, 't1').lastFailure.code, 'invalid-counts');
        assert.deepEqual(recordOf(run, 't1').lastFailure.store, 'data');
    });

    test('listed otherwise than when the deletion began, stop it before anything more is erased', async () => {
        const first = await setUp({
            answers: { data: { erase: () => Promise.reject(new Error('down')) } },
        });
        await ended(first, 't1');
        await first.service.deleteDue(DAY);

        const later = await setUp({ names: ['data'], shared: first.ports });
        assert.deepEqual(await later.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        assert.deepEqual(later.calls, []);
        assert.equal(recordOf(later, 't1').lastFailure.code, 'stores-changed');
    });
});

// @requirement SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named
describe('the tenant a store is asked about', () => {
    test('is never one an end names as nobody', async () => {
        const run = await setUp();
        await ended(run, '');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.deepEqual(run.calls, []);
        assert.deepEqual(run.records.deletions, []);
    });
});

// @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
describe('a deletion broken off', () => {
    test('goes on after the store that confirmed, and keeps the code of the failure, never its message', async () => {
        let failing = true;
        const run = await setUp({
            answers: {
                data: {
                    erase: async () => {
                        if (!failing) return;
                        throw Object.assign(new Error('boom: ada@example.com'), {
                            code: 'ECONNRESET',
                        });
                    },
                },
            },
        });
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        const record = recordOf(run, 't1');
        assert.deepEqual(
            { ...record.lastFailure, at: undefined },
            { step: 'erase', store: 'data', code: 'ECONNRESET', at: undefined },
        );
        assert.equal(record.attempts, 1);
        assert.ok(!JSON.stringify(record).includes('boom'));
        assert.ok(!JSON.stringify(record).includes('example.com'));
        assert.equal(record.claimedAt, null);

        failing = false;
        run.calls.length = 0;
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
        assert.deepEqual(run.calls, ['data.erase:t1']);
    });

    test('by a store that did not answer in time is left to it until the claim goes stale; the counts it took first stand', async () => {
        mock.timers.enable({ apis: ['setTimeout', 'Date'], now: DAY.getTime() });
        let answered = false;
        const run = await setUp({
            answers: {
                files: { erase: () => (answered ? Promise.resolve() : new Promise(() => {})) },
            },
        });
        await ended(run, 't1');

        const running = run.service.deleteDue(DAY);
        // Bounded, so a run that never asks the store fails here rather than hanging.
        for (let turn = 0; turn < 100 && !run.calls.includes('files.erase:t1'); turn += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(run.calls.includes('files.erase:t1'), run.calls.join());
        mock.timers.tick(DELETION_STEP_TIMEOUT_MS);
        assert.deepEqual(await running, { deleted: 0, halted: 0, failed: 1 });
        assert.equal(recordOf(run, 't1').lastFailure.code, 'timeout');
        assert.notEqual(
            recordOf(run, 't1').claimedAt,
            null,
            'the claim stays while the call may run',
        );

        run.calls.length = 0;
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 0 });
        assert.deepEqual(run.calls, [], 'nobody erases beside the unanswered call');

        mock.timers.tick(DELETION_CLAIM_LEASE_MS);
        answered = true;
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
        assert.deepEqual(run.calls, ['files.erase:t1', 'data.erase:t1']);
        assert.deepEqual(recordOf(run, 't1').stores[0].counts, [{ category: 'notes', count: 12 }]);
    });
});

// @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
describe('two instances at once', () => {
    test('begin a deletion once, and each store is asked once', async () => {
        const first = await setUp();
        const second = await setUp({ shared: first.ports });
        await ended(first, 't1');

        await Promise.all([first.service.deleteDue(DAY), second.service.deleteDue(DAY)]);

        const calls = [...first.calls, ...second.calls].sort();
        assert.deepEqual(calls, [
            'data.count:t1',
            'data.erase:t1',
            'files.count:t1',
            'files.erase:t1',
        ]);
    });

    test('going on with a deletion begun before, one claims it and the other leaves it', async () => {
        let failing = true;
        const answers = {
            data: {
                erase: async () => {
                    if (failing) throw new Error('down');
                },
            },
        };
        const first = await setUp({ answers });
        const second = await setUp({ answers, shared: first.ports });
        await ended(first, 't1');
        await first.service.deleteDue(DAY);
        failing = false;
        first.calls.length = 0;

        await Promise.all([first.service.deleteDue(DAY), second.service.deleteDue(DAY)]);

        assert.deepEqual([...first.calls, ...second.calls], ['data.erase:t1']);
    });
});

describe('the quarter-hourly run', () => {
    // @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
    test('sets the deletions off without waiting for them, and starts no second beside the first', async () => {
        const asked = [];
        let finish;
        const cron = new SubscriptionEndCron(
            { recordEnded: async () => (asked.push('record'), { ended: 0 }) },
            { remindDue: async () => (asked.push('remind'), { told: 0, failed: 0 }) },
            {
                deleteDue: () => {
                    asked.push('delete');
                    return new Promise(
                        (resolve) => (finish = () => resolve({ deleted: 1, halted: 0, failed: 0 })),
                    );
                },
            },
            null,
        );
        cron.logger = aQuietLogger();

        await cron.recordAndRemind();
        await cron.recordAndRemind();
        assert.deepEqual(asked, ['record', 'remind', 'delete', 'record', 'remind']);

        finish();
        await new Promise((resolve) => setImmediate(resolve));
        await cron.recordAndRemind();
        assert.deepEqual(asked.slice(5), ['record', 'remind', 'delete']);
        finish();
    });
});
