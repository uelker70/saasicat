// Tests for the contract re-freeze after bundle add/cancel (#61) in the
// generated TenantSubscriptionBundlesController: consumers with
// `CONTRACT_FREEZE_PORT_TOKEN` get an amendment with an unchanged plan after a
// successful mutation; without the port everything stays as before;
// freeze errors are non-fatal (the mutation is already persisted).

// @requirement SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen
// @requirement SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';

const REQ = { user: { tenantId: 't1' } };

function buildSub(overrides = {}) {
    return {
        id: 'sub-1',
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date('2026-07-01'),
        pendingPlan: null,
        planVersion: {
            id: 'pv-1',
            planId: 'STANDARD',
            version: 1,
            publishedAt: new Date('2026-01-01'),
            supersededAt: null,
            changeNote: null,
        },
        ...overrides,
    };
}

/** A subscription set to move nowhere. */
const NOTHING_AHEAD = { of: async () => [] };

function buildController({ contractFreeze = null, charges = null, sub = buildSub() } = {}) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const serviceCalls = [];
    const service = {
        addBundleToSubscription: async (input) => {
            serviceCalls.push(['add', input]);
            return { id: 'sb-1', ...input };
        },
        cancelBundleFromSubscription: async (input) => {
            serviceCalls.push(['cancel', input]);
            return { id: input.subscriptionBundleId, canceledAt: new Date() };
        },
        reactivateBundle: async (input) => {
            serviceCalls.push(['reactivate', input]);
            return { id: input.subscriptionBundleId, canceledAt: null };
        },
    };
    const ctrl = new Ctrl(
        service,
        {},
        { findForTenant: async () => sub },
        (req) => req.user?.tenantId ?? null,
        contractFreeze,
        charges,
        NOTHING_AHEAD,
    );
    return { ctrl, serviceCalls };
}

test('add re-freezes the contract with an unchanged plan', async () => {
    const freezeCalls = [];
    const { ctrl } = buildController({
        contractFreeze: {
            assertPartyFor: async () => {},
            freezeOnPlanChange: async (...args) => freezeCalls.push(args),
        },
    });
    await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(freezeCalls.length, 1);
    const [tenantId, plan, cycle] = freezeCalls[0];
    assert.equal(tenantId, 't1');
    assert.equal(plan, 'STANDARD');
    assert.equal(cycle, 'MONTHLY');
});

// The party is asked before the booking moves anything, about the contract
// its re-freeze then writes: a tax adapter may treat one period otherwise than
// another.
for (const [route, call] of [
    ['add', (ctrl) => ctrl.add(REQ, { bundleVersionId: 'bv-1' })],
    ['reactivate', (ctrl) => ctrl.reactivate(REQ, 'sb-1')],
]) {
    test(`${route} asks the party about the contract it re-freezes`, async () => {
        const asked = [];
        const frozen = [];
        const { ctrl } = buildController({
            sub: buildSub({
                billingCycle: 'YEARLY',
                canceledAt: new Date('2026-06-10'),
                canceledEffectiveAt: new Date('2027-01-01'),
            }),
            contractFreeze: {
                assertPartyFor: async (...args) => asked.push(args),
                freezeOnPlanChange: async (...args) => frozen.push(args),
            },
        });
        await call(ctrl);
        const [, , cycle, effectiveFrom, endsAt] = frozen[0];
        assert.equal(asked.length, 1);
        const [tenantId, intended] = asked[0];
        assert.equal(tenantId, 't1');
        assert.deepEqual([intended.cycle, intended.endsAt], [cycle, endsAt]);
        assert.deepEqual([cycle, endsAt], ['YEARLY', new Date('2027-01-01')]);
        assert.ok(
            effectiveFrom - intended.effectiveFrom < 1000,
            'asked of the contract that starts when the re-freeze writes it',
        );
    });
}

test('cancel re-freezes the contract', async () => {
    const freezeCalls = [];
    const { ctrl } = buildController({
        contractFreeze: {
            assertPartyFor: async () => {},
            freezeOnPlanChange: async (...args) => freezeCalls.push(args),
        },
    });
    await ctrl.cancel(REQ, 'sb-1', {});
    assert.equal(freezeCalls.length, 1);
    assert.equal(freezeCalls[0][0], 't1');
});

test('without a ContractFreezePort, add works unchanged', async () => {
    const { ctrl, serviceCalls } = buildController();
    const result = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(result.bundleVersionId, 'bv-1');
    assert.equal(serviceCalls.length, 1);
});

test('freeze error is non-fatal — the mutation result still comes back', async () => {
    const { ctrl } = buildController({
        contractFreeze: {
            assertPartyFor: async () => {},
            freezeOnPlanChange: async () => {
                throw new Error('freeze kaputt');
            },
        },
    });
    const result = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(result.bundleVersionId, 'bv-1');
});

test('a failed mutation triggers no freeze', async () => {
    const freezeCalls = [];
    const Ctrl = buildTenantSubscriptionBundlesController();
    const ctrl = new Ctrl(
        {
            addBundleToSubscription: async () => {
                throw new Error('422 BUNDLE_INCOMPATIBLE_WITH_PLAN');
            },
        },
        {},
        { findForTenant: async () => buildSub() },
        (req) => req.user?.tenantId ?? null,
        {
            assertPartyFor: async () => {},
            freezeOnPlanChange: async (...args) => freezeCalls.push(args),
        },
        null,
        NOTHING_AHEAD,
    );
    await assert.rejects(
        () => ctrl.add(REQ, { bundleVersionId: 'bv-1' }),
        /BUNDLE_INCOMPATIBLE_WITH_PLAN/,
    );
    assert.equal(freezeCalls.length, 0);
});

// @requirement SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch
describe('an add-on booking brings the account up to date', () => {
    const freeze = (calls) => ({
        assertPartyFor: async () => {},
        freezeOnPlanChange: async () => calls.push('freeze'),
    });

    test('after the contract takes the booking in', async () => {
        const calls = [];
        const { ctrl } = buildController({
            contractFreeze: freeze(calls),
            charges: { recordDueCharges: async (tenantId) => calls.push(`charges ${tenantId}`) },
        });

        await ctrl.add(REQ, { bundleVersionId: 'bv-1' });

        assert.deepEqual(calls, ['freeze', 'charges t1']);
    });

    test('a journal that fails does not undo the booking', async () => {
        const { ctrl, serviceCalls } = buildController({
            contractFreeze: freeze([]),
            charges: {
                recordDueCharges: async () => {
                    throw new Error('the journal is down');
                },
            },
        });

        const booked = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });

        assert.equal(booked.id, 'sb-1');
        assert.equal(serviceCalls.length, 1);
    });

    test('a cancellation charges nothing new', async () => {
        const calls = [];
        const { ctrl } = buildController({
            contractFreeze: freeze([]),
            charges: { recordDueCharges: async () => calls.push('charges') },
        });

        await ctrl.cancel(REQ, 'sb-1');

        assert.deepEqual(calls, []);
    });
});
