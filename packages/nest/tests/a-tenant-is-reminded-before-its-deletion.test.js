// A tenant whose subscription ended is reminded before its data is deleted, at
// the lead times `config/saas.yaml` names, once per end and lead time however
// often the run repeats and however many instances run it (`SC-CANC-022`).
//
// Most of it is driven directly: the ends are kept in the shipped fake, the
// record of the notices in memory as the persistence contract asks every
// adapter to keep it, the application's port answers what the test hands it,
// and the clock is the moment each run is given. Where it matters that the
// platform wires the run — the run that records the ends driving it, the port
// and the record named once, the other runs that read the same record — it is
// compiled as `SaaSiCatModule` starts it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
    DeletionReminderService,
    SubscriptionEndCron,
    SubscriptionEndService,
    VersionNoticeCron,
} from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import {
    FIRST_RUN,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    quietLog,
} from './helpers/invoice-collection.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const LEAD_TIMES = { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] };
const RUN = 'job:platform:subscription-ends';
const DELETES_ON = '2027-01-31';

/** A moment on `day` in Berlin, where January is an hour ahead of UTC. */
const inBerlin = (day, time = '09:00') => new Date(`${day}T${time}:00.000+01:00`);

/**
 * Runs `run` at `at`, with the clock at `at` too: a reminder is recorded at the
 * moment it is taken on, as the clock says, and read back by that moment.
 */
function remindAt(run, at) {
    clockAt(at);
    return run.service.remindDue(at);
}

/** The lead times the reminders `port` was handed answer, in order. */
const leadTimesSent = (port) => port.sent.map((notice) => notice.daysBefore);

/** Records an end of `tenantId`'s subscription, deleted on `deletesOn`, and answers it as stored. */
async function anEnd(ends, { tenantId = 't-1', deletesOn = DELETES_ON, recordedAt } = {}) {
    return ends.record({
        tenantId,
        subscriptionId: `sub-${tenantId}`,
        endsAt: inBerlin('2026-12-31', '23:59'),
        deletesOn,
        recordedAt: recordedAt ?? inBerlin('2027-01-01', '00:15'),
        recordedBy: RUN,
    });
}

/**
 * The run over the stores given, or fresh ones, with how often it was let
 * across tenants and whether it is across them now.
 */
function runOver({
    ends = new FakeSubscriptionEndRepository(),
    notices = noticeRecord(),
    port = sendingPort(),
    period = LEAD_TIMES,
    settings = BERLIN,
} = {}) {
    const run = { ends, notices, port, bypassed: 0, acrossTenants: false };
    const bypass = {
        runWithBypass: async (work) => {
            run.bypassed += 1;
            run.acrossTenants = true;
            try {
                return await work();
            } finally {
                run.acrossTenants = false;
            }
        },
    };
    run.service = quietly(
        new DeletionReminderService(ends, notices, port, period, settings, bypass),
    );
    return run;
}

/** Silences what a run says in the log, so a failure it provokes does not read as one here. */
function quietly(subject) {
    subject.logger = new Logger('test');
    subject.logger.error = () => {};
    subject.logger.warn = () => {};
    subject.logger.log = () => {};
    if (subject.sender) quietly(subject.sender);
    return subject;
}

/** The record's row of `end`'s reminder for `daysBefore`. */
const rowOf = (notices, end, daysBefore) =>
    [...notices.rows.values()].find(
        (row) => row.kind === 'deletion-reminder' && row.subject === `${end.id}:${daysBefore}`,
    );

