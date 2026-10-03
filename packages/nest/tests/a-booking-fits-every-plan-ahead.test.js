import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PlansAheadService,
    SubscriptionBundlePreviewService,
    SubscriptionBundlesService,
} from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// A tenant on Standard has scheduled a move to Basic for 1 July. Reports is an
// add-on sold for Standard only. Booked now, it would still be running when the
// move lands, and the move lands without looking at add-ons — so the booking is
// refused now, where the tenant can still choose.

const at = (day) => new Date(`${day}T00:00:00.000Z`);
const NOW = at('2026-05-15');
const MOVE = at('2026-07-01');

function addOn(id, fields = {}) {
    return {
        id,
        bundleId: `b-${id}`,
        bundleKey: id.toUpperCase(),
        label: id,
        version: 1,
        baseVersionId: null,
        features: [id.toUpperCase()],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        publishedChanges: [],
        changeNote: '',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...fields,
    };
}

const REPORTS = addOn('reports', { compatibility: { planIds: ['STANDARD'] } });
const EXPORTS = addOn('exports');
/** Priced for Standard alone: an override, and no base price anybody else could pay. */
const AUDITS = addOn('audits', {
    monthlyNet: null,
    yearlyNet: null,
    pricingOverrides: [{ planId: 'STANDARD', monthlyNet: '4.00', yearlyNet: '40.00' }],
});
/** Sold for Standard only, and priced for Standard only. */
const LOCKED = addOn('locked', {
    compatibility: { planIds: ['STANDARD'] },
    monthlyNet: null,
    yearlyNet: null,
    pricingOverrides: [{ planId: 'STANDARD', monthlyNet: '4.00', yearlyNet: '40.00' }],
});

function catalogue() {
    const bundles = new FakeBundleRepository();
    for (const version of [REPORTS, EXPORTS, AUDITS, LOCKED]) {
        bundles.seedBundle({
            id: version.bundleId,
            bundleKey: version.bundleKey,
            label: version.label,
            description: null,
            icon: null,
            sortOrder: 0,
            i18n: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
        });
        bundles.seedVersion(version);
    }
    return bundles;
}

const MOVE_TO_BASIC = { planKey: 'BASIC', billingCycle: 'YEARLY', from: MOVE };

/** A booking on a yearly Standard plan set to move to `plansAhead`, ending where `parentEndsAt` says. */
function bookingOn({ plansAhead = [MOVE_TO_BASIC], parentEndsAt = null } = {}) {
    const bookings = new FakeSubscriptionBundleRepository();
    const service = new SubscriptionBundlesService(bookings, catalogue(), {
        defaultMinimumTermMonths: 0,
    });
    const book = (bundleVersionId, billingCycle = 'YEARLY') =>
        service.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId,
            currentPlanKey: 'STANDARD',
            startedAt: NOW,
            parentEndsAt,
            planCycle: 'YEARLY',
            planPeriodEnd: MOVE,
            planAnchorDay: 1,
            billingCycle,
            plansAhead,
        });
    return { book, booked: () => bookings.listBySubscription('sub-1') };
}

/** Refused with 422, `code` and `params`. */
const refusedWith = (code, params) => (error) => {
    assert.equal(error.getStatus?.(), 422);
    assert.equal(error.getResponse().code, code);
    assert.deepEqual(error.getResponse().params, params);
    return true;
};

// @requirement SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to
describe('a booking on a subscription set to move to another plan', () => {
    test('is refused where the plan it moves to does not book the add-on', async () => {
        const { book, booked } = bookingOn();
        await assert.rejects(
            () => book(REPORTS.id),
            refusedWith('BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN', {
                planKey: 'BASIC',
                billingCycle: 'YEARLY',
                from: '2026-07-01',
            }),
        );
        assert.deepEqual(await booked(), []);
    });

    test('is refused where that plan has no price for it in its rhythm', async () => {
        const { book } = bookingOn();
        await assert.rejects(
            () => book(AUDITS.id),
            refusedWith('BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN', {
                planKey: 'BASIC',
                billingCycle: 'YEARLY',
                from: '2026-07-01',
            }),
        );
    });

    test('is refused for a yearly add-on where the move is to the monthly rhythm', async () => {
        const { book } = bookingOn({
            plansAhead: [{ planKey: 'STANDARD', billingCycle: 'MONTHLY', from: MOVE }],
        });
        await assert.rejects(
            () => book(EXPORTS.id, 'YEARLY'),
            refusedWith('BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE', {
                planKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                from: '2026-07-01',
            }),
        );
    });

    test('books an add-on the plan it moves to can carry', async () => {
        const { book, booked } = bookingOn();
        await book(EXPORTS.id);
        assert.equal((await booked()).length, 1);
    });

    test('books it where the subscription ends on the day of the move, which then never lands', async () => {
        const { book, booked } = bookingOn({ parentEndsAt: MOVE });
        await book(REPORTS.id);
        assert.equal((await booked()).length, 1);
    });

    test('but not where the subscription ends a day after the move', async () => {
        const { book } = bookingOn({ parentEndsAt: at('2026-07-02') });
        await assert.rejects(
            () => book(REPORTS.id),
            refusedWith('BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN', {
                planKey: 'BASIC',
                billingCycle: 'YEARLY',
                from: '2026-07-01',
            }),
        );
    });
});

