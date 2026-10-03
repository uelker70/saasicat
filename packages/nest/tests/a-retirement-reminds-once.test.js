// A retirement reminds once: 14 days before its date, a subscription that
// staying put costs something is reminded through the application's notice
// port, once however often the run comes, and the operator sees how many were.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import {
    RetirementReminderService,
    RetirementSwitchService,
    VersionNoticeCron,
} from '../dist/billing/index.js';
import {
    DATE,
    REPLACEMENT_SIDE,
    noticeFor,
    retirementServiceOver,
    subscriptionOf,
    recorded,
    told,
    usageOver,
} from './helpers/retirement-fixtures.js';
import { sendingPort } from './helpers/version-notices.js';

const DAY = 24 * 60 * 60 * 1000;
/** 14 days before 1 July: the day the reminder is due. */
const REMIND_AT = new Date(DATE.getTime() - 14 * DAY);
const QUARTER_HOUR = 15 * 60 * 1000;

/**
 * The switch as the reminder asks it what a switch now would cost: the real
 * rule, over the retirement each subscription was told of.
 */
function switchesOver(subs, notices) {
    const retirements = {
        async pendingFor(subscription, now) {
            const notice = notices.find((told) => told.subscriptionId === subscription.id);
            return notice &&
                subscription.planVersion?.id === notice.retired.planVersionId &&
                new Date(notice.effectiveAt) > now
                ? notice
                : null;
        },
    };
    return new RetirementSwitchService(
        retirements,
        usageOver(subs),
        {},
        {
            invalidateTenant() {},
        },
    );
}

/** The reminder run over `subs`, told `notices`, every part in memory. */
async function aRun({
    subs = [subscriptionOf('t1')],
    notices = [noticeFor('t1')],
    port = sendingPort(),
    bypass = null,
    switches = switchesOver(subs, notices),
    delivered = true,
} = {}) {
    const record = await (delivered ? told : recorded)(...notices);
    const service = new RetirementReminderService(usageOver(subs), record, port, switches, bypass);
    return { service, record, port, subs };
}

/** The reminders the record holds, as the record keeps them. */
function remindersIn(record) {
    return [...record.rows.values()].filter((row) => row.kind === 'version-retirement-reminder');
}

