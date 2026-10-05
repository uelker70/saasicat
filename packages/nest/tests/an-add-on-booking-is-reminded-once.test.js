// An add-on retirement reminds once: 14 days before a booking's date, a booking
// that staying put costs something is reminded through the application's
// notice port, once however often the run comes, priced for the plan it runs
// beside at the date, and the operator sees how many were.
//
// Every case announces Reports v1 → v2 for the monthly bookings of t1 and t2
// (yearly Standard subscriptions), whose date is 1 February 2027; v2 costs
// 12.90 a month beside Standard where v1 costs 9.90.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import {
    BundleRetirementReminderService,
    BundleRetirementSwitchService,
    VersionNoticeCron,
} from '../dist/billing/index.js';
import {
    ACTOR,
    NOW,
    REPLACEMENT,
    RETIRED,
    bookingOf,
    retiring,
    subscriptionOf,
} from './helpers/add-on-retirement-fixtures.js';
import { sendingPort } from './helpers/version-notices.js';

const DAY = 24 * 60 * 60 * 1000;
const THE_DATE = new Date('2027-02-01T00:00:00.000Z');
/** 14 days before 1 February: the day the reminder is due. */
const REMIND_AT = new Date(THE_DATE.getTime() - 14 * DAY);
const QUARTER_HOUR = 15 * 60 * 1000;
const KIND = 'bundle-version-retirement-reminder';

async function announced(options = {}) {
    const world = retiring(options);
    await world.service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
    return world;
}

/**
 * The reminder run over `world`, asking the real switch what a switch now
 * would cost. `ahead` are the plans the subscriptions are set to move to;
 * `port` is the application's, the world's unless said.
 */
function reminding(
    world,
    { ahead = [], port = world.port, bypass = null, plansAhead, catalogue = world.catalogue } = {},
) {
    const plans = plansAhead ?? { of: async () => ahead };
    const switches = new BundleRetirementSwitchService(
        world.service,
        world.catalogue,
        world.bookingRepository,
        world.usage,
        plans,
        { invalidateTenant() {} },
    );
    return new BundleRetirementReminderService(
        world.notices,
        port,
        world.bookingRepository,
        world.usage,
        catalogue,
        plans,
        switches,
        bypass,
    );
}

/** The reminders `port` was handed. */
const remindersSent = (port) => port.sent.filter((notice) => notice.kind === KIND);

/** The reminders the record holds, as the record keeps them. */
const remindersIn = (world) => [...world.notices.rows.values()].filter((row) => row.kind === KIND);