/**
 * A yearly booking of `bundleVersionId` on sub-1, cancelled and still running
 * whenever this runs, and the reinstatement of it on a yearly `planKey` plan
 * set to move to `plansAhead`.
 */
async function cancelledBooking(bundleVersionId) {
    const bookings = new FakeSubscriptionBundleRepository();
    const service = new SubscriptionBundlesService(bookings, catalogue(), {
        defaultMinimumTermMonths: 0,
    });
    const { id } = await bookings.add({
        subscriptionId: 'sub-1',
        bundleVersionId,
        startedAt: NOW,
        billingCycle: 'YEARLY',
    });
    await bookings.cancel(id, { canceledAt: NOW, canceledEffectiveAt: at('2099-01-01') });
    const reinstate = ({ planKey = 'STANDARD', plansAhead = [] } = {}) =>
        service.reactivateBundle({
            subscriptionId: 'sub-1',
            subscriptionBundleId: id,
            currentPlanKey: planKey,
            planCycle: 'YEARLY',
            parentEndsAt: null,
            plansAhead,
        });
    const cancelled = async () => (await bookings.findById(id)).canceledAt !== null;
    return { reinstate, cancelled };
}

// @requirement SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to
describe('reinstating a cancelled booking, which books it again', () => {
    test('is refused where the plan it moves to cannot carry the add-on', async () => {
        const { reinstate, cancelled } = await cancelledBooking(REPORTS.id);
        await assert.rejects(
            () => reinstate({ plansAhead: [MOVE_TO_BASIC] }),
            refusedWith('BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN', {
                planKey: 'BASIC',
                billingCycle: 'YEARLY',
                from: '2026-07-01',
            }),
        );
        assert.equal(await cancelled(), true);
    });

    // @requirement SC-BUN-025 — An add-on may be restricted to particular plans
    test('is refused where the plan of today cannot carry it', async () => {
        const { reinstate, cancelled } = await cancelledBooking(REPORTS.id);
        await assert.rejects(
            () => reinstate({ planKey: 'BASIC' }),
            refusedWith('BUNDLE_INCOMPATIBLE_WITH_PLAN', {
                bundleVersionId: REPORTS.id,
                planKey: 'BASIC',
                allowedPlanKeys: 'STANDARD',
            }),
        );
        assert.equal(await cancelled(), true);
    });

    test('reinstates one both plans can carry', async () => {
        const { reinstate, cancelled } = await cancelledBooking(EXPORTS.id);
        await reinstate({ plansAhead: [MOVE_TO_BASIC] });
        assert.equal(await cancelled(), false);
    });
});

/** The preview of booking `bundleVersionId` on a plan billed in `planCycle`, set to move to `plansAhead`. */
function previewOn(
    bundleVersionId,
    { planKey = 'BASIC', planCycle = 'MONTHLY', plansAhead = [], billingCycle } = {},
) {
    return new SubscriptionBundlePreviewService(
        new FakeSubscriptionBundleRepository(),
        catalogue(),
        null,
    ).previewAdd(
        {
            subscriptionId: 'sub-1',
            currentPlanKey: planKey,
            billingCycle: planCycle,
            status: 'ACTIVE',
            startedAt: at('2026-01-01'),
            currentPeriodStart: at('2026-05-01'),
            currentPeriodEnd: at('2026-06-01'),
            parentEndsAt: null,
            planAnchorDay: 1,
            plansAhead,
        },
        { bundleVersionId, billingCycle },
        NOW,
    );
}

const codes = (preview) => preview.blockers.map((blocker) => blocker.code);

