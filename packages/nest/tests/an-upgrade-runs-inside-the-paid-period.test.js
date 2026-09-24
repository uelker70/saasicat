// What an immediate upgrade costs, and which period it runs in.
//
// In the same rhythm the higher plan runs inside the period already paid: the
// window and the billing day stay, and the difference is charged for what is
// left. A longer rhythm cannot run inside a shorter one, so it starts a period
// of its own today, charged in full less the unused rest of the one it
// replaces. The preview says what it costs; the route writes the window the
// preview priced — the two are asked together here, because a price for one
// window and a write of another is exactly the disagreement this rules out.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PlanChangePreviewService,
    TenantBillingController,
    computeNewPeriodCharge,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';

const DAY_MS = 86_400_000;

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    plans: [
        {
            id: 'STARTER',
            name: 'Starter',
            tagline: '',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 3 },
            features: ['CORE'],
        },
        {
            id: 'STANDARD',
            name: 'Standard',
            tagline: '',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8 },
            features: ['CORE', 'EXTRA'],
        },
    ],
};

/** A monthly STARTER subscription inside the window given. */
function starterMonthly(periodStart, periodEnd, overrides = {}) {
    return {
        plan: 'STARTER',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        minimumTermUntil: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: null,
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        ...overrides,
    };
}

const entitlements = {
    computeLimits: async () => ({ plan: 'STARTER', quotas: { users: 3 }, features: new Set() }),
    invalidateTenant() {},
};

function previewService(subscription) {
    return new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        entitlements,
        { findForTenant: async () => subscription },
        { snapshot: async () => ({ users: 1 }) },
        null,
    );
}

function writePort() {
    return {
        immediate: [],
        async changePlanImmediate(tenantId, input) {
            this.immediate.push(input);
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
        },
    };
}

async function upgradeThroughTheRoute(subscription, target) {
    const writes = writePort();
    const controller = new TenantBillingController(
        entitlements,
        previewService(subscription),
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        writes,
        () => 't1',
        () => 'u1',
    );
    await controller.changePlan({ user: { tenantId: 't1', sub: 'u1' }, headers: {} }, target);
    assert.equal(writes.immediate.length, 1, 'the upgrade was not made today');
    return writes.immediate[0];
}

/** A window around the real clock, since the route asks its preview about now. */
function runningWindow() {
    const now = Date.now();
    return [new Date(now - 15 * DAY_MS), new Date(now + 16 * DAY_MS)];
}

// A window of 31 days, 17 of them left on the 15th.
const JAN_1 = new Date('2026-01-01T00:00:00.000Z');
const FEB_1 = new Date('2026-02-01T00:00:00.000Z');
const JAN_15 = new Date('2026-01-15T00:00:00.000Z');

// @requirement SC-CHG-020 — An immediate upgrade in the same rhythm runs inside the period already paid
describe('an immediate upgrade in the same rhythm', () => {
    test('is charged the difference for what is left of the period', async () => {
        const dto = await previewService(starterMonthly(JAN_1, FEB_1)).preview(
            't1',
            'STANDARD',
            'MONTHLY',
            JAN_15,
        );

        assert.equal(dto.isImmediate, true);
        assert.equal(dto.proration.basis, 'difference');
        assert.equal(dto.proration.daysRemainingInPeriod, 17);
        assert.equal(dto.proration.daysInPeriod, 31);
        assert.equal(dto.proration.prorataDeltaNet, 16.45, '(49 − 19) × 17 / 31');
        assert.equal(dto.proration.remainderNet, 0);
    });

    test('keeps the window and the billing day it runs in', async () => {
        const [start, end] = runningWindow();

        const write = await upgradeThroughTheRoute(starterMonthly(start, end), {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
        });

        assert.equal(write.periodStart, null, 'the running period was restarted');
        assert.equal(write.periodEnd, null);
        assert.equal(write.planId, 'STANDARD');
    });

    test('opens a window where the subscription has none to run inside', async () => {
        // The one case where keeping the window keeps nothing: an active
        // subscription with no period yet gets its first one, as before.
        const write = await upgradeThroughTheRoute(
            starterMonthly(null, null, { startedAt: new Date() }),
            { plan: 'STANDARD', billingCycle: 'MONTHLY' },
        );

        assert.ok(write.periodStart instanceof Date);
        assert.ok(write.periodEnd > write.periodStart);
    });
});

// @requirement SC-CHG-021 — An immediate upgrade into a longer rhythm starts today, less the unused rest
describe('an immediate upgrade into a longer rhythm', () => {
    test('is charged the new period in full, less the unused rest of the old one', async () => {
        const dto = await previewService(starterMonthly(JAN_1, FEB_1)).preview(
            't1',
            'STANDARD',
            'YEARLY',
            JAN_15,
        );

        assert.equal(dto.isImmediate, true);
        assert.equal(dto.proration.basis, 'newPeriod');
        assert.equal(dto.proration.remainderNet, 10.42, '19 × 17 / 31');
        assert.equal(dto.proration.prorataDeltaNet, 479.58, '490 − 10.42');
        assert.equal(dto.proration.targetPriceNet, 490);
    });

    test('starts its period today, so the billing day becomes today', async () => {
        const [start, end] = runningWindow();
        const before = Date.now();

        const write = await upgradeThroughTheRoute(starterMonthly(start, end), {
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
        });

        assert.ok(
            write.periodStart.getTime() >= before - DAY_MS,
            'the period does not start today',
        );
        assert.ok(write.periodStart.getTime() <= Date.now());
        const year = new Date(write.periodStart);
        year.setUTCFullYear(year.getUTCFullYear() + 1);
        assert.equal(write.periodEnd.toISOString(), year.toISOString());
    });
});

// @requirement SC-CHG-021 — An immediate upgrade into a longer rhythm starts today, less the unused rest
// @requirement SC-PRIC-003 — This platform never pays money back
describe('the unused rest at its edges', () => {
    const charge = (now, currentPriceNet, targetPriceNet) =>
        computeNewPeriodCharge({
            periodStart: JAN_1,
            periodEnd: FEB_1,
            now,
            currentPriceNet,
            targetPriceNet,
        });

    test('on the first day of the period the whole of it is left', () => {
        const dto = charge(JAN_1, 19, 490);
        assert.equal(dto.remainderNet, 19);
        assert.equal(dto.prorataDeltaNet, 471);
    });

    test('on its last day nothing is left, and the new period costs its price', () => {
        const dto = charge(FEB_1, 19, 490);
        assert.equal(dto.remainderNet, 0);
        assert.equal(dto.prorataDeltaNet, 490);
    });

    test('a rest worth more than the new period makes it free, and nothing is paid out', () => {
        const dto = charge(JAN_1, 500, 490);
        assert.equal(dto.rawDeltaNet, -10);
        assert.equal(dto.prorataDeltaNet, 0);
        assert.equal(dto.isFree, true);
    });

    test('a rest worth exactly the new period costs nothing and is not free', () => {
        const dto = charge(JAN_1, 490, 490);
        assert.equal(dto.prorataDeltaNet, 0);
        assert.equal(dto.isFree, false);
    });
});
