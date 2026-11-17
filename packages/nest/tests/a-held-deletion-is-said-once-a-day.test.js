// A deletion held before it begins is said in the server log when it is first
// held, again at once when what holds it changes, and otherwise once a day in
// the installation's days. The run comes every quarter of an hour, and over an
// unmarked database — the operator's preview — every due tenant is held on
// every run: said each time, a warning that fires while everything is as it
// should be teaches the operator to skip the log.
//
// A failure of a deletion under way is said every time: each run that meets
// it is a new attempt.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { THIS_INSTALLATION } from './helpers/installation-mark.js';
import {
    DAY,
    ENDED_AT,
    aSubscriberForEveryTenant,
    contracted,
    ended,
    endedAt,
    recordOf,
    setUp,
} from './helpers/tenant-deletion.js';

const QUARTER_HOUR = 15 * 60_000;
/** Four runs of the deletion day, a quarter of an hour apart. */
const RUNS_OF_THE_DAY = [0, 1, 2, 3].map((n) => new Date(DAY.getTime() + n * QUARTER_HOUR));
/** The first second of 2 December in Berlin: the next installation day. */
const NEXT_DAY = new Date('2026-12-01T23:00:00.000Z');
/** The last second of 1 December in Berlin, in UTC already the next day's date. */
const LATE_ON_THE_DAY = new Date('2026-12-01T22:59:59.000Z');
const CONCLUDED_AFTER_THE_END = new Date('2026-11-15T09:00:00.000Z');

/** Runs the deletion once at each of `moments`. */
async function runAt(run, moments) {
    for (const now of moments) await run.service.deleteDue(now);
}

/** A report of what a tenant keeps that counts how often it is asked, doing `meanwhile` as it answers. */
function aCountingKeepReport(meanwhile = async () => {}) {
    const report = {
        asked: 0,
        async keep() {
            report.asked += 1;
            await meanwhile();
            return [];
        },
    };
    return report;
}

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('the installation mark that holds every due deletion', () => {
    test('is said once on the deletion day, however often the run comes, and again on the next', async () => {
        const run = await setUp({ marked: null });
        await ended(run, 't1');
        await ended(run, 't2');

        await runAt(run, [...RUNS_OF_THE_DAY, LATE_ON_THE_DAY]);
        assert.equal(run.said.warn.length, 1, run.said.warn.join('\n'));
        assert.match(run.said.warn[0], /2 tenant\(s\) due/);

        await runAt(run, [NEXT_DAY, new Date(NEXT_DAY.getTime() + QUARTER_HOUR)]);
        assert.equal(run.said.warn.length, 2, run.said.warn.join('\n'));
    });

    test('is said again at once where another tenant falls due', async () => {
        const run = await setUp({ marked: null });
        await ended(run, 't1');
        await runAt(run, RUNS_OF_THE_DAY.slice(0, 2));
        await ended(run, 't2');
        await runAt(run, RUNS_OF_THE_DAY.slice(2));

        assert.equal(run.said.warn.length, 2, run.said.warn.join('\n'));
        assert.match(run.said.warn[1], /2 tenant\(s\) due/);
    });

    test('is said again at once where the database is marked as another installation', async () => {
        const run = await setUp({ marked: null });
        await ended(run, 't1');
        await runAt(run, RUNS_OF_THE_DAY.slice(0, 2));
        await run.marks.markIfUnmarked({
            identifier: 'staging',
            markedAt: DAY,
            markedBy: 'cli:ops',
        });
        await runAt(run, RUNS_OF_THE_DAY.slice(2));

        assert.equal(run.said.warn.length, 2, run.said.warn.join('\n'));
        assert.match(run.said.warn[1], /marked as installation staging/);
        assert.ok(run.said.warn[1].includes(`runs as ${THIS_INSTALLATION} `), run.said.warn[1]);
    });
});

