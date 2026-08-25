import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanChangePreviewService, TenantBillingController } from '../dist/billing/index.js';

// A cancellation decides two things beyond its own date, and both have to reach
// the store, because nothing downstream can work them out again.
//
// The first is whether anything is left to run. A trial, or a subscription
// still waiting for sales, has no period end and no committed term: the rules
// land such a cancellation at once. Recording it without ending the
// subscription leaves a contract that the rules have already ended still
// handing out entitlements — no reader of entitlements filters a subscription
// by `canceledEffectiveAt`, and the renewal decision returns early on a
// subscription whose period end is null, so nothing else would ever notice.
//
// The second is the commitment. A declaration made after the notice window
// closed buys the following period. Every other reader of "how long is this
// customer committed" looks at `minimumTermUntil` — the plan-change preview
// does — so a cancellation that extends the commitment without saying so lets a
// downgrade be scheduled at the OLD term end, inside the period just bought.

const DAY = 86_400_000;

const SUBSCRIPTION = {
    plan: 'STANDARD',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    minimumTermUntil: new Date(Date.now() + 30 * DAY),
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
};

function recordingWritePort() {
    return {
        calls: [],
        async cancelSubscription(_tenantId, input) {
            this.calls.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: input.terminateNow ? 'CANCELED' : 'ACTIVE',
            };
        },
    };
}

// The notice period is the sixteenth constructor argument and every slot before
// it has to be filled. Named here rather than counted at each call site.
function buildController(subscription, port, noticePeriodDays = 0) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STANDARD', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return { isImmediate: false, effectiveAt: null, blockers: [] };
            },
        },
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
        null, // blockedPlans
        null, // promoCodes
        null, // auditService
        null, // userEmailResolver
        null, // auditContextResolver
        null, // subscriptionBundles
        null, // contractFreeze
        null, // trialProjection
        noticePeriodDays,
    );
}

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

describe('a cancellation with nothing left to run', () => {
    const noTerm = {
        ...SUBSCRIPTION,
        status: 'TRIAL',
        currentPeriodEnd: null,
        minimumTermUntil: null,
    };

    test('ends the subscription instead of leaving it active', async () => {
        const port = recordingWritePort();
        const result = await buildController(noTerm, port).cancelSubscription(request, {});

        assert.equal(port.calls[0].terminateNow, true, 'the store was told to keep the status');
        assert.equal(result.status, 'CANCELED');
    });

    test('and the date it lands on is the declaration itself', async () => {
        const port = recordingWritePort();
        await buildController(noTerm, port).cancelSubscription(request, {});

        const { canceledAt, effectiveAt } = port.calls[0];
        assert.equal(effectiveAt.getTime(), canceledAt.getTime());
    });
});

describe('a cancellation inside a running term', () => {
    // The premise for the pair above: if the flag were simply always true, this
    // would end a subscription the customer is still paying for.
    test('leaves the subscription running', async () => {
        const port = recordingWritePort();
        const result = await buildController(SUBSCRIPTION, port).cancelSubscription(request, {});

        assert.equal(port.calls[0].terminateNow, false);
        assert.equal(result.status, 'ACTIVE');
    });

    test('and does not touch the commitment', async () => {
        const port = recordingWritePort();
        await buildController(SUBSCRIPTION, port).cancelSubscription(request, {});

        assert.equal(
            port.calls[0].minimumTermUntil,
            undefined,
            'an ordinary cancellation rewrote the term it was measured against',
        );
    });
});

describe('a declaration made after the notice window closed', () => {
    // Term ends in five days, notice is fourteen: the door shut nine days ago.
    const closingSoon = {
        ...SUBSCRIPTION,
        currentPeriodEnd: new Date(Date.now() + 5 * DAY),
        minimumTermUntil: new Date(Date.now() + 5 * DAY),
    };

    test('extends the stored commitment to the period it bought', async () => {
        const port = recordingWritePort();
        const result = await buildController(closingSoon, port, 14).cancelSubscription(request, {});

        assert.equal(result.afterNoticeDeadline, true, 'the case under test did not arise');
        assert.deepEqual(
            port.calls[0].minimumTermUntil,
            port.calls[0].effectiveAt,
            'the extra period was billed but not committed',
        );
    });

    test('so a plan change cannot be scheduled inside that period', async () => {
        // The seam this exists for: the preview reads the commitment, never the
        // cancellation. Feed it the row the cancellation just wrote.
        const port = recordingWritePort();
        await buildController(closingSoon, port, 14).cancelSubscription(request, {});
        const committedUntil = port.calls[0].minimumTermUntil;

        const preview = new PlanChangePreviewService(
            CATALOG,
            {
                computeLimits: async () => ({
                    plan: 'STANDARD',
                    quotas: { users: 8 },
                    features: new Set(['CORE', 'EXTRA']),
                }),
                invalidateTenant() {},
            },
            {
                findForTenant: async () => ({
                    ...closingSoon,
                    minimumTermUntil: committedUntil,
                    canceledEffectiveAt: committedUntil,
                }),
            },
            { snapshot: async () => ({ users: 1 }) },
            null,
        );

        const dto = await preview.preview('t1', 'STARTER', 'YEARLY', new Date());

        assert.equal(dto.changeType, 'DOWNGRADE');
        assert.deepEqual(
            dto.effectiveAt,
            committedUntil,
            'the downgrade lands before the committed period is over',
        );
    });
});

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