// @requirement SC-SUB-034 — Where staying put costs something, a subscription is reminded once
describe('the one reminder of a retirement', () => {
    test('reminds 14 days before the date, as it was told, with what a switch now would cost', async () => {
        const { service, record, port } = await aRun();

        const run = await service.remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 1, failed: 0 });
        assert.deepEqual(port.sent, [
            {
                ...noticeFor('t1'),
                kind: 'version-retirement-reminder',
                billingCycle: 'MONTHLY',
                switchTerms: {
                    priceNet: 52,
                    held: { priceNet: 49, amountNet: 3, lastDay: '2026-06-30' },
                },
            },
        ]);
        const [reminder] = remindersIn(record);
        assert.equal(reminder.subject, 'pv-1', 'once per subscription and retired version');
        assert.deepEqual(reminder.delivery, {
            recipients: ['admin@example.com'],
            channel: 'email',
        });
    });

    test('reminds nothing before its day, and catches up a run that did not happen until the date', async () => {
        const early = await aRun();
        const late = await aRun();
        const atTheDate = await aRun();

        const before = await early.service.remindDue(new Date(REMIND_AT.getTime() - 1));
        const eightDaysLate = await late.service.remindDue(new Date(REMIND_AT.getTime() + 8 * DAY));
        const tooLate = await atTheDate.service.remindDue(DATE);

        assert.deepEqual([before.told, eightDaysLate.told, tooLate.told], [0, 1, 0]);
    });

    test('reminds once, however often the run comes', async () => {
        const { service, port } = await aRun();

        await service.remindDue(REMIND_AT);
        const again = await service.remindDue(new Date(REMIND_AT.getTime() + QUARTER_HOUR));

        assert.deepEqual(again, { told: 0, failed: 0 });
        assert.equal(port.sent.length, 1);
    });

    test('reminds where staying costs something in the rhythm billed at the date, and only there', async () => {
        // The yearly price rises, the monthly one does not.
        const yearlyOnly = { replacement: { ...REPLACEMENT_SIDE, monthlyNet: 49 } };
        const cheaper = { replacement: { ...REPLACEMENT_SIDE, monthlyNet: 45, yearlyNet: 450 } };
        const { service, port } = await aRun({
            subs: [
                subscriptionOf('monthly'),
                subscriptionOf('yearly', { billingCycle: 'YEARLY' }),
                // A change to yearly lands before the date: yearly is what it pays then.
                subscriptionOf('turns-yearly', {
                    pendingPlan: 'STANDARD',
                    pendingBillingCycle: 'YEARLY',
                    pendingEffectiveAt: new Date('2026-06-20T00:00:00.000Z'),
                }),
                subscriptionOf('cheaper'),
            ],
            notices: [
                noticeFor('monthly', yearlyOnly),
                noticeFor('yearly', { ...yearlyOnly, billingCycle: 'YEARLY' }),
                noticeFor('turns-yearly', yearlyOnly),
                noticeFor('cheaper', cheaper),
            ],
        });

        await service.remindDue(REMIND_AT);

        assert.deepEqual(
            port.sent.map((notice) => [notice.tenantId, notice.billingCycle]),
            [
                ['yearly', 'YEARLY'],
                ['turns-yearly', 'YEARLY'],
            ],
        );
    });

    test('reminds where a feature is taken away, whatever the price', async () => {
        const { service, port } = await aRun({
            notices: [
                noticeFor('t1', {
                    replacement: { ...REPLACEMENT_SIDE, monthlyNet: 45 },
                    changes: [
                        {
                            field: 'features.removed',
                            oldValue: ['exports'],
                            newValue: [],
                            direction: 'REGRESSION',
                        },
                    ],
                }),
            ],
        });

        await service.remindDue(REMIND_AT);

        assert.equal(port.sent.length, 1);
    });

    test('leaves alone a subscription that cancelled, ended, switched or leaves the version by its date', async () => {
        const { service, port } = await aRun({
            subs: [
                // Cancelled with notice, for after the date.
                subscriptionOf('cancelled', {
                    canceledAt: new Date('2026-06-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
                }),
                subscriptionOf('ended', { status: 'CANCELED' }),
                subscriptionOf('switched', { planVersion: { id: 'pv-9', planId: 'PLUS' } }),
                subscriptionOf('leaves', {
                    pendingPlan: 'SMALL',
                    pendingBillingCycle: 'MONTHLY',
                    pendingEffectiveAt: DATE,
                }),
                subscriptionOf('leaves-later', {
                    pendingPlan: 'SMALL',
                    pendingBillingCycle: 'MONTHLY',
                    pendingEffectiveAt: new Date(DATE.getTime() + 1),
                }),
            ],
            notices: ['cancelled', 'ended', 'switched', 'leaves', 'leaves-later'].map((tenant) =>
                noticeFor(tenant),
            ),
        });

        await service.remindDue(REMIND_AT);

        assert.deepEqual(
            port.sent.map((notice) => [notice.tenantId, notice.switchTerms]),
            // Its own change comes after the date, so it pays the new price
            // first; it cannot switch while that change is scheduled.
            [['leaves-later', null]],
        );
    });

    // @requirement SC-SUB-038 — A retirement waits for its notice to arrive, and a year after the last one told
    test('reminds nobody whose notice has reached nobody: there is no date to remind of', async () => {
        const { service, port } = await aRun({ delivered: false });

        const run = await service.remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 0, failed: 0 });
        assert.deepEqual(port.sent, []);
    });

    test('reminds a trial, which cannot switch before it ends', async () => {
        const { service, port } = await aRun({
            subs: [subscriptionOf('t1', { status: 'TRIAL' })],
        });

        await service.remindDue(REMIND_AT);

        assert.deepEqual(
            port.sent.map((notice) => notice.switchTerms),
            [null],
        );
    });

    test('a reminder the application could not send is sent by the next run', async () => {
        let fails = true;
        const port = sendingPort(() => {
            if (fails) throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, record } = await aRun({ port });

        const first = await service.remindDue(REMIND_AT);
        fails = false;
        const second = await service.remindDue(new Date(REMIND_AT.getTime() + QUARTER_HOUR));

        assert.deepEqual(
            [first, second],
            [
                { told: 0, failed: 1 },
                { told: 1, failed: 0 },
            ],
        );
        assert.equal(remindersIn(record).length, 1);
    });

    test('a reminder that cannot be put together fails for that subscription alone', async () => {
        const subs = [subscriptionOf('t1'), subscriptionOf('t2')];
        const notices = [noticeFor('t1'), noticeFor('t2')];
        const readable = switchesOver(subs, notices);
        // t1's notices hold a row nobody can read.
        const switches = {
            async openFor(sub, now) {
                if (sub.id === 'sub-t1')
                    throw new Error("subscription_notices row 'n-7' is unreadable");
                return readable.openFor(sub, now);
            },
        };
        const { service, port } = await aRun({ subs, notices, switches });

        const run = await service.remindDue(REMIND_AT);

        assert.deepEqual(run, { told: 1, failed: 1 });
        assert.deepEqual(
            port.sent.map((notice) => notice.tenantId),
            ['t2'],
        );
    });

    test('runs across tenants: the reminder is sent inside the bypass', async () => {
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
        const { service } = await aRun({ port, bypass });

        await service.remindDue(REMIND_AT);

        assert.deepEqual(sentInside, [true]);
    });

    test('the quarter-hour run reminds after the notices and before the moves, and pauses under maintenance', async () => {
        const calls = [];
        const notices = { sendDue: async () => (calls.push('notices'), { told: 0, failed: 0 }) };
        const retirements = {
            sendUndelivered: async () => (calls.push('retirement notices'), { told: 0, failed: 0 }),
        };
        const moves = { moveDue: async () => (calls.push('moves'), { moved: 0, failed: 0 }) };
        const reminders = {
            remindDue: async () => (calls.push('reminders'), { told: 0, failed: 0 }),
        };
        const running = new VersionNoticeCron(notices, null, retirements, moves, reminders);
        const locked = new VersionNoticeCron(
            notices,
            { isLocked: async () => true },
            retirements,
            moves,
            reminders,
        );

        await running.sendDueNotices();
        await locked.sendDueNotices();

        assert.deepEqual(calls, ['notices', 'retirement notices', 'reminders', 'moves']);
    });

    test('a step of the quarter-hour run that fails holds up none of the others', async () => {
        const order = ['notices', 'retirement notices', 'reminders', 'moves'];
        for (const failing of order) {
            const calls = [];
            const step = (name, result) => async () => {
                calls.push(name);
                if (name === failing) throw new Error(`${name} failed`);
                return result;
            };
            const cron = new VersionNoticeCron(
                { sendDue: step('notices', { told: 0, failed: 0 }) },
                null,
                { sendUndelivered: step('retirement notices', { told: 0, failed: 0 }) },
                { moveDue: step('moves', { moved: 0, failed: 0 }) },
                { remindDue: step('reminders', { told: 0, failed: 0 }) },
            );

            await cron.sendDueNotices();

            assert.deepEqual(calls, order, `where ${failing} fail`);
        }
    });

    test('the operator sees how many were reminded: reminders that reached somebody', async () => {
        const subs = [subscriptionOf('t1'), subscriptionOf('t2'), subscriptionOf('t3')];
        const notices = [noticeFor('t1'), noticeFor('t2'), noticeFor('t3')];
        // t1 is reminded; t2's application knows nobody to tell; t3's could not
        // send it yet.
        const port = sendingPort((notice) => {
            if (notice.tenantId === 't3') throw new Error('mail server down');
            return {
                recipients: notice.tenantId === 't2' ? [] : ['admin@example.com'],
                channel: 'email',
            };
        });
        const { service, record } = await aRun({ subs, notices, port });
        await service.remindDue(REMIND_AT);

        const [retirement] = await retirementServiceOver({ subs, record }).list(REMIND_AT);

        assert.equal(retirement.progress.reminded, 1);
        assert.equal(retirement.progress.waiting, 3, 'beside the states, not instead of one');
    });
});
