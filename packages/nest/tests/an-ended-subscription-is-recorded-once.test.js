// A subscription whose cancellation landed is recorded once, with the day its
// tenant's data is deleted on, and its tenant is held to reading from the
// moment it ended (`SC-CANC-027`, `SC-ADM-052`).
//
// The run is driven directly: the subscriptions a cancellation was declared
// for come from a port that answers what the test hands it, the ends and the
// reasons are kept in the shipped fakes, and the clock is the moment each run
// is given.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';

import { SubscriptionEndCron, SubscriptionEndService } from '../dist/billing/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const THIRTY_DAYS = { readOnlyDays: 30 };
const RUN = 'job:platform:subscription-ends';

// Midnight into 1 January in Berlin: the last day of the subscription is
// 31 December, the first day without it 1 January.
const NEW_YEAR = new Date('2026-12-31T23:00:00.000Z');
const FIRST_RUN = new Date('2026-12-31T23:15:00.000Z');

/** A cancellation declared for `tenantId`, landing at `effectiveAt`. */
const cancelled = (tenantId, effectiveAt, overrides = {}) => ({
    tenantId,
    subscriptionId: `sub-${tenantId}`,
    canceledAt: new Date('2026-10-01T09:00:00.000Z'),
    canceledEffectiveAt: effectiveAt,
    ...overrides,
});

/** The run over `subscriptions`, with the stores it writes and how often it was let across tenants. */
function runOver(subscriptions, { period = THIRTY_DAYS, ends, holds, withHolds = true } = {}) {
    const stores = {
        ends: ends ?? new FakeSubscriptionEndRepository(),
        holds: holds ?? new FakeTenantAccessHoldRepository(),
        bypassed: 0,
    };
    const usage = { findForTenant: async () => null, listCancelled: async () => subscriptions };
    const bypass = {
        runWithBypass: async (work) => {
            stores.bypassed += 1;
            return work();
        },
    };
    const service = new SubscriptionEndService(
        usage,
        stores.ends,
        period,
        BERLIN,
        bypass,
        withHolds ? stores.holds : null,
    );
    service.onModuleInit();
    // The stores object itself, so the count read afterwards is the one the run moved.
    return Object.assign(stores, { service });
}

