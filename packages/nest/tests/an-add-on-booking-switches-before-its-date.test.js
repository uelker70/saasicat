// A booking an add-on retirement told may switch to the replacement before its
// date: when the switch is open, what it writes and holds, and what it
// refuses.
//
// Every case announces Reports v1 (9.90 a month) onto v2 (12.90, 10.90 beside
// Pro) on 15 October for t1 and t2, monthly bookings beside a yearly Standard
// plan; their date is 1 February 2027.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { BundleRetirementSwitchService } from '../dist/billing/index.js';
import {
    ACTOR,
    NOW,
    REPLACEMENT,
    RETIRED,
    bookingOf,
    rejection,
    retiring,
    subscriptionOf,
} from './helpers/add-on-retirement-fixtures.js';
import { sendingPort } from './helpers/version-notices.js';

const THE_DATE = new Date('2027-02-01T00:00:00.000Z');
const BEFORE = new Date('2026-11-10T09:00:00.000Z');

/** An announcement of v1 onto v2 that reached t1 and t2. */
async function announced(options = {}) {
    const world = retiring(options);
    await world.service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
    return world;
}

/**
 * The switch over `world`, with what it freezes, invalidates and records.
 * `ahead` are the plans the subscription is set to move to.
 */
function switching(world, { noParty = [], freezeFails = false, ahead = [] } = {}) {
    const frozen = [];
    const invalidated = [];
    const recorded = [];
    const asked = [];
    const service = new BundleRetirementSwitchService(
        world.service,
        world.catalogue,
        world.bookingRepository,
        world.usage,
        { of: async () => ahead },
        { invalidateTenant: (tenantId) => invalidated.push(tenantId) },
        {
            async assertPartyFor(tenantId, intended) {
                asked.push({ tenantId, intended, version: versionOf(world, 'sb-t1') });
                if (noParty.includes(tenantId)) throw new Error('no party');
            },
            async freezeOnPlanChange(...args) {
                if (freezeFails) throw new Error('the contract store is down');
                frozen.push(args);
            },
        },
        { recordDueCharges: async (tenantId) => recorded.push(tenantId) },
    );
    return { service, frozen, invalidated, recorded, asked };
}

const versionOf = (world, id) =>
    world.bookingRepository.rows.find((row) => row.id === id)?.bundleVersionId;