// @requirement SC-BUN-056 — Where staying put costs something, a booking is reminded once
describe('the one reminder of an add-on retirement', () => {
    test('reminds 14 days before the date, as it was told, with what a switch now would cost', async () => {
        const world = await announced();
        const told = world.port.sent.find((notice) => notice.subscriptionBundleId === 'sb-t1');

        const run = await reminding(world).remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 2, failed: 0 });
        const [reminder] = remindersSent(world.port).filter(
            (notice) => notice.subscriptionBundleId === 'sb-t1',
        );
        assert.deepEqual(reminder, {
            ...told,
            kind: KIND,
            switchTerms: {
                priceNet: 12.9,
                held: { priceNet: 9.9, amountNet: 3, lastDay: '2027-01-31' },
                billingCycle: 'MONTHLY',
            },
        });
        const recorded = remindersIn(world).find((row) => row.subscriptionId === 'sub-t1');
        assert.equal(recorded.subject, RETIRED.id, 'once per booking and add-on version retired');
        assert.deepEqual(recorded.delivery, {
            recipients: ['admin@example.com'],
            channel: 'email',
        });
    });

    test('reminds nothing before its day, and catches up a run that did not happen until the date', async () => {
        const early = await announced();
        const late = await announced();
        const atTheDate = await announced();

        const before = await reminding(early).remindDue(new Date(REMIND_AT.getTime() - 1));
        const eightDaysLate = await reminding(late).remindDue(
            new Date(REMIND_AT.getTime() + 8 * DAY),
        );
        const tooLate = await reminding(atTheDate).remindDue(THE_DATE);

        assert.deepEqual([before.told, eightDaysLate.told, tooLate.told], [0, 2, 0]);
    });

    test('reminds once, however often the run comes', async () => {
        const world = await announced();
        const service = reminding(world);

        await service.remindDue(REMIND_AT);
        const again = await service.remindDue(new Date(REMIND_AT.getTime() + QUARTER_HOUR));

        assert.deepEqual(again, { told: 0, failed: 0 });
        assert.equal(remindersSent(world.port).length, 2);
    });

    test('reminds nobody where staying put costs nothing: no dearer, nothing taken away', async () => {
        const sameAsBefore = { ...REPLACEMENT, monthlyNet: '9.90', yearlyNet: '99.00' };
        const world = await announced({ versions: [RETIRED, sameAsBefore] });

        const run = await reminding(world).remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 0, failed: 0 });
        assert.deepEqual(remindersIn(world), []);
    });

    test('reminds where a feature is taken away, whatever the price', async () => {
        const cheaperButLess = {
            ...REPLACEMENT,
            monthlyNet: '8.90',
            yearlyNet: '89.00',
            quotas: { reports: 5 },
        };
        const world = await announced({ versions: [RETIRED, cheaperButLess] });

        const run = await reminding(world).remindDue(REMIND_AT);

        assert.equal(run.told, 2);
    });

    test('prices it for the plan the add-on runs beside at the date, not as the notice said', async () => {
        // Told beside Standard, where v2 is dearer; on Pro since, where it costs
        // what v1 did.
        const evenOnPro = {
            ...REPLACEMENT,
            pricingOverrides: [{ planId: 'PRO', monthlyNet: '9.90', yearlyNet: '99.00' }],
        };
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions, versions: [RETIRED, evenOnPro] });
        subscriptions[0] = subscriptionOf('t1', { plan: 'PRO' });

        await reminding(world).remindDue(REMIND_AT);

        assert.deepEqual(
            remindersSent(world.port).map((notice) => [
                notice.subscriptionBundleId,
                notice.planKey,
            ]),
            [['sb-t2', 'STANDARD']],
        );
    });

    test('judges a booking billed with its plan in the rhythm that plan is billed in at the date', async () => {
        // t1 is billed with its yearly plan; one replacement is dearer only by
        // the month, the other only by the year.
        const remindedOfT1 = async (replacement) => {
            const world = await announced({
                versions: [RETIRED, replacement],
                bookings: [bookingOf('t1', { billingCycle: null }), bookingOf('t2')],
            });
            const told = world.port.sent.find((notice) => notice.subscriptionBundleId === 'sb-t1');
            await reminding(world).remindDue(new Date(Date.parse(told.effectiveAt) - 14 * DAY));
            return remindersSent(world.port).some(
                (notice) => notice.subscriptionBundleId === 'sb-t1',
            );
        };

        const byTheMonth = await remindedOfT1({ ...REPLACEMENT, yearlyNet: '99.00' });
        const byTheYear = await remindedOfT1({ ...REPLACEMENT, monthlyNet: '9.90' });

        assert.deepEqual([byTheMonth, byTheYear], [false, true]);
    });

    test('leaves alone a booking that switched or has cancelled, and one whose subscription ends by the date', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const cases = {
            switched: async (world) => {
                await world.bookingRepository.moveToVersion('sb-t1', RETIRED.id, REPLACEMENT.id);
            },
            bookingCancelled: async (world) => {
                world.bookingRepository.rows[0] = {
                    ...world.bookingRepository.rows[0],
                    canceledAt: new Date('2026-12-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2027-04-01T00:00:00.000Z'),
                };
            },
            subscriptionEndsOnTheDate: async () => {
                subscriptions[0] = subscriptionOf('t1', {
                    canceledAt: new Date('2026-12-01T00:00:00.000Z'),
                    canceledEffectiveAt: THE_DATE,
                });
            },
        };
        const reminded = {};
        for (const [name, change] of Object.entries(cases)) {
            subscriptions[0] = subscriptionOf('t1');
            const world = await announced({ subscriptions });
            await change(world);
            await reminding(world).remindDue(REMIND_AT);
            reminded[name] = remindersSent(world.port).map((notice) => notice.subscriptionBundleId);
        }

        assert.deepEqual(reminded, {
            switched: ['sb-t2'],
            bookingCancelled: ['sb-t2'],
            subscriptionEndsOnTheDate: ['sb-t2'],
        });
    });

    test('reminds a booking whose subscription ends after the date, which can still cancel or switch', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            canceledAt: new Date('2026-12-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2028-01-01T00:00:00.000Z'),
        });

        await reminding(world).remindDue(REMIND_AT);

        const reminder = remindersSent(world.port).find(
            (notice) => notice.subscriptionBundleId === 'sb-t1',
        );
        assert.equal(reminder.lastDayToCancel, '2027-01-31');
        assert.notEqual(reminder.switchTerms, null);
    });

    test('reads each add-on version once a run, however many bookings it judges', async () => {
        const world = await announced();
        const read = [];
        const catalogue = {
            findVersionById: async (id) => (read.push(id), world.catalogue.findVersionById(id)),
        };

        await reminding(world, { catalogue }).remindDue(REMIND_AT);

        assert.deepEqual(read.sort(), [RETIRED.id, REPLACEMENT.id].sort());
    });

    test('reminds nobody whose notice reached nobody: there is no date to remind of', async () => {
        const world = await announced({ port: sendingPort({ recipients: [], channel: 'email' }) });

        const run = await reminding(world, { port: sendingPort() }).remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 0, failed: 0 });
    });

    test('reminds a trial, which cannot switch before it ends', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', { status: 'TRIAL' });

        await reminding(world).remindDue(REMIND_AT);

        const reminder = remindersSent(world.port).find(
            (notice) => notice.subscriptionBundleId === 'sb-t1',
        );
        assert.equal(reminder.switchTerms, null);
    });

    test('a reminder the application could not send is sent by the next run', async () => {
        const world = await announced();
        let fails = true;
        const port = sendingPort(() => {
            if (fails) throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const service = reminding(world, { port });

        const first = await service.remindDue(REMIND_AT);
        fails = false;
        const second = await service.remindDue(new Date(REMIND_AT.getTime() + QUARTER_HOUR));

        assert.deepEqual(
            [first, second],
            [
                { told: 0, failed: 2 },
                { told: 2, failed: 0 },
            ],
        );
        assert.equal(remindersIn(world).length, 2);
    });

    test('a reminder that cannot be put together fails for that booking alone', async () => {
        const world = await announced();
        const plansAhead = {
            async of(sub) {
                if (sub.id === 'sub-t1') throw new Error('plan_retirements row is unreadable');
                return [];
            },
        };

        const run = await reminding(world, { plansAhead }).remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 1, failed: 1 });
        assert.deepEqual(
            remindersSent(world.port).map((notice) => notice.subscriptionBundleId),
            ['sb-t2'],
        );
    });

    test('runs across tenants: the reminder is sent inside the bypass', async () => {
        const world = await announced();
        let inside = false;
        const sentInside = [];
        const port = sendingPort(() => {
            sentInside.push(inside);
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const bypass = {
            async runWithBypass(work) {
                inside = true;
                try {
                    return await work();
                } finally {
                    inside = false;
                }
            },
        };

        await reminding(world, { port, bypass }).remindDue(REMIND_AT);

        assert.deepEqual(sentInside, [true, true]);
    });

    test('the operator sees how many were reminded: reminders that reached somebody', async () => {
        const world = await announced();
        // t1 is reminded; t2's application knows nobody to tell.
        const port = sendingPort((notice) => ({
            recipients: notice.tenantId === 't2' ? [] : ['admin@example.com'],
            channel: 'email',
        }));
        await reminding(world, { port }).remindDue(REMIND_AT);

        const [retirement] = await world.service.list(REMIND_AT);

        assert.equal(retirement.progress.reminded, 1);
    });
});