const endedHolds = async (holds, tenantId) =>
    (await holds.listOpen(tenantId)).filter((hold) => hold.kind === 'ended');

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the run that records the subscriptions that ended', () => {
    test('records a landed cancellation once: its end, its deletion day, and the reason that holds its tenant', async () => {
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)]);

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });

        assert.deepEqual(
            ends.ends.map(({ id: _id, ...end }) => end),
            [
                {
                    tenantId: 't-1',
                    subscriptionId: 'sub-t-1',
                    endsAt: NEW_YEAR,
                    deletesOn: '2027-01-31',
                    recordedAt: FIRST_RUN,
                    recordedBy: RUN,
                },
            ],
        );
        const [hold] = await endedHolds(holds, 't-1');
        assert.deepEqual(
            { reference: hold?.reference, since: hold?.since, recordedBy: hold?.recordedBy },
            { reference: 'sub-t-1', since: NEW_YEAR, recordedBy: RUN },
        );
    });

    test('reads across tenants through the bypass', async () => {
        const run = runOver([cancelled('t-1', NEW_YEAR)]);
        await run.service.recordEnded(FIRST_RUN);
        assert.equal(run.bypassed, 1);
    });

    test('leaves a cancellation that has not landed yet, and records it once it has', async () => {
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)]);
        const aMinuteBefore = new Date(NEW_YEAR.getTime() - 60_000);

        assert.deepEqual(await service.recordEnded(aMinuteBefore), { ended: 0 });
        assert.deepEqual(ends.ends, []);
        assert.deepEqual(await endedHolds(holds, 't-1'), []);

        assert.deepEqual(await service.recordEnded(NEW_YEAR), { ended: 1 });
    });

    test('reads a row written before the two dates separated by its first date', async () => {
        const legacy = cancelled('t-1', null, { canceledAt: NEW_YEAR });
        const { service, ends } = runOver([legacy]);

        await service.recordEnded(FIRST_RUN);

        assert.equal(ends.ends[0]?.endsAt, NEW_YEAR);
        assert.equal(ends.ends[0]?.deletesOn, '2027-01-31');
    });

    test('records nothing twice when it runs again', async () => {
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)]);
        await service.recordEnded(FIRST_RUN);

        assert.deepEqual(await service.recordEnded(new Date('2027-01-01T00:15:00.000Z')), {
            ended: 0,
        });

        assert.equal(ends.ends.length, 1);
        assert.equal((await endedHolds(holds, 't-1')).length, 1);
    });

    test('counts an end it learns of late from its own day, so nobody gets less notice', async () => {
        const longAgo = new Date('2025-06-30T22:00:00.000Z');
        const { service, ends, holds } = runOver([cancelled('t-1', longAgo)]);

        await service.recordEnded(new Date('2026-11-10T09:15:00.000Z'));

        assert.equal(ends.ends[0]?.deletesOn, '2026-12-10');
        assert.equal(
            (await endedHolds(holds, 't-1'))[0]?.since,
            longAgo,
            'held from when it ended',
        );
    });

    test('moves no day already recorded when the period changes', async () => {
        const subscriptions = [cancelled('t-1', NEW_YEAR)];
        const first = runOver(subscriptions);
        await first.service.recordEnded(FIRST_RUN);

        const later = runOver(subscriptions, {
            period: { readOnlyDays: 90 },
            ends: first.ends,
            holds: first.holds,
        });
        await later.service.recordEnded(new Date('2027-01-05T09:00:00.000Z'));

        assert.equal(first.ends.ends.length, 1);
        assert.equal(first.ends.ends[0]?.deletesOn, '2027-01-31');
    });

    test('finishes what a run that stopped after holding the tenant left, without holding it twice', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        await holds.record({
            tenantId: 't-1',
            kind: 'ended',
            reference: 'sub-t-1',
            note: null,
            since: NEW_YEAR,
            recordedBy: RUN,
        });
        const { service, ends } = runOver([cancelled('t-1', NEW_YEAR)], { holds });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });

        assert.equal(ends.ends.length, 1);
        assert.equal((await endedHolds(holds, 't-1')).length, 1);
    });

    test('a run that fails while holding the tenant records no end, so the next one records both', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        const record = holds.record.bind(holds);
        let failing = true;
        holds.record = async (hold) => {
            if (failing) throw new Error('store unavailable');
            return record(hold);
        };
        const { service, ends } = runOver([cancelled('t-1', NEW_YEAR)], { holds });

        await assert.rejects(service.recordEnded(FIRST_RUN), /store unavailable/);
        assert.deepEqual(ends.ends, [], 'no end its tenant is not held for');

        failing = false;
        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });
        assert.equal((await endedHolds(holds, 't-1')).length, 1);
    });

    test('reads the ends a thousand subscriptions at a time, however many ended before', async () => {
        const many = Array.from({ length: 2500 }, (_, i) => cancelled(`t-${i}`, NEW_YEAR));
        const ends = new FakeSubscriptionEndRepository();
        const listFor = ends.listFor.bind(ends);
        const asked = [];
        ends.listFor = async (ids) => {
            asked.push(ids.length);
            return listFor(ids);
        };
        const { service } = runOver(many, { ends });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 2500 });
        assert.deepEqual(asked, [1000, 1000, 500]);

        asked.length = 0;
        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 0 }, 'each found again');
        assert.deepEqual(asked, [1000, 1000, 500]);
    });

    test("holds each subscription's own tenant, and no other", async () => {
        const { service, holds } = runOver([
            cancelled('t-1', NEW_YEAR),
            cancelled('t-2', new Date('2099-01-01T00:00:00.000Z')),
        ]);

        await service.recordEnded(FIRST_RUN);

        assert.equal((await endedHolds(holds, 't-1')).length, 1);
        assert.deepEqual(await holds.listOpen('t-2'), [], 'a tenant still running is left open');
    });

    test('where nothing keeps the reasons, as in a module wired by hand, records the end alone', async () => {
        const { service, ends } = runOver([cancelled('t-1', NEW_YEAR)], { withHolds: false });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });
        assert.equal(ends.ends.length, 1);
    });

    test('refuses to start over a port that cannot list the cancelled subscriptions, naming it', () => {
        const service = new SubscriptionEndService(
            { findForTenant: async () => null },
            new FakeSubscriptionEndRepository(),
            THIRTY_DAYS,
            BERLIN,
        );
        assert.throws(() => service.onModuleInit(), /`listCancelled`.*SC-CANC-027/s);
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the quarter-hourly run', () => {
    const quietly = (cron) => {
        // Silenced, so the error a failing run logs does not read as a failure here.
        cron.logger = new Logger('test');
        cron.logger.error = () => {};
        cron.logger.log = () => {};
        return cron;
    };

    test('records nothing under a maintenance lock; the next run catches up', async () => {
        let asked = 0;
        const service = { recordEnded: async () => ({ ended: (asked += 1) }) };
        const locked = quietly(new SubscriptionEndCron(service, { isLocked: async () => true }));

        await locked.recordEnded();

        assert.equal(asked, 0);
    });

    test('lets a failed run pass to the next one', async () => {
        let asked = 0;
        const service = {
            recordEnded: async () => {
                asked += 1;
                if (asked === 1) throw new Error('store unavailable');
                return { ended: 0 };
            },
        };
        const cron = quietly(new SubscriptionEndCron(service, null));

        await cron.recordEnded();
        await cron.recordEnded();

        assert.equal(asked, 2);
    });
});