/** Takes `end`'s reminder for `daysBefore` on at `at`, as another run does, and answers the row. */
async function heldByAnotherRun(notices, end, daysBefore, at) {
    return notices.claim(
        {
            tenantId: end.tenantId,
            subscriptionId: end.subscriptionId,
            kind: 'deletion-reminder',
            subject: `${end.id}:${daysBefore}`,
        },
        { kind: 'deletion-reminder' },
        at,
        new Date(at.getTime() - 15 * 60_000),
    );
}

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the reminders before a deletion', () => {
    clockFrom(inBerlin('2027-01-01'));
    test("on the largest lead time's day, one reminder names the end, both days and the lead time, and is recorded with whom it reached and how", async () => {
        const run = runOver();
        const end = await anEnd(run.ends);

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-02', '00:15')), {
            told: 1,
            failed: 0,
        });

        assert.deepEqual(run.port.sent, [
            {
                kind: 'deletion-reminder',
                tenantId: 't-1',
                subscriptionId: 'sub-t-1',
                subscriptionEndId: end.id,
                daysBefore: 29,
                readOnlyUntil: '2027-01-30',
                deletesOn: DELETES_ON,
            },
        ]);
        const row = rowOf(run.notices, end, 29);
        assert.ok(row?.deliveredAt instanceof Date, 'delivered, with its moment');
        assert.deepEqual(row?.delivery, { recipients: ['admin@example.com'], channel: 'email' });
    });

    test('none the day before, by a quarter of an hour', async () => {
        const run = runOver();
        await anEnd(run.ends);

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-01', '23:45')), {
            told: 0,
            failed: 0,
        });
        assert.deepEqual(run.port.sent, []);
    });

    test('a run that repeats, the same day or the next, sends nothing twice', async () => {
        const run = runOver();
        await anEnd(run.ends);

        await remindAt(run, inBerlin('2027-01-02', '00:15'));
        await remindAt(run, inBerlin('2027-01-02', '00:30'));
        await remindAt(run, inBerlin('2027-01-03'));

        assert.deepEqual(leadTimesSent(run.port), [29]);
    });

    test('each later lead time goes on its own day, and none after the deletion day has come', async () => {
        const run = runOver();
        await anEnd(run.ends);

        for (const day of ['2027-01-02', '2027-01-20', '2027-01-21', '2027-01-27', '2027-01-28']) {
            await remindAt(run, inBerlin(day));
        }
        assert.deepEqual(leadTimesSent(run.port), [29, 10, 3]);

        await remindAt(run, inBerlin('2027-01-30', '23:59'));
        await remindAt(run, inBerlin('2027-01-31', '00:00'));
        await remindAt(run, inBerlin('2027-02-01'));
        assert.deepEqual(leadTimesSent(run.port), [29, 10, 3]);
    });

    test('ten days to go when the end is recorded: the 29- and 10-day lead times are covered by one reminder at once, and the 3-day one goes on its day', async () => {
        const run = runOver();
        // Recorded on 21 January with ten days to go: the 29-day lead time has
        // passed, and the 10-day one is due that day.
        await anEnd(run.ends, { recordedAt: inBerlin('2027-01-21', '00:15') });

        await remindAt(run, inBerlin('2027-01-21', '00:15'));
        await remindAt(run, inBerlin('2027-01-27'));
        await remindAt(run, inBerlin('2027-01-28'));

        assert.deepEqual(leadTimesSent(run.port), [10, 3]);
    });

    test('an end whose deletion day has come, or passed, is reminded of nothing', async () => {
        const run = runOver();
        await anEnd(run.ends, { tenantId: 't-today', deletesOn: '2027-01-31' });
        await anEnd(run.ends, { tenantId: 't-past', deletesOn: '2027-01-15' });

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-31', '00:15')), {
            told: 0,
            failed: 0,
        });
        assert.deepEqual(run.port.sent, []);
    });

    test("reads every tenant's ends and reminders in one go, across tenants through the bypass", async () => {
        const run = runOver();
        await anEnd(run.ends, { tenantId: 't-1' });
        await anEnd(run.ends, { tenantId: 't-2' });
        // The run belongs to no tenant, so row-level security shows a read
        // outside the bypass none of the tenants' rows.
        const listDeletingAfter = run.ends.listDeletingAfter.bind(run.ends);
        run.ends.listDeletingAfter = async (...args) =>
            run.acrossTenants ? listDeletingAfter(...args) : [];
        let reads = 0;
        const listOfKindSince = run.notices.listOfKindSince;
        run.notices.listOfKindSince = async (...args) => {
            reads += 1;
            return run.acrossTenants ? listOfKindSince(...args) : [];
        };

        await remindAt(run, inBerlin('2027-01-02'));

        assert.deepEqual(
            run.port.sent.map((notice) => notice.tenantId),
            ['t-1', 't-2'],
        );
        assert.equal(reads, 1, 'one read of the reminders, not one per end');
        assert.equal(run.bypassed, 1);
    });

    test('two instances racing over one end send its reminder once', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const notices = noticeRecord();
        await anEnd(ends);
        // Both instances read the ends and the reminders before either takes
        // one on: what keeps the second from sending is the claim alone.
        const port = sendingPort(async () => {
            await new Promise((resolve) => setImmediate(resolve));
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const first = runOver({ ends, notices, port });
        const second = runOver({ ends, notices, port });

        const runs = await Promise.all([
            remindAt(first, inBerlin('2027-01-02')),
            remindAt(second, inBerlin('2027-01-02')),
        ]);

        assert.deepEqual(leadTimesSent(port), [29]);
        assert.deepEqual(runs.map((each) => each.told).sort(), [0, 1]);
    });

    test('a port that throws lets the reminder go, and the next run sends it', async () => {
        let calls = 0;
        const port = sendingPort(() => {
            calls += 1;
            if (calls === 1) throw new Error('mail server unreachable');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const run = runOver({ port });
        const end = await anEnd(run.ends);

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-02', '00:15')), {
            told: 0,
            failed: 1,
        });
        const released = rowOf(run.notices, end, 29);
        assert.deepEqual([released?.claimedAt, released?.deliveredAt], [null, null]);

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-02', '00:30')), {
            told: 1,
            failed: 0,
        });
        assert.deepEqual(leadTimesSent(run.port), [29, 29]);
        assert.ok(rowOf(run.notices, end, 29)?.deliveredAt instanceof Date);
    });

    test('a port that tells nobody is recorded as told to nobody and not tried again; the next lead time still goes on its day', async () => {
        const port = sendingPort({ recipients: [], channel: 'email' });
        const run = runOver({ port });
        const end = await anEnd(run.ends);

        await remindAt(run, inBerlin('2027-01-02', '00:15'));
        await remindAt(run, inBerlin('2027-01-02', '00:30'));
        await remindAt(run, inBerlin('2027-01-21'));

        assert.deepEqual(leadTimesSent(run.port), [29, 10]);
        const row = rowOf(run.notices, end, 29);
        assert.ok(row?.deliveredAt instanceof Date);
        assert.deepEqual(row?.delivery, { recipients: [], channel: 'email' });
    });

    test('a reminder that cannot be put together fails for its end alone, and the next run sends it', async () => {
        const run = runOver();
        const broken = await anEnd(run.ends, { tenantId: 't-broken' });
        await anEnd(run.ends, { tenantId: 't-sound' });
        const deletesOn = broken.deletesOn;
        run.ends.ends.find((end) => end.id === broken.id).deletesOn = '2027-02-3x';

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-02')), {
            told: 1,
            failed: 1,
        });
        assert.deepEqual(
            run.port.sent.map((notice) => notice.tenantId),
            ['t-sound'],
        );

        run.ends.ends.find((end) => end.id === broken.id).deletesOn = deletesOn;
        await remindAt(run, inBerlin('2027-01-02', '09:15'));
        assert.deepEqual(
            run.port.sent.map((notice) => notice.tenantId),
            ['t-sound', 't-broken'],
        );
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('a reminder another run still holds', () => {
    clockFrom(inBerlin('2027-01-01'));
    // Leads of 10 and 3 days; another run took the 10-day reminder on at five
    // to midnight into 28 January and has had no answer from the application
    // yet, when the 3-day lead time falls due.
    const LATE = { readOnlyDays: 30, reminderDaysBefore: [10, 3] };
    const TAKEN = inBerlin('2027-01-27', '23:55');
    const AFTER_MIDNIGHT = inBerlin('2027-01-28', '00:05');

    test('holds back the smaller lead time, so no second e-mail goes out alongside it', async () => {
        const run = runOver({ period: LATE });
        const end = await anEnd(run.ends);
        await heldByAnotherRun(run.notices, end, 10, TAKEN);

        assert.deepEqual(await remindAt(run, AFTER_MIDNIGHT), { told: 0, failed: 0 });
        assert.deepEqual(run.port.sent, []);
    });

    test('once delivered, covers what it covers, and the smaller lead time goes by the next run', async () => {
        const run = runOver({ period: LATE });
        const end = await anEnd(run.ends);
        const held = await heldByAnotherRun(run.notices, end, 10, TAKEN);
        await remindAt(run, AFTER_MIDNIGHT);

        // Delivered a minute later; the claim it was delivered under would
        // still be fresh at the next run.
        await run.notices.confirm(
            held.id,
            held.claimedAt,
            { recipients: ['admin@example.com'], channel: 'email' },
            inBerlin('2027-01-28', '00:06'),
        );
        await remindAt(run, inBerlin('2027-01-28', '00:08'));
        await remindAt(run, inBerlin('2027-01-29'));

        assert.deepEqual(leadTimesSent(run.port), [3]);
    });

    test('once let go, covers nothing: the smaller lead time goes, and the larger one never', async () => {
        const run = runOver({ period: LATE });
        const end = await anEnd(run.ends);
        const held = await heldByAnotherRun(run.notices, end, 10, TAKEN);
        await remindAt(run, AFTER_MIDNIGHT);

        await run.notices.release(held.id, held.claimedAt);
        await remindAt(run, inBerlin('2027-01-28', '00:08'));
        await remindAt(run, inBerlin('2027-01-29'));

        assert.deepEqual(leadTimesSent(run.port), [3]);
    });

    test('a claim older than a quarter of an hour holds back nothing', async () => {
        const run = runOver({ period: LATE });
        const end = await anEnd(run.ends);
        await heldByAnotherRun(run.notices, end, 10, inBerlin('2027-01-27', '23:49'));

        await remindAt(run, AFTER_MIDNIGHT);

        assert.deepEqual(leadTimesSent(run.port), [3]);
    });

    test('taken on by an instance whose clock runs behind the one that recorded the end, still holds it back', async () => {
        const run = runOver({ period: LATE });
        const end = await anEnd(run.ends, { recordedAt: inBerlin('2027-01-27', '23:58') });
        // Five minutes behind: the claim reads as made before the end was recorded.
        await heldByAnotherRun(run.notices, end, 10, inBerlin('2027-01-27', '23:53'));

        await remindAt(run, inBerlin('2027-01-28', '00:05'));

        assert.deepEqual(run.port.sent, []);
    });

    test("holds back only its own end's reminders", async () => {
        const run = runOver({ period: LATE });
        const held = await anEnd(run.ends, { tenantId: 't-held' });
        await anEnd(run.ends, { tenantId: 't-free' });
        await heldByAnotherRun(run.notices, held, 10, TAKEN);

        await remindAt(run, AFTER_MIDNIGHT);

        assert.deepEqual(
            run.port.sent.map((notice) => [notice.tenantId, notice.daysBefore]),
            [['t-free', 3]],
        );
    });
});

