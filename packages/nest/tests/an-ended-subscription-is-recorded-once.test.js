// A subscription whose cancellation landed is recorded once, with the day its
// tenant's data is deleted on, and its tenant is held to reading from the
// moment it ended (`SC-CANC-027`, `SC-ADM-060`).
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
    FakeSubscriptionBundleRepository,
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const THIRTY_DAYS = { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] };
const RUN = 'job:platform:subscription-ends';

// Midnight into 1 January in Berlin: the last day of the subscription is
// 31 December, the first day without it 1 January.
const NEW_YEAR = new Date('2026-12-31T23:00:00.000Z');
const FIRST_RUN = new Date('2026-12-31T23:15:00.000Z');
const SECOND_RUN = new Date('2026-12-31T23:30:00.000Z');

/** A cancellation declared for `tenantId`, landing at `effectiveAt`. */
const cancelled = (tenantId, effectiveAt, overrides = {}) => ({
    tenantId,
    subscriptionId: `sub-${tenantId}`,
    canceledAt: new Date('2026-10-01T09:00:00.000Z'),
    canceledEffectiveAt: effectiveAt,
    ...overrides,
});

/**
 * The run over `subscriptions`, with the stores it writes and how often it was
 * let across tenants; `bookings` are the add-ons booked, where any are.
 */
function runOver(
    subscriptions,
    { period = THIRTY_DAYS, ends, holds, withHolds = true, bookings = null } = {},
) {
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
        bookings,
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
                    liftedAt: null,
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
            period: { readOnlyDays: 90, reminderDaysBefore: [29, 10, 3] },
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

    // @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
    test('a run that read the subscription before its tenant came back records nothing, and holds the tenant no second time', async () => {
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)]);
        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });
        const cameBack = new Date('2027-01-10T09:00:00.000Z');
        const [held] = await endedHolds(holds, 't-1');
        assert.ok(await holds.lift(held.id, cameBack, 'web:admin@t-1.example:app'));
        assert.equal(await ends.lift('sub-t-1', cameBack), true);

        // The port still lists the cancellation the new subscription cleared, as a
        // run that read it a moment before the tenant came back has it.
        assert.deepEqual(await service.recordEnded(new Date('2027-01-10T09:15:00.000Z')), {
            ended: 0,
        });

        assert.deepEqual(await endedHolds(holds, 't-1'), [], 'the tenant stays open');
        assert.deepEqual(await ends.listFor(['sub-t-1']), []);
        assert.equal(ends.ends.length, 1, 'the lifted end is not recorded again');
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

/** Booked on 1 March, when the subscription `sub-t-1` still ran. */
const MARCH = new Date('2026-03-01T00:00:00.000Z');
/** The last day of the period a cancellation of an add-on lands on, after the end. */
const LATER = new Date('2027-03-31T22:00:00.000Z');
/** When the cancellation of an add-on cancelled before the end was declared. */
const DECLARED = new Date('2026-02-01T09:00:00.000Z');

