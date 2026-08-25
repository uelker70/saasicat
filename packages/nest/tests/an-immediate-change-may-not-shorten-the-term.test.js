import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanChangePreviewService } from '../dist/billing/index.js';

// When a plan change takes effect, and why.
//
// The rule in one sentence: an immediate change may improve the service, it may
// not shorten the commitment. Everything else waits for the term to end, which
// is where a shorter period may legitimately begin.
//
// `changeType` cannot express that, and this is what it cost: moving from a
// yearly STARTER to a monthly STANDARD classifies as `UPGRADE`, applies
// immediately, and ends the yearly commitment the customer is still inside.
// Plan direction and cycle direction are two answers now, and this enumerates
// every combination of them rather than sampling three — a rule that is right
// for the wrong reason passes any three interesting examples.

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
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

const entitlement = (plan) => ({
    computeLimits: async () => ({
        plan,
        quotas: { users: plan === 'STANDARD' ? 8 : 3 },
        features: new Set(plan === 'STANDARD' ? ['CORE', 'EXTRA'] : ['CORE']),
    }),
    invalidateTenant: () => {},
});

const subscription = (plan, billingCycle) => ({
    findForTenant: async () => ({
        plan,
        billingCycle,
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd:
            billingCycle === 'YEARLY' ? new Date('2027-01-01') : new Date('2026-02-01'),
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv1',
            planId: plan,
            version: 1,
            publishedAt: null,
            supersededAt: null,
            changeNote: null,
        },
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
    }),
});

const NOW = new Date('2026-01-15');

function preview(fromPlan, fromCycle, toPlan, toCycle) {
    const service = new PlanChangePreviewService(
        CATALOG,
        entitlement(fromPlan),
        subscription(fromPlan, fromCycle),
        { snapshot: async () => ({ users: 1 }) },
        null,
    );
    return service.preview('t1', toPlan, toCycle, NOW);
}

const PLANS = ['STARTER', 'STANDARD'];
const CYCLES = ['MONTHLY', 'YEARLY'];

/** Every combination of current and target plan and cycle. */
function everyCombination() {
    const rows = [];
    for (const fromPlan of PLANS) {
        for (const fromCycle of CYCLES) {
            for (const toPlan of PLANS) {
                for (const toCycle of CYCLES) {
                    rows.push({ fromPlan, fromCycle, toPlan, toCycle });
                }
            }
        }
    }
    return rows;
}

/** What the rule says, written once, independently of how it is implemented. */
function shouldBeImmediate({ fromPlan, fromCycle, toPlan, toCycle }) {
    const rank = (plan) => PLANS.indexOf(plan);
    const length = (cycle) => (cycle === 'YEARLY' ? 1 : 0);
    const planGoesUp = rank(toPlan) > rank(fromPlan);
    const cycleGetsShorter = length(toCycle) < length(fromCycle);
    return planGoesUp && !cycleGetsShorter;
}

describe('an immediate change may not shorten the term', () => {
    const rows = everyCombination();

    test('the matrix is complete', () => {
        // Sixteen: two plans and two cycles on each side. The assertions below
        // iterate this list, and a shorter one would pass by not asking.
        assert.equal(rows.length, 16);
        assert.equal(rows.filter(shouldBeImmediate).length, 3);
    });

    for (const row of everyCombination()) {
        const label = `${row.fromPlan}/${row.fromCycle} → ${row.toPlan}/${row.toCycle}`;
        const expected = shouldBeImmediate(row);

        test(`${label} takes effect ${expected ? 'now' : 'at term end'}`, async () => {
            const dto = await preview(row.fromPlan, row.fromCycle, row.toPlan, row.toCycle);
            assert.equal(
                dto.isImmediate,
                expected,
                `${label}: isImmediate=${dto.isImmediate}, changeType=${dto.changeType}`,
            );
            // The two must agree: a deferred change has a date, an immediate
            // one has none. A `null` date on a deferred change is a page that
            // says "later" and cannot say when.
            assert.equal(dto.effectiveAt === null, expected);
        });
    }
});

describe('the deferred upgrade explains itself', () => {
    test('a yearly customer choosing a monthly higher plan is told why it waits', async () => {
        const dto = await preview('STARTER', 'YEARLY', 'STANDARD', 'MONTHLY');

        assert.equal(dto.planDirection, 'UP');
        assert.equal(dto.cycleDirection, 'SHORTER');
        assert.equal(dto.isImmediate, false);

        // A warning, not a blocker: the change is allowed, it cannot start
        // today. Refusing it would deny a monthly plan from the term's end.
        assert.deepEqual(dto.blockers, []);
        const codes = dto.warnings.map((w) => w.code);
        assert.ok(
            codes.includes('CYCLE_SHORTENS_AT_TERM_END'),
            `no explanation among ${JSON.stringify(codes)}`,
        );
    });

    test('the same upgrade on the same cycle happens now and says nothing', async () => {
        const dto = await preview('STARTER', 'YEARLY', 'STANDARD', 'YEARLY');
        assert.equal(dto.isImmediate, true);
        assert.ok(!dto.warnings.map((w) => w.code).includes('CYCLE_SHORTENS_AT_TERM_END'));
    });
});

describe('a prorated upgrade never asks for less than nothing', () => {
    test('a cheaper target after a price cut is free rather than a credit', async () => {
        // The raw arithmetic is `(target - current) * remaining / period`, and
        // it goes negative when the higher plan costs less than the running
        // one. That happens after a price reduction. This platform does not pay
        // money back, so a negative charge is a refund nobody agreed to.
        const cheaperHigherPlan = {
            ...CATALOG,
            plans: [CATALOG.plans[0], { ...CATALOG.plans[1], monthlyNet: 5, yearlyNet: 50 }],
        };
        const service = new PlanChangePreviewService(
            cheaperHigherPlan,
            entitlement('STARTER'),
            subscription('STARTER', 'MONTHLY'),
            { snapshot: async () => ({ users: 1 }) },
            null,
        );
        const dto = await service.preview('t1', 'STANDARD', 'MONTHLY', NOW);

        assert.ok(dto.proration, 'an immediate change should carry a proration');
        assert.ok(dto.proration.rawDeltaNet < 0, 'this case needs a negative raw result');
        assert.equal(dto.proration.prorataDeltaNet, 0);
        assert.equal(dto.proration.isFree, true);
    });

    test('an ordinary upgrade still costs what it costs', async () => {
        const dto = await preview('STARTER', 'MONTHLY', 'STANDARD', 'MONTHLY');
        assert.ok(dto.proration.prorataDeltaNet > 0);
        assert.equal(dto.proration.isFree, false);
        assert.equal(dto.proration.prorataDeltaNet, dto.proration.rawDeltaNet);
    });
});