/** The refusal `promise` answers with, as its code and params. */
async function refusedWith(promise) {
    const error = await rejection(promise);
    const { code, params } = error.getResponse();
    return { status: error.getStatus(), code, params };
}

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('the switch before the date', () => {
    test('moves the booking onto the replacement at once and writes the contract that holds its price', async () => {
        const world = await announced();
        const { service, frozen, invalidated, recorded } = switching(world);

        const result = await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
        assert.equal(versionOf(world, 'sb-t2'), RETIRED.id, 't2 is left as it was');
        assert.deepEqual(result, {
            subscriptionBundleId: 'sb-t1',
            fromBundleVersionId: RETIRED.id,
            bundleVersionId: REPLACEMENT.id,
            heldUntilDay: '2027-01-31',
        });
        const [[tenantId, plan, cycle, at, endsAt, terms]] = frozen;
        assert.deepEqual(
            [tenantId, plan, cycle, at, endsAt, terms.addOn, terms.priceHold],
            [
                't1',
                'STANDARD',
                'YEARLY',
                BEFORE,
                null,
                { bundleVersionId: REPLACEMENT.id, subscriptionBundleId: 'sb-t1' },
                { amountNet: 3, until: THE_DATE, lastDay: '2027-01-31' },
            ],
        );
        assert.equal(typeof terms.retirementId, 'string');
        assert.deepEqual(invalidated, ['t1']);
        assert.deepEqual(recorded, ['t1']);
    });

    test('asks the party about the contract it writes, before the booking moves', async () => {
        const world = await announced();
        const { service, frozen, asked } = switching(world);

        await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        const [[, , cycle, effectiveFrom, endsAt]] = frozen;
        assert.deepEqual(asked, [
            { tenantId: 't1', intended: { effectiveFrom, cycle, endsAt }, version: RETIRED.id },
        ]);
    });

    test('writes the contract to end where the subscription does', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            canceledAt: new Date('2026-11-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-06-01T00:00:00.000Z'),
        });
        const { service, frozen } = switching(world);

        await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.deepEqual(frozen[0][4], new Date('2027-06-01T00:00:00.000Z'));
    });

    test('holds nothing where the replacement costs no more', async () => {
        const cheaper = { ...REPLACEMENT, monthlyNet: '8.90', yearlyNet: '89.00' };
        const world = await announced({ versions: [RETIRED, cheaper] });
        const { service, frozen } = switching(world);

        const result = await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.equal(result.heldUntilDay, null);
        assert.equal(frozen[0][5].priceHold, null);
    });

    test('holds the difference for the plan it runs beside now, as the catalogue prices it', async () => {
        // Told for Standard (9.90 to 12.90); on Pro since, where v2 costs 10.90.
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', { plan: 'PRO' });
        const { service, frozen } = switching(world);

        await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.equal(frozen[0][5].priceHold.amountNet, 1);
    });

    test('lets a booking whose cancellation lands after the date switch, its cancellation standing', async () => {
        const world = await announced();
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2026-11-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-06-01T00:00:00.000Z'),
        };
        const { service } = switching(world);

        await service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
        assert.equal(
            world.bookingRepository.rows[0].canceledEffectiveAt.toISOString(),
            '2027-06-01T00:00:00.000Z',
        );
    });

    test('says what it would cost on the page, and nothing where it is not open', async () => {
        const world = await announced({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2', { status: 'TRIAL' })],
        });
        const { service } = switching(world);
        const [sub1, sub2] = await Promise.all([
            world.usage.findForTenant('t1'),
            world.usage.findForTenant('t2'),
        ]);
        const [booking1, booking2] = world.bookingRepository.rows;

        assert.deepEqual(await service.openFor(sub1, booking1, BEFORE), {
            priceNet: 12.9,
            held: { priceNet: 9.9, amountNet: 3, lastDay: '2027-01-31' },
            billingCycle: 'MONTHLY',
        });
        assert.equal(await service.openFor(sub2, booking2, BEFORE), null);
    });

    test('prices it in the rhythm the booking is billed in now, which its notice may not name', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        // Billed with the plan, which was billed yearly when it was told.
        const world = await announced({
            subscriptions,
            bookings: [bookingOf('t1', { billingCycle: null }), bookingOf('t2')],
        });
        subscriptions[0] = subscriptionOf('t1', { billingCycle: 'MONTHLY' });
        const notice = await world.service.pendingForBooking('sub-t1', 'sb-t1', BEFORE);

        const terms = await switching(world).service.openFor(
            await world.usage.findForTenant('t1'),
            world.bookingRepository.rows[0],
            BEFORE,
        );

        assert.deepEqual(
            [notice.billingCycle, terms.billingCycle, terms.priceNet],
            ['YEARLY', 'MONTHLY', 12.9],
        );
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('what the switch refuses', () => {
    test('a booking no retirement waits for: not told, past its date, or switched already', async () => {
        const untold = await announced({ port: sendingPort({ recipients: [], channel: 'email' }) });
        const told = await announced();
        const switched = await announced();
        await switching(switched).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        const answers = await Promise.all([
            refusedWith(switching(untold).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE)),
            refusedWith(switching(told).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, THE_DATE)),
            refusedWith(
                switching(switched).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
            ),
        ]);

        assert.deepEqual(
            answers.map(({ code }) => code),
            [
                'RETIREMENT_SWITCH_NOT_PENDING',
                'RETIREMENT_SWITCH_NOT_PENDING',
                'RETIREMENT_SWITCH_NOT_PENDING',
            ],
        );
    });

    test('a booking whose cancellation has landed', async () => {
        const world = await announced();
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2026-10-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
        };

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.equal(answer.code, 'RETIREMENT_SWITCH_NOT_PENDING');
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('a booking whose cancellation lands on the date, which it never runs past', async () => {
        const world = await announced();
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2026-11-05T00:00:00.000Z'),
            canceledEffectiveAt: THE_DATE,
        };

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.equal(answer.code, 'RETIREMENT_SWITCH_NOT_PENDING');
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('a booking whose subscription ends before the date', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            canceledAt: new Date('2026-11-05T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        });

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.equal(answer.code, 'RETIREMENT_SWITCH_NOT_PENDING');
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('a subscription in its trial', async () => {
        const world = await announced({
            subscriptions: [subscriptionOf('t1', { status: 'TRIAL' }), subscriptionOf('t2')],
        });

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.equal(answer.code, 'RETIREMENT_SWITCH_IN_TRIAL');
    });

    test('a version other than the replacement, answered with the retirement as it stands', async () => {
        const world = await announced();

        const error = await rejection(
            switching(world).service.switchNow('t1', 'sb-t1', RETIRED.id, BEFORE),
        );

        assert.equal(error.getStatus(), 409);
        assert.equal(error.getResponse().code, 'RETIREMENT_SWITCH_CHANGED');
        assert.equal(error.getResponse().retirement.replacement.bundleVersionId, REPLACEMENT.id);
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('a booking of another subscription, as a missing one', async () => {
        const world = await announced();
        const { service } = switching(world);

        const answers = await Promise.all([
            refusedWith(service.switchNow('t1', 'sb-t2', REPLACEMENT.id, BEFORE)),
            refusedWith(service.switchNow('t1', 'sb-none', REPLACEMENT.id, BEFORE)),
        ]);

        assert.deepEqual(
            answers.map(({ status, code }) => [status, code]),
            [
                [404, 'SUBSCRIPTION_BUNDLE_NOT_FOUND'],
                [404, 'SUBSCRIPTION_BUNDLE_NOT_FOUND'],
            ],
        );
    });

    test('a subscriber without a party to the contract, before anything moves', async () => {
        const world = await announced();

        await rejection(
            switching(world, { noParty: ['t1'] }).service.switchNow(
                't1',
                'sb-t1',
                REPLACEMENT.id,
                BEFORE,
            ),
        );

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('a booking that left the version while the request was decided', async () => {
        const world = await announced();
        world.bookingRepository.moveToVersion = async () => null;

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.deepEqual([answer.status, answer.code], [409, 'SUBSCRIPTION_CHANGED']);
    });

    test('a replacement that cannot run beside the plan the subscription is on', async () => {
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions, versions: [RETIRED, standardOnly] });
        subscriptions[0] = subscriptionOf('t1', { plan: 'PRO' });

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.equal(answer.code, 'BUNDLE_INCOMPATIBLE_WITH_PLAN');
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('a plan that changes before the date', () => {
    /** t1's subscription with a change to `plan` in `cycle` scheduled to land at `at`. */
    async function changeScheduled(plan, cycle, at) {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            pendingPlan: plan,
            pendingBillingCycle: cycle,
            pendingEffectiveAt: at,
        });
        return world;
    }

    test('refuses a change of plan landing before the date, naming the add-on and its date', async () => {
        const world = await changeScheduled('PRO', 'YEARLY', new Date(THE_DATE.getTime() - 1));

        const answer = await refusedWith(
            switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );

        assert.deepEqual(answer, {
            status: 422,
            code: 'BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES',
            params: { bundleName: 'Reports', date: '2027-02-01' },
        });
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('and a change of rhythm alone, but not a change landing on the date itself', async () => {
        const rhythm = await changeScheduled(
            'STANDARD',
            'MONTHLY',
            new Date('2027-01-01T00:00:00.000Z'),
        );
        const onTheDate = await changeScheduled('PRO', 'YEARLY', THE_DATE);

        const refused = await refusedWith(
            switching(rhythm).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
        );
        await switching(onTheDate).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.equal(refused.code, 'BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES');
        assert.equal(versionOf(onTheDate, 'sb-t1'), REPLACEMENT.id);
    });

    /** A retirement told to move t1's subscription to `planKey` a month before the date. */
    const retiredOnto = (planKey) => [
        {
            planKey,
            billingCycle: 'YEARLY',
            from: new Date('2027-01-01T00:00:00.000Z'),
            by: 'retirement',
        },
    ];

    test('refuses where a retirement moves it to another plan before the date', async () => {
        const world = await announced();

        const answer = await refusedWith(
            switching(world, { ahead: retiredOnto('PRO') }).service.switchNow(
                't1',
                'sb-t1',
                REPLACEMENT.id,
                BEFORE,
            ),
        );

        assert.equal(answer.code, 'BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES');
    });

    test('but not where it moves it to another version of the same plan', async () => {
        const world = await announced();

        await switching(world, { ahead: retiredOnto('STANDARD') }).service.switchNow(
            't1',
            'sb-t1',
            REPLACEMENT.id,
            BEFORE,
        );

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('a subscription that changes while the switch is decided', () => {
    test('is refused, the booking put back and no contract written', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        const claim = world.bookingRepository.moveToVersion;
        world.bookingRepository.moveToVersion = async (...args) => {
            const moved = await claim(...args);
            // A cancellation declared after the switch read the subscription.
            subscriptions[0] = subscriptionOf('t1', {
                canceledAt: new Date('2026-11-10T09:00:01.000Z'),
                canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
            });
            return moved;
        };
        const { service, frozen } = switching(world);

        const answer = await refusedWith(service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE));

        assert.deepEqual([answer.status, answer.code], [409, 'SUBSCRIPTION_CHANGED']);
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(frozen, []);
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('a switch whose contract cannot be written', () => {
    test('is put back as well where the subscription cannot be read again', async () => {
        const world = await announced();
        const claim = world.bookingRepository.moveToVersion;
        let claimed = false;
        world.bookingRepository.moveToVersion = async (...args) => {
            const moved = await claim(...args);
            claimed = true;
            return moved;
        };
        const read = world.usage.findForTenant.bind(world.usage);
        world.usage.findForTenant = async (tenantId) => {
            if (claimed) throw new Error('the database dropped the connection');
            return read(tenantId);
        };
        const { service, frozen, invalidated } = switching(world);

        await assert.rejects(
            () => service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
            /dropped the connection/,
        );

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(frozen, []);
        assert.deepEqual(invalidated, ['t1', 't1'], 'after the switch, and after putting it back');
    });

    test('is put back and refused as it came, and nothing has changed', async () => {
        const world = await announced();
        const { service, invalidated } = switching(world, { freezeFails: true });

        await assert.rejects(
            () => service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE),
            /the contract store is down/,
        );

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(invalidated, ['t1', 't1'], 'after the switch, and after putting it back');
    });

    test('is refused as it came where it cannot be put back either', async () => {
        const world = await announced();
        const write = world.bookingRepository.moveToVersion;
        world.bookingRepository.moveToVersion = async (id, from, to) => {
            if (from === REPLACEMENT.id) throw new Error('the database is gone');
            return write(id, from, to);
        };

        await assert.rejects(
            () =>
                switching(world, { freezeFails: true }).service.switchNow(
                    't1',
                    'sb-t1',
                    REPLACEMENT.id,
                    BEFORE,
                ),
            /the contract store is down/,
        );

        assert.equal(
            versionOf(world, 'sb-t1'),
            REPLACEMENT.id,
            'left on the replacement, and said',
        );
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('the cancellation without the minimum term, once switched', () => {
    test('is over: the retirement no longer waits for the booking', async () => {
        const world = await announced();
        const before = await world.service.pendingForBooking('sub-t1', 'sb-t1', BEFORE);

        await switching(world).service.switchNow('t1', 'sb-t1', REPLACEMENT.id, BEFORE);

        assert.ok(before, 'pending until the switch');
        assert.equal(await world.service.pendingForBooking('sub-t1', 'sb-t1', BEFORE), null);
        assert.ok(await world.service.pendingForBooking('sub-t2', 'sb-t2', BEFORE));
    });
});