/** Add-on bookings of `sub-t-1`, one per entry: when each began and when its cancellation lands, where it has one. */
async function bookedOn(entries) {
    const bookings = new FakeSubscriptionBundleRepository();
    // The shipped fake has no `endNow`; this one writes as both adapters do,
    // conditional on the effective date read.
    bookings.endNow = async (id, { at, expectedCanceledEffectiveAt }) => {
        const booking = await bookings.findById(id);
        if (booking?.canceledEffectiveAt?.getTime() !== expectedCanceledEffectiveAt.getTime()) {
            return null;
        }
        return Object.assign(booking, { canceledAt: at, canceledEffectiveAt: at });
    };
    const booked = [];
    for (const { startedAt = MARCH, landsAt = null } of entries) {
        const booking = await bookings.add({
            subscriptionId: 'sub-t-1',
            bundleVersionId: 'bv-archive-1',
            startedAt,
        });
        if (landsAt) {
            await bookings.cancel(booking.id, {
                canceledAt: DECLARED,
                canceledEffectiveAt: landsAt,
            });
        }
        booked.push(booking.id);
    }
    const endOf = async (id) => {
        const booking = await bookings.findById(id);
        return [booking.canceledAt, booking.canceledEffectiveAt];
    };
    return { bookings, booked, endOf };
}

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the add-ons of a subscription that ended end with it', () => {
    test('a booking not cancelled ends at the end, and the end is recorded', async () => {
        const { bookings, booked, endOf } = await bookedOn([{}]);
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });

        assert.deepEqual(await endOf(booked[0]), [NEW_YEAR, NEW_YEAR]);
    });

    test('one cancelled for a date after the end ends at the end as well', async () => {
        const { bookings, booked, endOf } = await bookedOn([{ landsAt: LATER }]);
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        await service.recordEnded(FIRST_RUN);

        assert.deepEqual(await endOf(booked[0]), [NEW_YEAR, NEW_YEAR]);
    });

    test('one that ended before it is left as it was', async () => {
        const earlier = new Date('2026-06-30T22:00:00.000Z');
        const { bookings, booked, endOf } = await bookedOn([{ landsAt: earlier }]);
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        await service.recordEnded(FIRST_RUN);

        assert.deepEqual(await endOf(booked[0]), [DECLARED, earlier]);
    });

    test('only one that began before the end is the subscription’s: one that began with the end is left as it is', async () => {
        const { bookings, booked, endOf } = await bookedOn([
            { startedAt: new Date(NEW_YEAR.getTime() - 1) },
            { startedAt: NEW_YEAR },
        ]);
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        await service.recordEnded(FIRST_RUN);

        assert.deepEqual(await endOf(booked[0]), [NEW_YEAR, NEW_YEAR]);
        assert.deepEqual(await endOf(booked[1]), [null, null]);
    });

    test('a second run, and the end recorded again at once, change nothing', async () => {
        const { bookings, booked, endOf } = await bookedOn([{}, { landsAt: LATER }]);
        const { service, ends } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });
        await service.recordEnded(FIRST_RUN);
        const after = [await endOf(booked[0]), await endOf(booked[1])];

        assert.deepEqual(await service.recordEnded(SECOND_RUN), { ended: 0 });
        await service.recordEndOf(
            { tenantId: 't-1', subscriptionId: 'sub-t-1', endsAt: NEW_YEAR },
            SECOND_RUN,
            RUN,
        );

        assert.deepEqual([await endOf(booked[0]), await endOf(booked[1])], after);
        assert.equal(ends.ends.length, 1);
    });

    test('where one cannot be ended, neither the end nor the reason stands, and the next run records both', async () => {
        const { bookings, booked, endOf } = await bookedOn([{}, { landsAt: LATER }]);
        const endNow = bookings.endNow;
        delete bookings.endNow;
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        await assert.rejects(service.recordEnded(FIRST_RUN), /has no `endNow`/);
        assert.deepEqual(ends.ends, []);
        assert.deepEqual(await endedHolds(holds, 't-1'), []);

        bookings.endNow = endNow;
        assert.deepEqual(await service.recordEnded(SECOND_RUN), { ended: 1 });
        assert.deepEqual(await endOf(booked[1]), [NEW_YEAR, NEW_YEAR]);
        assert.equal((await endedHolds(holds, 't-1')).length, 1);
    });

    test('another instance ending the same bookings at the same moment leaves the end to be recorded', async () => {
        const { bookings, booked, endOf } = await bookedOn([{}, { landsAt: LATER }]);
        // Each write is made twice, the first time by the other instance: the
        // second, this run's, finds the booking ended already.
        const cancel = bookings.cancel.bind(bookings);
        bookings.cancel = async (id, data) => {
            await cancel(id, data);
            return cancel(id, data);
        };
        const endNow = bookings.endNow;
        bookings.endNow = async (id, input) => {
            await endNow(id, input);
            return endNow(id, input);
        };
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], { bookings });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });

        assert.deepEqual(await endOf(booked[0]), [NEW_YEAR, NEW_YEAR]);
        assert.deepEqual(await endOf(booked[1]), [NEW_YEAR, NEW_YEAR]);
    });

    test('an end recorded at once, as for a trial the application ends, ends them the same way', async () => {
        const { bookings, booked, endOf } = await bookedOn([{}, { landsAt: LATER }]);
        const { service } = runOver([], { bookings });

        await service.recordEndOf(
            { tenantId: 't-1', subscriptionId: 'sub-t-1', endsAt: NEW_YEAR },
            FIRST_RUN,
            'job:app:trials',
        );

        assert.deepEqual(await endOf(booked[0]), [NEW_YEAR, NEW_YEAR]);
        assert.deepEqual(await endOf(booked[1]), [NEW_YEAR, NEW_YEAR]);
    });
});