describe('the preview of such a booking', () => {
    // @requirement SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to
    test('says what the booking would say', async () => {
        // Reports runs on the yearly Standard plan of today; only the move to
        // Basic stands in its way.
        const refusal = await bookingOn()
            .book(REPORTS.id)
            .then(
                () => assert.fail('the booking was not refused'),
                (error) => error.getResponse(),
            );
        const preview = await previewOn(REPORTS.id, {
            planKey: 'STANDARD',
            planCycle: 'YEARLY',
            plansAhead: [MOVE_TO_BASIC],
            billingCycle: 'YEARLY',
        });
        assert.deepEqual(preview.blockers, [refusal]);
    });

    // @requirement SC-BUN-025 — An add-on may be restricted to particular plans
    // @requirement SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on
    test('names every reason an add-on cannot run beside the plan of today, at once', async () => {
        // Sold for Standard only, priced for Standard only, and asked for yearly
        // beside a monthly Basic plan: three reasons, and the tenant reads all three.
        const preview = await previewOn(LOCKED.id, { billingCycle: 'YEARLY' });
        assert.deepEqual(codes(preview), [
            'BUNDLE_INCOMPATIBLE_WITH_PLAN',
            'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
            'BUNDLE_CYCLE_EXCEEDS_PLAN',
        ]);
    });
});

const SUBSCRIPTION = {
    id: 'sub-1',
    plan: 'STANDARD',
    billingCycle: 'YEARLY',
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    pendingChangeVersionId: null,
    planVersion: { id: 'pv-standard-1' },
};

const OCTOBER = at('2026-10-01');

/** A retirement of Standard v1 onto Basic, told for 1 October while the subscription was yearly. */
const TOLD_FOR_OCTOBER = {
    replacement: { planKey: 'BASIC' },
    billingCycle: 'YEARLY',
    effectiveAt: OCTOBER.toISOString(),
};

/** A retirement service that has told the subscription of `notices`. */
const retirementsTelling = (...notices) => ({
    asked: [],
    async toldRetirementsOf(subscription) {
        this.asked.push(subscription.id);
        return notices;
    },
});

// @requirement SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to
describe('the plans a subscription is set to move to', () => {
    test('are none where nothing is scheduled and no retirement was told', async () => {
        const ahead = await new PlansAheadService(retirementsTelling()).of(SUBSCRIPTION);
        assert.deepEqual(ahead, []);
    });

    test('are the target of a scheduled change, in its rhythm, from the day it lands', async () => {
        const ahead = await new PlansAheadService(null).of({
            ...SUBSCRIPTION,
            pendingPlan: 'BASIC',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: MOVE,
        });
        assert.deepEqual(ahead, [{ planKey: 'BASIC', billingCycle: 'MONTHLY', from: MOVE }]);
    });

    test('are monthly where the change names no rhythm, as the change lands', async () => {
        const ahead = await new PlansAheadService(null).of({
            ...SUBSCRIPTION,
            pendingPlan: 'BASIC',
            pendingEffectiveAt: MOVE,
        });
        assert.deepEqual(ahead, [{ planKey: 'BASIC', billingCycle: 'MONTHLY', from: MOVE }]);
    });

    test('are the replacement of a retirement told, from its date', async () => {
        const retirements = retirementsTelling(TOLD_FOR_OCTOBER);
        const ahead = await new PlansAheadService(retirements).of(SUBSCRIPTION);
        assert.deepEqual(ahead, [{ planKey: 'BASIC', billingCycle: 'YEARLY', from: OCTOBER }]);
        assert.deepEqual(retirements.asked, ['sub-1']);
    });

    test('carry the retirement in the rhythm billed at its date, not the one it was told in', async () => {
        // Told while yearly; a switch to monthly lands in July, before the date.
        const ahead = await new PlansAheadService(retirementsTelling(TOLD_FOR_OCTOBER)).of({
            ...SUBSCRIPTION,
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: MOVE,
        });
        assert.deepEqual(ahead, [
            { planKey: 'STANDARD', billingCycle: 'MONTHLY', from: MOVE },
            { planKey: 'BASIC', billingCycle: 'MONTHLY', from: OCTOBER },
        ]);
    });

    test('keep a told retirement where a scheduled change would leave the version first', async () => {
        // The change can still be withdrawn, and the retirement then moves the
        // subscription after all.
        const ahead = await new PlansAheadService(retirementsTelling(TOLD_FOR_OCTOBER)).of({
            ...SUBSCRIPTION,
            pendingPlan: 'PRO',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: MOVE,
        });
        assert.deepEqual(ahead, [
            { planKey: 'PRO', billingCycle: 'YEARLY', from: MOVE },
            { planKey: 'BASIC', billingCycle: 'YEARLY', from: OCTOBER },
        ]);
    });

    test('do not ask about a retirement for a subscription that has no id', async () => {
        const retirements = retirementsTelling(TOLD_FOR_OCTOBER);
        const ahead = await new PlansAheadService(retirements).of({
            ...SUBSCRIPTION,
            id: undefined,
        });
        assert.deepEqual(ahead, []);
        assert.deepEqual(retirements.asked, []);
    });
});
