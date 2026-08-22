import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PrismaTenantSubscriptionWriteAdapter } from '../dist/index.js';

function subscriptionRow(overrides = {}) {
    return {
        id: 'subscription-1',
        tenantId: 'tenant-1',
        plan: 'STARTER',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        canceledAt: null,
        currentPeriodEnd: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionId: null,
        ...overrides,
    };
}

function fakePrisma({
    subscription = subscriptionRow(),
    plans = [
        { id: 'plan-starter', projectKey: 'app', planKey: 'STARTER' },
        { id: 'plan-pro', projectKey: 'app', planKey: 'PRO' },
    ],
    planVersions = [
        { id: 'version-starter', planId: 'plan-starter' },
        { id: 'version-pro', planId: 'plan-pro' },
    ],
    subscriptionDelegate = 'subscription',
    planVersionDelegate = 'planVersion',
} = {}) {
    const calls = {
        transactions: 0,
        subscriptionUpdates: [],
        subscriptionUpdateMany: [],
        planVersionFindFirst: [],
    };
    const state = {
        subscription: structuredClone(subscription),
        redemptions: [],
    };
    const client = {
        calls,
        state,
        plan: {
            async findFirst({ where }) {
                return (
                    plans.find(
                        (plan) =>
                            plan.projectKey === where.projectKey && plan.planKey === where.planKey,
                    ) ?? null
                );
            },
            async findUnique({ where }) {
                return plans.find((plan) => plan.id === where.id) ?? null;
            },
        },
        async $transaction(work) {
            calls.transactions += 1;
            const snapshot = structuredClone(state);
            try {
                return await work(client);
            } catch (error) {
                state.subscription = snapshot.subscription;
                state.redemptions = snapshot.redemptions;
                throw error;
            }
        },
    };
    client[subscriptionDelegate] = {
        async findUnique({ where }) {
            if (
                (where.tenantId && where.tenantId === state.subscription.tenantId) ||
                (where.id && where.id === state.subscription.id)
            ) {
                return structuredClone(state.subscription);
            }
            return null;
        },
        async update({ data }) {
            calls.subscriptionUpdates.push(structuredClone(data));
            Object.assign(state.subscription, data);
            return structuredClone(state.subscription);
        },
        async updateMany({ where, data }) {
            calls.subscriptionUpdateMany.push({
                where: structuredClone(where),
                data: structuredClone(data),
            });
            if (
                where.id !== state.subscription.id ||
                (where.pendingPlanVersionId !== undefined &&
                    where.pendingPlanVersionId !== state.subscription.pendingPlanVersionId) ||
                where.pendingPlanVersionAccepted !== state.subscription.pendingPlanVersionAccepted
            ) {
                return { count: 0 };
            }
            Object.assign(state.subscription, data);
            return { count: 1 };
        },
    };
    client[planVersionDelegate] = {
        async findFirst(args) {
            calls.planVersionFindFirst.push(args);
            return planVersions.find((version) => version.planId === args.where.planId) ?? null;
        },
        async findUnique({ where }) {
            return planVersions.find((version) => version.id === where.id) ?? null;
        },
    };
    client.promoCodeRedemption = {
        async create({ data }) {
            const row = { id: `redemption-${state.redemptions.length + 1}`, ...data };
            state.redemptions.push(row);
            return structuredClone(row);
        },
    };
    return client;
}