/**
 * Lets the calls of racing runs that `steps` names happen one after another, in
 * that order: a named call waits until the steps before it have finished. A
 * call `steps` does not name, or no longer names, goes straight through.
 */
function inOrder(steps) {
    let next = 0;
    const waiting = new Map();
    return {
        async turn(step) {
            if (!steps.slice(next).includes(step)) return false;
            if (steps[next] !== step) await new Promise((resolve) => waiting.set(step, resolve));
            return true;
        },
        done() {
            next += 1;
            const resume = waiting.get(steps[next]);
            waiting.delete(steps[next]);
            resume?.();
        },
    };
}

/**
 * `notices` as run `name` uses it, its reads of the reminders (`read`), its
 * claims (`claim`), its fresh reads of one end's (`check`) and its letting go
 * of a claim (`release`) taken when `order` lets them.
 */
function steppedFor(name, notices, order) {
    const step =
        (method, as) =>
        async (...args) => {
            const gated = await order.turn(`${name}.${as}`);
            try {
                return await notices[method](...args);
            } finally {
                if (gated) order.done();
            }
        };
    return {
        ...notices,
        listOfKindSince: step('listOfKindSince', 'read'),
        claim: step('claim', 'claim'),
        listForSubscription: step('listForSubscription', 'check'),
        release: step('release', 'release'),
    };
}