describe('the end of a subscription its tenant was told a day for', () => {
    /** What the tenant of `tenantId` was told when it confirmed a cancellation landing at `endsAt`. */
    const told = (ends, tenantId, endsAt, deletesOn) =>
        ends.announce({
            tenantId,
            subscriptionId: `sub-${tenantId}`,
            endsAt,
            readOnlyDays: 30,
            deletesOn,
            announcedAt: new Date('2026-10-01T09:00:00.000Z'),
            announcedBy: 'web:admin@example.com:s1',
        });

    /** Records an end its tenant was told a day for, where the period is now `readOnlyDays`. */
    const recordedWithTheDayToldUnder = async (readOnlyDays) => {
        const ends = new FakeSubscriptionEndRepository();
        await told(ends, 't-1', NEW_YEAR, '2027-01-31');
        const { service } = runOver([cancelled('t-1', NEW_YEAR)], {
            period: { readOnlyDays, reminderDaysBefore: [29, 10, 3] },
            ends,
        });

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 1 });

        assert.equal(ends.ends[0]?.deletesOn, '2027-01-31');
    };

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    describe('is recorded with that day though the period since was', () => {
        test('shortened', () => recordedWithTheDayToldUnder(10));
        test('lengthened', () => recordedWithTheDayToldUnder(90));
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('beside one told no day, which is counted with the period in force', async () => {
        const ends = new FakeSubscriptionEndRepository();
        await told(ends, 't-1', NEW_YEAR, '2027-01-31');
        const { service } = runOver([cancelled('t-1', NEW_YEAR), cancelled('t-2', NEW_YEAR)], {
            period: { readOnlyDays: 90, reminderDaysBefore: [29, 10, 3] },
            ends,
        });

        await service.recordEnded(FIRST_RUN);

        assert.deepEqual(
            ends.ends.map(({ subscriptionId, deletesOn }) => [subscriptionId, deletesOn]),
            [
                ['sub-t-1', '2027-01-31'],
                ['sub-t-2', '2027-04-01'],
            ],
        );
    });

    // @requirement SC-CANC-030 — A subscription that ends earlier than announced keeps the day its tenant was told
    test('ended earlier than it was told, at once, is recorded with the day it was told', async () => {
        // Cancelled for the end of the year and told 31 January; ended at once
        // on 15 November, which counted would give 15 December.
        const ends = new FakeSubscriptionEndRepository();
        await told(ends, 't-1', NEW_YEAR, '2027-01-31');
        const endedAtOnce = new Date('2026-11-15T10:00:00.000Z');
        const { service } = runOver([cancelled('t-1', endedAtOnce)], { ends });

        await service.recordEnded(new Date('2026-11-15T10:15:00.000Z'));

        assert.deepEqual(
            [ends.ends[0]?.endsAt, ends.ends[0]?.deletesOn],
            [endedAtOnce, '2027-01-31'],
        );
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('recorded a day late, keeps the day it was told, and holds its tenant from when it ended', async () => {
        const { service, ends, holds } = runOver([cancelled('t-1', NEW_YEAR)]);
        // Told the way a confirmation tells it, through the service that later records the end.
        const confirmedAt = new Date('2026-10-01T09:00:00.000Z');
        await service.announce(
            { tenantId: 't-1', subscriptionId: 'sub-t-1', by: 'web:admin@example.com:s1' },
            NEW_YEAR,
            service.deletionFor('sub-t-1', NEW_YEAR, confirmedAt),
            confirmedAt,
        );
        // Half past midnight into 2 January in Berlin: counted then, the day would be 1 February.
        const aDayLate = new Date('2027-01-01T23:30:00.000Z');

        assert.deepEqual(await service.recordEnded(aDayLate), { ended: 1 });

        assert.equal(ends.ends.length, 1);
        assert.equal(ends.ends[0]?.deletesOn, '2027-01-31');
        const [hold] = await endedHolds(holds, 't-1');
        assert.deepEqual(
            { reference: hold?.reference, since: hold?.since },
            { reference: 'sub-t-1', since: NEW_YEAR },
            'told a day is no end: the run still holds the tenant',
        );
    });

    // @requirement SC-CANC-030 — A subscription that ends earlier than announced keeps the day its tenant was told
    test('keeps that day only for an end that landed no later than announced, and holds its tenant whichever day it gets', async () => {
        // Each was told 31 January for an end at midnight into the new year.
        // The period in force is ninety days, so a day counted now is 1 April.
        const ends = new FakeSubscriptionEndRepository();
        const aMillisecondLater = new Date(NEW_YEAR.getTime() + 1);
        const atOnceBefore = new Date('2026-12-15T10:00:00.000Z');
        const landed = [
            ['t-at', NEW_YEAR],
            ['t-later', aMillisecondLater],
            ['t-earlier', atOnceBefore],
        ];
        for (const [tenantId] of landed) await told(ends, tenantId, NEW_YEAR, '2027-01-31');
        const { service, holds } = runOver(
            landed.map(([tenantId, endsAt]) => cancelled(tenantId, endsAt)),
            { period: { readOnlyDays: 90, reminderDaysBefore: [29, 10, 3] }, ends },
        );

        assert.deepEqual(await service.recordEnded(FIRST_RUN), { ended: 3 });

        assert.deepEqual(
            Object.fromEntries(ends.ends.map((end) => [end.subscriptionId, end.deletesOn])),
            {
                'sub-t-at': '2027-01-31',
                'sub-t-later': '2027-04-01',
                'sub-t-earlier': '2027-01-31',
            },
        );
        for (const [tenantId, endsAt] of landed) {
            const [hold] = await endedHolds(holds, tenantId);
            assert.equal(hold?.since, endsAt, `${tenantId} is held from when it ended`);
        }
    });

    test('a store that refuses a day as told already, and answers none, is named rather than taken as told', async () => {
        const ends = new FakeSubscriptionEndRepository();
        ends.announce = async () => null;
        const { service } = runOver([], { ends });

        await assert.rejects(
            service.announce(
                { tenantId: 't-1', subscriptionId: 'sub-t-1', by: 'web:admin@example.com:s1' },
                NEW_YEAR,
                service.deletionFor('sub-t-1', NEW_YEAR, FIRST_RUN),
                FIRST_RUN,
            ),
            /refused the announcement for subscription sub-t-1/,
        );
    });

    test('reads the days told a thousand subscriptions at a time, and only for the ends still to record', async () => {
        const many = Array.from({ length: 2500 }, (_, i) => cancelled(`t-${i}`, NEW_YEAR));
        const ends = new FakeSubscriptionEndRepository();
        const listAnnouncedFor = ends.listAnnouncedFor.bind(ends);
        const asked = [];
        ends.listAnnouncedFor = async (ids) => {
            asked.push(ids.length);
            return listAnnouncedFor(ids);
        };
        const { service } = runOver(many, { ends });

        await service.recordEnded(FIRST_RUN);
        assert.deepEqual(asked, [1000, 1000, 500]);

        asked.length = 0;
        await service.recordEnded(FIRST_RUN);
        assert.deepEqual(asked, [], 'every end is recorded, so no day is asked for');
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the quarter-hourly run', () => {
    /** The reminders after the ends, which none of these cases is about. */
    const NO_REMINDERS = { remindDue: async () => ({ told: 0, failed: 0 }) };
    /** The deletions after the reminders, which none of these cases is about either. */
    const NO_DELETIONS = { deleteDue: async () => ({ deleted: 0, halted: 0, failed: 0 }) };
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
        const locked = quietly(
            new SubscriptionEndCron(service, NO_REMINDERS, NO_DELETIONS, {
                isLocked: async () => true,
            }),
        );

        await locked.recordAndRemind();

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
        const cron = quietly(new SubscriptionEndCron(service, NO_REMINDERS, NO_DELETIONS, null));

        await cron.recordAndRemind();
        await cron.recordAndRemind();

        assert.equal(asked, 2);
    });
});