// @requirement SC-PRIV-026 — A tenant is not deleted while a contract of it runs past the end that made it due
describe('a tenant held by a contract that runs past its end', () => {
    test('is held without the application being asked what the tenant keeps', async () => {
        const keep = aCountingKeepReport();
        const run = await setUp({ keep });
        await ended(run, 't1');
        await contracted(run, 't1', CONCLUDED_AFTER_THE_END);

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.equal(keep.asked, 0);
    });

    test('is held where the contract was concluded while the application answered what it keeps', async () => {
        let run;
        let concluded;
        const keep = aCountingKeepReport(async () => {
            concluded = await contracted(run, 't1', CONCLUDED_AFTER_THE_END);
        });
        run = await setUp({ keep });
        await ended(run, 't1');

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.equal(keep.asked, 1);
        assert.equal(recordOf(run, 't1'), undefined);
        assert.deepEqual(run.calls, []);
        assert.equal(run.said.warn.length, 1, run.said.warn.join('\n'));
        assert.ok(run.said.warn[0].includes(`contract ${concluded.id} runs`), run.said.warn[0]);
    });

    test('is said once on the deletion day and again on the next', async () => {
        const run = await setUp();
        await ended(run, 't1');
        await contracted(run, 't1', CONCLUDED_AFTER_THE_END);

        await runAt(run, RUNS_OF_THE_DAY);
        assert.equal(run.said.warn.length, 1, run.said.warn.join('\n'));

        await runAt(run, [NEXT_DAY]);
        assert.equal(run.said.warn.length, 2, run.said.warn.join('\n'));
    });
});

describe('a tenant held for more than one reason', () => {
    test('is said with every reason, and again at once where one of them goes', async () => {
        const subscribers = aSubscriberForEveryTenant();
        subscribers.unlinked.set('t1', ENDED_AT);
        const run = await setUp({ subscribers });
        await ended(run, 't1');
        const contract = await contracted(run, 't1', CONCLUDED_AFTER_THE_END);

        await runAt(run, RUNS_OF_THE_DAY.slice(0, 2));
        assert.equal(run.said.error.length, 1, run.said.error.join('\n'));
        assert.match(run.said.error[0], /no subscriber/);
        assert.ok(run.said.error[0].includes(`contract ${contract.id} runs`), run.said.error[0]);
        assert.equal(run.said.warn.length, 0, run.said.warn.join('\n'));

        // The subscriber is linked again; the contract still holds the tenant.
        subscribers.unlinked.delete('t1');
        await runAt(run, RUNS_OF_THE_DAY.slice(2));
        assert.equal(run.said.error.length, 1, run.said.error.join('\n'));
        assert.equal(run.said.warn.length, 1, run.said.warn.join('\n'));
        assert.doesNotMatch(run.said.warn[0], /no subscriber/);
        assert.equal(recordOf(run, 't1'), undefined);
    });

    test('tenants without a subscriber are each said once a day', async () => {
        const run = await setUp({ subscribers: { findByTenantId: async () => null } });
        await ended(run, 't1');
        await ended(run, 't2');

        await runAt(run, RUNS_OF_THE_DAY);
        assert.equal(run.said.error.length, 2, run.said.error.join('\n'));
        assert.ok(run.said.error.some((line) => line.includes('Tenant t1 ')));
        assert.ok(run.said.error.some((line) => line.includes('Tenant t2 ')));
    });

    test('an end that names no single tenant is said once a day', async () => {
        const run = await setUp();
        await endedAt(run, ' t1', {
            subscriptionId: 'subscription-t1',
            endsAt: ENDED_AT,
            deletesOn: '2026-12-01',
        });

        await runAt(run, RUNS_OF_THE_DAY);
        assert.equal(run.said.error.length, 1, run.said.error.join('\n'));
        assert.match(run.said.error[0], /surrounding-space/);

        await runAt(run, [NEXT_DAY]);
        assert.equal(run.said.error.length, 2, run.said.error.join('\n'));
    });
});

describe('a deletion under way that fails', () => {
    test('is said by every run that meets the failure', async () => {
        const failing = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
        const run = await setUp({
            answers: {
                files: {
                    erase: () => {
                        throw failing;
                    },
                },
            },
        });
        await ended(run, 't1');

        await runAt(run, RUNS_OF_THE_DAY.slice(0, 2));
        const failures = run.said.error.filter((line) => line.includes('(ECONNRESET)'));
        assert.equal(failures.length, 2, run.said.error.join('\n'));
    });
});