describe('PrismaTenantSubscriptionWriteAdapter', () => {
    test('the no-options default preserves the 0.6 plan-only write', async () => {
        const prisma = fakePrisma();
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma);

        assert.equal(adapter.applyOnboardingSelection, undefined);
        await adapter.changePlanImmediate('tenant-1', {
            planId: 'PRO',
            cycle: 'MONTHLY',
            periodStart: null,
            periodEnd: null,
            nextStatus: null,
        });

        assert.equal(prisma.calls.transactions, 0);
        assert.equal(prisma.calls.planVersionFindFirst.length, 0);
        assert.equal(prisma.calls.subscriptionUpdates[0].plan, 'PRO');
        assert.equal('planVersionId' in prisma.calls.subscriptionUpdates[0], false);
    });

    test('normalized mode binds semantic plan and active version atomically with named delegates', async () => {
        const prisma = fakePrisma({
            subscription: subscriptionRow({
                pendingPlanVersionId: 'version-starter',
                pendingPlanVersionAccepted: true,
            }),
            subscriptionDelegate: 'membership',
            planVersionDelegate: 'billingPlanVersion',
        });
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma, {
            planBinding: { mode: 'normalized-plan-id', projectKey: 'app' },
            delegates: { entitlementPlanVersion: 'billingPlanVersion' },
            planVersionFields: {
                entitlement: { validityWindows: true, endsAt: true },
            },
            tenantSubscription: {
                delegate: 'membership',
                synchronizePlanVersion: true,
                activeVersionSelection: 'validity-window',
                withEndsAt: true,
            },
        });

        const result = await adapter.changePlanImmediate('tenant-1', {
            planId: 'PRO',
            cycle: 'YEARLY',
            periodStart: new Date('2026-07-24T00:00:00.000Z'),
            periodEnd: new Date('2027-07-24T00:00:00.000Z'),
            nextStatus: 'ACTIVE',
        });

        assert.deepEqual(result, { plan: 'PRO', billingCycle: 'YEARLY' });
        assert.equal(prisma.calls.transactions, 1);
        assert.equal(prisma.calls.planVersionFindFirst[0].where.planId, 'plan-pro');
        assert.equal(prisma.calls.planVersionFindFirst[0].where.AND.length, 3);
        assert.deepEqual(prisma.calls.planVersionFindFirst[0].orderBy[0], {
            validFrom: { sort: 'desc', nulls: 'last' },
        });
        assert.equal(prisma.calls.subscriptionUpdates[0].plan, 'PRO');
        assert.equal(prisma.calls.subscriptionUpdates[0].planVersionId, 'version-pro');
        assert.equal(prisma.calls.subscriptionUpdates[0].pendingPlanVersionId, null);
        assert.equal(prisma.calls.subscriptionUpdates[0].pendingPlanVersionAccepted, false);
    });

    test('a pending version of the same target plan is retained', async () => {
        const prisma = fakePrisma({
            subscription: subscriptionRow({
                plan: 'PRO',
                pendingPlanVersionId: 'version-pro',
            }),
        });
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma, {
            planBinding: { mode: 'normalized-plan-id', projectKey: 'app' },
            tenantSubscription: { synchronizePlanVersion: true },
        });

        await adapter.changePlanImmediate('tenant-1', {
            planId: 'PRO',
            cycle: 'MONTHLY',
            periodStart: null,
            periodEnd: null,
            nextStatus: null,
        });

        assert.equal('pendingPlanVersionId' in prisma.calls.subscriptionUpdates[0], false);
    });

    test('a failing onboarding callback rolls plan and version back together', async () => {
        const prisma = fakePrisma();
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma, {
            planBinding: { mode: 'normalized-plan-id', projectKey: 'app' },
            tenantSubscription: {
                synchronizePlanVersion: true,
                atomicOnboardingSelection: true,
            },
        });

        await assert.rejects(
            adapter.applyOnboardingSelection(
                'tenant-1',
                {
                    planId: 'PRO',
                    cycle: 'MONTHLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                },
                async (tx, subscriptionId) => {
                    assert.equal(prisma.state.subscription.plan, 'PRO');
                    assert.equal(prisma.state.subscription.planVersionId, 'version-pro');
                    await tx.promoCodeRedemption.create({
                        data: {
                            promoCodeId: 'promo-1',
                            subscriptionId,
                            tenantId: 'tenant-1',
                        },
                    });
                    assert.equal(prisma.state.redemptions.length, 1);
                    throw new Error('promo failed');
                },
            ),
            /promo failed/,
        );

        assert.equal(prisma.state.subscription.plan, 'STARTER');
        assert.equal(prisma.state.subscription.planVersionId, undefined);
        assert.equal(prisma.state.redemptions.length, 0);
    });

    test('pending PlanVersion acceptance uses a CAS and reports the concurrent loser', async () => {
        const prisma = fakePrisma({
            subscription: subscriptionRow({
                pendingPlanVersionId: 'version-pro',
                pendingPlanVersionEffectiveAt: new Date('2026-08-01T00:00:00.000Z'),
            }),
        });
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma);
        const firstNow = new Date('2026-07-24T10:00:00.000Z');
        const secondNow = new Date('2026-07-24T10:00:01.000Z');

        const results = await Promise.all([
            adapter.acceptPendingPlanVersion('tenant-1', 'user-1', firstNow),
            adapter.acceptPendingPlanVersion('tenant-1', 'user-2', secondNow),
        ]);

        assert.deepEqual(results.map((result) => result.alreadyAccepted).sort(), [false, true]);
        assert.equal(prisma.calls.subscriptionUpdateMany.length, 2);
        assert.deepEqual(prisma.calls.subscriptionUpdateMany[0].where, {
            id: 'subscription-1',
            pendingPlanVersionId: 'version-pro',
            pendingPlanVersionAccepted: false,
        });
        assert.equal(prisma.state.subscription.pendingPlanVersionAccepted, true);
        assert.equal(prisma.state.subscription.pendingPlanVersionAcceptedByUserId, 'user-1');
        assert.equal(results[0].acceptedAt.toISOString(), firstNow.toISOString());
        assert.equal(results[1].acceptedAt.toISOString(), firstNow.toISOString());
    });

    test('pending PlanVersion acceptance rejects a changed CAS target and a missing target', async () => {
        const prisma = fakePrisma({
            subscription: subscriptionRow({ pendingPlanVersionId: 'version-pro' }),
        });
        const updateMany = prisma.subscription.updateMany.bind(prisma.subscription);
        prisma.subscription.updateMany = async (args) => {
            prisma.state.subscription.pendingPlanVersionId = 'version-replaced';
            return updateMany(args);
        };
        const adapter = new PrismaTenantSubscriptionWriteAdapter(prisma);

        await assert.rejects(
            adapter.acceptPendingPlanVersion('tenant-1', 'user-1', new Date()),
            /Pending PlanVersion changed while accepting it/,
        );
        assert.equal(prisma.state.subscription.pendingPlanVersionAccepted, false);

        const withoutPending = new PrismaTenantSubscriptionWriteAdapter(
            fakePrisma({ subscription: subscriptionRow({ pendingPlanVersionId: null }) }),
        );
        await assert.rejects(
            withoutPending.acceptPendingPlanVersion('tenant-1', 'user-1', new Date()),
            /No pending PlanVersion/,
        );
    });

    test('invalid validity capability combinations fail at construction', () => {
        const prisma = fakePrisma();
        assert.throws(
            () =>
                new PrismaTenantSubscriptionWriteAdapter(prisma, {
                    tenantSubscription: {
                        synchronizePlanVersion: true,
                        activeVersionSelection: 'validity-window',
                    },
                }),
            /validityWindows=true/,
        );
    });
});
