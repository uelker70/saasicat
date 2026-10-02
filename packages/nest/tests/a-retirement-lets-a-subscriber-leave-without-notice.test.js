// A subscription a retirement reaches may be left without notice until the
// retirement takes effect: the terms the subscriber agreed to are what the
// operator is changing, so neither the notice period nor a minimum term holds
// them. The page states it before the customer confirms, and the route does
// what the page stated.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

const DAY = 24 * 60 * 60 * 1000;
// Relative to now, because the controller reads the clock. Forty days of the
// yearly period are left; ninety days of notice do not fit inside them, and
// the minimum term runs another year.
const PERIOD_START = new Date(Date.now() - 325 * DAY);
const PERIOD_END = new Date(Date.now() + 40 * DAY);
const MINIMUM_TERM = new Date(Date.now() + 405 * DAY);
const NOTICE = { monthly: 14, yearly: 90 };

const subscription = () => ({
    id: 'sub-1',
    plan: 'STANDARD',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: PERIOD_START,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    minimumTermUntil: MINIMUM_TERM,
    canceledAt: null,
    canceledEffectiveAt: null,
    billingAnchorDay: PERIOD_END.getUTCDate(),
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: { id: 'pv-1', planId: 'STANDARD', version: 1 },
});

/** What the subscriber was told, taking effect `effectiveAt`. */
const told = (effectiveAt) => ({
    kind: 'version-retired',
    tenantId: 't1',
    subscriptionId: 'sub-1',
    retirementId: 'ret-1',
    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
    effectiveAt: effectiveAt.toISOString(),
    lastDayToCancel: new Date(effectiveAt.getTime() - 1).toISOString().slice(0, 10),
});

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

/**
 * The controller over the subscription above. `retirement` is what the
 * retirement service answers for it, `undefined` for an installation where
 * retiring is off.
 */
function buildController(retirement) {
    const port = {
        calls: [],
        async cancelSubscription(_tenantId, input) {
            this.calls.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: 'ACTIVE',
            };
        },
    };
    const asked = [];
    const retirements =
        retirement === undefined
            ? null
            : {
                  async pendingFor(subscription, now) {
                      asked.push(subscription);
                      return retirement && new Date(retirement.effectiveAt) > now
                          ? retirement
                          : null;
                  },
              };
    const args = [
        {
            computeLimits: async () => ({ plan: 'STANDARD', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        { planPriceNet: async () => '490.00' },
        { findForTenant: async () => subscription() },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    ];
    // Every optional collaborator between the resolvers and the notice periods.
    while (args.length < 15) args.push(null);
    args.push(NOTICE, null, null, null, retirements);
    return { controller: new TenantBillingController(...args), port, asked };
}

// @requirement SC-CANC-023 — A retirement lets a subscription cancel without notice until it takes effect
describe('a subscription a retirement reaches', () => {
    const effectiveAt = new Date(Date.now() + 100 * DAY);

    test('is shown the retirement it was told of', async () => {
        const { controller, asked } = buildController(told(effectiveAt));

        const usage = await controller.getUsage(request);

        assert.deepEqual(usage.retirement, told(effectiveAt));
        assert.deepEqual(asked, [{ id: 'sub-1', planVersion: subscription().planVersion }]);
    });

    test('is offered to leave at the end of the period it is in, without notice or minimum term', async () => {
        const without = await buildController(null).controller.getUsage(request);
        const reached = await buildController(told(effectiveAt)).controller.getUsage(request);

        assert.equal(
            without.cancellation.effectiveAt.getTime(),
            MINIMUM_TERM.getTime(),
            'without a retirement the minimum term holds',
        );
        assert.equal(reached.cancellation.effectiveAt.getTime(), PERIOD_END.getTime());
    });

    test('is cancelled for that date when it confirms', async () => {
        const { controller, port } = buildController(told(effectiveAt));

        const result = await controller.cancelSubscription(request, {});

        assert.equal(result.canceledEffectiveAt.getTime(), PERIOD_END.getTime());
        assert.equal(port.calls[0].effectiveAt.getTime(), PERIOD_END.getTime());
    });

    test('once the retirement has taken effect, owes notice and term again', async () => {
        const { controller } = buildController(told(new Date(Date.now() - DAY)));

        const usage = await controller.getUsage(request);

        assert.equal(usage.retirement, null);
        assert.equal(usage.cancellation.effectiveAt.getTime(), MINIMUM_TERM.getTime());
    });
});

describe('an installation where retiring versions is off', () => {
    test('shows no retirement and keeps the terms', async () => {
        const { controller } = buildController(undefined);

        const usage = await controller.getUsage(request);

        assert.equal(usage.retirement, null);
        assert.equal(usage.cancellation.effectiveAt.getTime(), MINIMUM_TERM.getTime());
    });
});