/**
 * Two instances deciding on one end at the same moment, seven days before its
 * deletion: A started with the lead times 29, 10 and 3 and decides on 10, B was
 * restarted with 29, 7 and 3 and decides on 7. Both read the reminders before
 * either claims one, so both decide on an empty record, and their claims are
 * of different lead times. The rest of the run goes in `order`.
 */
async function racedDifferently(order) {
    const ends = new FakeSubscriptionEndRepository();
    const notices = noticeRecord();
    const port = sendingPort();
    await anEnd(ends);
    const steps = inOrder(['A.read', 'B.read', ...order]);
    const a = runOver({ ends, port, notices: steppedFor('A', notices, steps) });
    const b = runOver({
        ends,
        port,
        notices: steppedFor('B', notices, steps),
        period: { readOnlyDays: 30, reminderDaysBefore: [29, 7, 3] },
    });
    const at = inBerlin('2027-01-24');
    await Promise.all([remindAt(a, at), remindAt(b, at)]);
    return { ends, notices, port };
}

/** Every order of the two claims and the two checks after them, each run claiming before it checks. */
const RACES = [
    ['A.claim', 'A.check', 'B.claim', 'B.check'],
    ['A.claim', 'B.claim', 'A.check', 'B.check'],
    ['A.claim', 'B.claim', 'B.check', 'A.check'],
    ['B.claim', 'A.claim', 'A.check', 'B.check'],
    ['B.claim', 'A.claim', 'B.check', 'A.check'],
    ['B.claim', 'B.check', 'A.claim', 'A.check'],
];

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('two instances deciding on different lead times at once', { timeout: 5000 }, () => {
    clockFrom(inBerlin('2027-01-01'));

    test('never send two reminders, whatever the order of the two claims and the two checks', async () => {
        for (const order of RACES) {
            const { port } = await racedDifferently(order);
            const sent = leadTimesSent(port);

            assert.ok(sent.length <= 1, `${order.join(', ')}: sent ${JSON.stringify(sent)}`);
            // A run that checked before the other claimed saw nothing of it,
            // and sends; the other then sees it and lets go. Where each
            // claimed before the other checked, whether one sends depends on
            // whether the first to let go did so before the other read.
            const before = (x, y) => order.indexOf(x) < order.indexOf(y);
            if (before('A.check', 'B.claim')) assert.deepEqual(sent, [10], order.join(', '));
            if (before('B.check', 'A.claim')) assert.deepEqual(sent, [7], order.join(', '));
        }
    });

    test('where each sees the other, both let go and nothing goes; the next run sends exactly one', async () => {
        const { ends, notices, port } = await racedDifferently([
            'A.claim',
            'B.claim',
            'A.check',
            'B.check',
            'A.release',
            'B.release',
        ]);
        assert.deepEqual(leadTimesSent(port), []);

        // A quarter of an hour on, the next run's lease still covers a claim
        // that was not let go; one that was let go holds nothing back.
        const next = runOver({ ends, notices, port });
        await remindAt(next, inBerlin('2027-01-24', '09:15'));
        assert.deepEqual(leadTimesSent(port), [10]);

        await remindAt(next, inBerlin('2027-01-24', '09:30'));
        assert.deepEqual(leadTimesSent(port), [10]);
    });

    test('a fresh read that fails lets the claim go as a failure, and the next run sends the reminder', async () => {
        const notices = noticeRecord();
        const listForSubscription = notices.listForSubscription;
        let failing = true;
        notices.listForSubscription = async (...args) => {
            if (failing) throw new Error('the database is gone');
            return listForSubscription(...args);
        };
        const run = runOver({ notices });
        await anEnd(run.ends);

        assert.deepEqual(await remindAt(run, inBerlin('2027-01-24')), { told: 0, failed: 1 });
        assert.deepEqual(leadTimesSent(run.port), []);

        failing = false;
        assert.deepEqual(await remindAt(run, inBerlin('2027-01-24', '09:15')), {
            told: 1,
            failed: 0,
        });
        assert.deepEqual(leadTimesSent(run.port), [10]);
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('a reminder of a larger lead time left undelivered', () => {
    clockFrom(inBerlin('2027-01-01'));
    test('is never sent once a smaller one is due, through every run until the deletion day', async () => {
        let failing = true;
        const port = sendingPort(() => {
            if (failing) throw new Error('mail server unreachable');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const run = runOver({ port });
        const end = await anEnd(run.ends);
        await remindAt(run, inBerlin('2027-01-02'));

        // No run until the 10-day lead time; from then on, one every day.
        failing = false;
        for (let date = 21; date <= 31; date += 1) {
            await remindAt(run, inBerlin(`2027-01-${date}`));
        }

        assert.deepEqual(leadTimesSent(run.port), [29, 10, 3]);
        assert.equal(rowOf(run.notices, end, 29)?.deliveredAt, null, 'left as it was');
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the lead times a reminder is decided by', () => {
    clockFrom(inBerlin('2027-01-01'));
    test("are the file's the application started with: changed and restarted after the end was recorded, the new ones apply to it and nothing is told twice", async () => {
        const before = runOver();
        await anEnd(before.ends);
        await remindAt(before, inBerlin('2027-01-02'));

        // The application restarts with other lead times, over the same ends
        // and the same record. 40 days was due before the end was recorded,
        // and the reminder told at 29 covers it; 20 and 5 are new, and go on
        // their days.
        const { ends, notices, port } = before;
        const period = { readOnlyDays: 30, reminderDaysBefore: [40, 20, 5] };
        const after = runOver({ ends, notices, port, period });
        for (const day of ['2027-01-02', '2027-01-11', '2027-01-21', '2027-01-26', '2027-01-28']) {
            await remindAt(after, inBerlin(day));
        }

        assert.deepEqual(leadTimesSent(port), [29, 20, 5]);
    });

    test("count the installation's day ahead of UTC, not UTC's", async () => {
        const run = runOver();
        await anEnd(run.ends);

        // Half past midnight into 2 January in Berlin, still 1 January in UTC.
        await remindAt(run, new Date('2027-01-01T23:30:00.000Z'));

        assert.deepEqual(leadTimesSent(run.port), [29]);
    });

    test("count the installation's day behind UTC, not UTC's", async () => {
        const run = runOver({ settings: { timeZone: 'America/New_York' } });
        await anEnd(run.ends);

        // Ten in the evening of 1 January in New York, already 2 January in UTC.
        await remindAt(run, new Date('2027-01-02T03:00:00.000Z'));
        assert.deepEqual(run.port.sent, []);

        await remindAt(run, new Date('2027-01-02T05:00:00.000Z'));
        assert.deepEqual(leadTimesSent(run.port), [29]);
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the quarter-hourly run', () => {
    /** The run over services that note what they are asked, in order. */
    function cronOver({ recordEnded, remindDue, maintenance = null } = {}) {
        const asked = [];
        const ends = {
            recordEnded: async () => {
                asked.push('record');
                return recordEnded ? recordEnded() : { ended: 0 };
            },
        };
        const reminders = {
            remindDue: async () => {
                asked.push('remind');
                return remindDue ? remindDue() : { told: 0, failed: 0 };
            },
        };
        return { asked, cron: quietly(new SubscriptionEndCron(ends, reminders, maintenance)) };
    }

    test('records the ends first and reminds after', async () => {
        const { asked, cron } = cronOver();

        await cron.recordAndRemind();

        assert.deepEqual(asked, ['record', 'remind']);
    });

    test('a run whose recording fails still reminds the ends recorded before', async () => {
        const { asked, cron } = cronOver({
            recordEnded: () => {
                throw new Error('store unavailable');
            },
        });

        await cron.recordAndRemind();

        assert.deepEqual(asked, ['record', 'remind']);
    });

    test('a run whose reminding fails lets the next one try again', async () => {
        let failing = true;
        const { asked, cron } = cronOver({
            remindDue: () => {
                if (failing) throw new Error('store unavailable');
                return { told: 0, failed: 0 };
            },
        });

        await cron.recordAndRemind();
        failing = false;
        await cron.recordAndRemind();

        assert.deepEqual(asked, ['record', 'remind', 'record', 'remind']);
    });

    test('under a maintenance lock neither records nor reminds; the next run catches up', async () => {
        const { asked, cron } = cronOver({ maintenance: { isLocked: async () => true } });

        await cron.recordAndRemind();

        assert.deepEqual(asked, []);
    });

    test('a run still going when the next is due lets it pass, and nothing is asked twice', async () => {
        let finish;
        const { asked, cron } = cronOver({
            recordEnded: () => new Promise((resolve) => (finish = () => resolve({ ended: 0 }))),
        });

        const running = cron.recordAndRemind();
        await new Promise((resolve) => setImmediate(resolve));
        await cron.recordAndRemind();
        finish();
        await running;

        assert.deepEqual(asked, ['record', 'remind']);
    });
});

/**
 * The platform as `SaaSiCatModule` composes it, its ends, holds and subscription
 * usage in memory, and the notices going through `port` into `record`, both
 * named under `tenantBilling.notices`. The file keeps a read-only period of ten
 * days, shorter than the 29-day lead time and as long as the 10-day one.
 */
async function platformOver({
    cancelled = [],
    port,
    record,
    holds,
    versionNotices,
    includeCron = true,
}) {
    const options = everythingOnOptions();
    const tenantBilling = {
        ...options.tenantBilling,
        notices: { port, record },
        subscriptionEnds: { ...options.tenantBilling.subscriptionEnds, includeCron },
    };
    if (versionNotices) tenantBilling.versionNotices = versionNotices;
    const composed = bootable({
        ...options,
        planCatalog: {
            ...options.planCatalog,
            tenantBilling: {
                ...options.planCatalog.tenantBilling,
                endOfSubscription: { readOnlyDays: 10, reminderDaysBefore: [29, 10, 3] },
            },
        },
        tenantBilling,
    });
    composed.persistence.core.rlsBypass = { runWithBypass: (work) => work() };
    composed.persistence.core.subscriptionEnds = new FakeSubscriptionEndRepository();
    composed.persistence.core.tenantAccessHolds = holds ?? new FakeTenantAccessHoldRepository();
    composed.persistence.tenantBilling.subscriptionUsagePort = {
        findForTenant: async () => null,
        listCancelled: async () => cancelled,
    };
    const moduleRef = await Test.createTestingModule({
        imports: [SaaSiCatModule.forRoot(composed)],
    }).compile();
    // What the application's start does for the service that finds the ends.
    moduleRef.get(SubscriptionEndService, { strict: false }).onModuleInit();
    return moduleRef;
}

/** A cancellation of `tenantId`'s subscription that landed at `effectiveAt`. */
const cancelledFor = (tenantId, effectiveAt) => ({
    tenantId,
    subscriptionId: `sub-${tenantId}`,
    canceledAt: new Date('2026-12-01T09:00:00.000Z'),
    canceledEffectiveAt: effectiveAt,
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the reminders, as the platform wires them', () => {
    test('an end the run records is reminded by the same run where a lead time is already due, through the port and into the record named', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: inBerlin('2027-01-21', '00:15') });
        const port = sendingPort();
        const record = noticeRecord();
        const moduleRef = await platformOver({
            cancelled: [cancelledFor('t-1', inBerlin('2027-01-20', '23:59'))],
            port,
            record,
        });

        await quietly(moduleRef.get(SubscriptionEndCron, { strict: false })).recordAndRemind();

        assert.deepEqual(
            port.sent.map(({ kind, tenantId, daysBefore, readOnlyUntil, deletesOn }) => ({
                kind,
                tenantId,
                daysBefore,
                readOnlyUntil,
                deletesOn,
            })),
            [
                {
                    kind: 'deletion-reminder',
                    tenantId: 't-1',
                    daysBefore: 10,
                    readOnlyUntil: '2027-01-30',
                    deletesOn: '2027-01-31',
                },
            ],
        );
        assert.equal([...record.rows.values()][0]?.delivery?.channel, 'email');
        await moduleRef.close();
    });

    test('the run that records the ends reminds after them; without it, the reminders are there for the application to call', async () => {
        const find = (moduleRef, type) => {
            try {
                return moduleRef.get(type, { strict: false });
            } catch (error) {
                if (error?.constructor?.name === 'UnknownElementException') return null;
                throw error;
            }
        };
        const scheduled = await platformOver({ port: sendingPort(), record: noticeRecord() });
        const reminders = find(scheduled, DeletionReminderService);
        assert.ok(reminders instanceof DeletionReminderService);
        assert.equal(find(scheduled, SubscriptionEndCron)?.reminders, reminders);
        await scheduled.close();

        const own = await platformOver({
            port: sendingPort(),
            record: noticeRecord(),
            includeCron: false,
        });
        assert.equal(find(own, SubscriptionEndCron), null);
        assert.ok(find(own, DeletionReminderService) instanceof DeletionReminderService);
        await own.close();
    });

    test('a suspended tenant is reminded all the same: a suspension does not stop its deletion', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: inBerlin('2027-01-21', '00:15') });
        const holds = new FakeTenantAccessHoldRepository();
        await holds.record({
            tenantId: 't-1',
            kind: 'suspended',
            reference: 'operator',
            note: 'abuse',
            since: inBerlin('2027-01-05'),
            recordedBy: 'web:operator@example.com:s1',
        });
        const port = sendingPort();
        const moduleRef = await platformOver({
            cancelled: [cancelledFor('t-1', inBerlin('2027-01-20', '23:59'))],
            port,
            record: noticeRecord(),
            holds,
        });

        await quietly(moduleRef.get(SubscriptionEndCron, { strict: false })).recordAndRemind();

        assert.deepEqual((await holds.listOpen('t-1')).map((hold) => hold.kind).sort(), [
            'ended',
            'suspended',
        ]);
        assert.deepEqual(leadTimesSent(port), [10]);
        await moduleRef.close();
    });

    test("is left alone by the version notice run, which sweeps every other kind's notices left undelivered", async () => {
        const end = { id: 'end-1', tenantId: 't-1', subscriptionId: 'sub-t-1' };
        const record = noticeRecord();
        const asked = [];
        const listUndelivered = record.listUndelivered;
        record.listUndelivered = async (kind, staleBefore) => {
            asked.push(kind);
            return listUndelivered(kind, staleBefore);
        };
        const held = await heldByAnotherRun(record, end, 29, new Date('2027-01-02T08:00:00.000Z'));
        await record.release(held.id, held.claimedAt);
        const port = sendingPort();
        const moduleRef = await platformOver({ port, record, versionNotices: {} });

        await quietly(moduleRef.get(VersionNoticeCron, { strict: false })).sendDueNotices();

        assert.ok(asked.includes('version-retired'), 'the retirement notices were swept');
        assert.ok(asked.includes('bundle-version-retired'), 'and the add-on retirement notices');
        assert.ok(asked.includes('feature-withdrawn'), 'and the withdrawal notices');
        assert.equal(asked.includes('deletion-reminder'), false);
        assert.deepEqual(port.sent, []);
        assert.equal(rowOf(record, end, 29)?.deliveredAt, null);
        await moduleRef.close();
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('a reminder left undelivered, in the record the invoice collections tell from', () => {
    clockFrom(FIRST_RUN);

    test('is not told by the collection run, which tells its own notices left undelivered', async () => {
        quietLog();
        const { collect, mail, notices } = await anInvoiceToCollect();
        const end = { id: 'end-1', tenantId: 't1', subscriptionId: 'subscription-1' };
        const held = await heldByAnotherRun(notices, end, 29, FIRST_RUN);
        await notices.release(held.id, held.claimedAt);
        const asked = [];
        const listUndelivered = notices.listUndelivered;
        notices.listUndelivered = async (kind, staleBefore) => {
            asked.push(kind);
            return listUndelivered(kind, staleBefore);
        };

        await collect(FIRST_RUN);

        assert.ok(asked.includes('collection-failed'), 'the run told what it had left');
        assert.equal(asked.includes('deletion-reminder'), false);
        assert.deepEqual(
            mail.told.filter((told) => told.notice.kind === 'deletion-reminder'),
            [],
        );
        assert.equal(rowOf(notices, end, 29)?.deliveredAt, null);
    });
});