// @requirement SC-BUN-056 — Where staying put costs something, a booking is reminded once
describe('the quarter-hour run and the add-on reminders', () => {
    // @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
    // @requirement SC-BUN-060 — A subscriber is told once of each newer add-on version offered to a booking
    test('reminds add-on bookings after the plans and before any move', async () => {
        const calls = [];
        const run = (name, result) => async () => (calls.push(name), result);
        const told = { told: 0, failed: 0 };
        const cron = new VersionNoticeCron(
            { sendDue: run('notices', told) },
            null,
            { sendUndelivered: run('retirement notices', told) },
            { moveDue: run('moves', { moved: 0, failed: 0 }) },
            { remindDue: run('reminders', told) },
            { sendUndelivered: run('add-on retirement notices', told) },
            { moveDue: run('add-on moves', { moved: 0, failed: 0 }) },
            { remindDue: run('add-on reminders', told) },
            { sendDue: run('add-on offers', told) },
            { switchDue: run('add-on switches', { switched: 0, failed: 0 }) },
        );

        await cron.sendDueNotices();

        // The offers of add-ons are told beside the plan's; a switch taken
        // for a term's end is made after the moves, so a booking a retirement
        // moved meanwhile is switched from the version it is on.
        assert.deepEqual(calls, [
            'notices',
            'add-on offers',
            'retirement notices',
            'add-on retirement notices',
            'reminders',
            'add-on reminders',
            'moves',
            'add-on moves',
            'add-on switches',
        ]);
    });
});
