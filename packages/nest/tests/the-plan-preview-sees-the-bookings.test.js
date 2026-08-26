import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { SaaSiCatModule } from '../dist/platform/index.js';
import { PlanChangePreviewService } from '../dist/billing/index.js';

// A rule that reads an optional dependency is only as real as its wiring.
//
// `PlanChangePreviewService` refuses a move to a shorter billing cycle while an
// add-on with a longer one is booked. It reads the bookings through an optional
// injection, and an optional injection that nothing provides is `null` — which
// reads as "no bookings" and lets the move through. The unit tests for that rule
// construct the service by hand and hand it the repository, so they prove the
// predicate and nothing about whether the container can satisfy it.
//
// It was not satisfiable: `SubscriptionBundleModule` exports the token, but it
// is a sibling of `TenantBillingModule` in the standard composition, and a
// sibling's exports do not reach another module's providers.
//
// So this boots the module the way a consumer does and asks the container.

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'test-app',
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19.0,
    plans: [
        {
            id: 'PRO',
            name: 'Pro',
            tagline: '',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8 },
            features: ['CORE'],
        },
    ],
};

const YEARLY_BOOKING = {
    id: 'sb-1',
    subscriptionId: 'sub-1',
    bundleVersionId: 'bv-1',
    billingCycle: 'YEARLY',
    startedAt: new Date('2026-01-01'),
    minimumTermEndsAt: null,
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2027-01-01'),
    canceledAt: null,
    canceledEffectiveAt: null,
};

/** Records every `asOf` the service asks with, so the P2 fix is observable too. */
function bundleRepository(bookings) {
    const askedAt = [];
    return {
        askedAt,
        listActiveBySubscription: async (_id, asOf) => {
            askedAt.push(asOf ?? null);
            return bookings.filter(
                (b) =>
                    b.canceledEffectiveAt === null ||
                    asOf === undefined ||
                    b.canceledEffectiveAt > asOf,
            );
        },
        listBySubscription: async () => bookings,
        findById: async () => null,
        add: async () => {
            throw new Error('not used');
        },
        cancel: async () => {
            throw new Error('not used');
        },
    };
}

const SUBSCRIPTION = {
    id: 'sub-1',
    plan: 'PRO',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2027-01-01'),
    minimumTermUntil: null,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: {
        id: 'pv1',
        planId: 'PRO',
        version: 1,
        publishedAt: null,
        supersededAt: null,
        changeNote: null,
        features: ['CORE'],
        quotas: { users: 8 },
    },
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
};

/** The persistence bundle a consumer hands in, with the booking repo inside it. */
function persistenceWith(repo) {
    const spec = {};
    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        },
        core: {
            mfa: spec,
            audit: spec,
            rlsBypass: spec,
            transactionRunner: spec,
        },
        entitlement: {
            // Enough of the entitlement path for the preview to compute limits;
            // what this test is about is one level above it.
            subscriptionRepository: {
                findByTenantId: async () => ({
                    ...SUBSCRIPTION,
                    tenantId: 't1',
                    quotas: { users: 8 },
                    features: ['CORE'],
                    canceledAt: null,
                    canceledEffectiveAt: null,
                }),
            },
            planVersionRepository: {
                findLatestLive: async () => ({
                    id: 'pv1',
                    planId: 'PRO',
                    version: 1,
                    features: ['CORE'],
                    quotas: { users: 8 },
                    publishedAt: new Date('2026-01-01'),
                    supersededAt: null,
                }),
                findById: async () => null,
            },
            subscriptionBundleRepository: repo,
        },
        catalog: { bundleRepository: spec },
    };
}

async function bootWithBookings(bookings) {
    const repo = bundleRepository(bookings);
    const moduleRef = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: CATALOG,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence: persistenceWith(repo),
                tenantBilling: {
                    authGuards: { jwt: FakeJwtGuard },
                    subscriptionUsagePort: { findForTenant: async () => SUBSCRIPTION },
                    usageSnapshotPort: { snapshot: async () => ({ users: 1 }) },
                    subscriptionWritePort: {},
                },
                subscriptionBundles: {},
                entitlement: { defaultPlanId: 'PRO' },
            }),
        ],
    }).compile();
    return { moduleRef, repo };
}

describe('the plan-change rule reaches the bookings in a real container', () => {
    test('a yearly add-on blocks a move to monthly when the module is composed normally', async () => {
        const { moduleRef, repo } = await bootWithBookings([YEARLY_BOOKING]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'PRO', 'MONTHLY', new Date('2026-06-15'));
        assert.ok(
            dto.blockers.some((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN'),
            `the rule did not reach the bookings: ${JSON.stringify(dto.blockers)}`,
        );
        assert.ok(repo.askedAt.length > 0, 'the repository was never asked');
        await moduleRef.close();
    });

    test('it asks as of the day the change lands, not today', async () => {
        // A tenant told to "cancel the add-on first" cancels it for the same
        // boundary the change takes effect at. Asking about today would still
        // see it active and refuse the very move the message asked for.
        const { moduleRef, repo } = await bootWithBookings([
            { ...YEARLY_BOOKING, canceledEffectiveAt: new Date('2027-01-01') },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'PRO', 'MONTHLY', new Date('2026-06-15'));
        assert.deepEqual(
            dto.blockers.filter((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN'),
            [],
            'a booking that ends before the change lands must not block it',
        );
        assert.deepEqual(
            repo.askedAt.map((d) => d?.toISOString().slice(0, 10)),
            ['2027-01-01'],
            'the question was asked about the wrong day',
        );
        await moduleRef.close();
    });

    test('nothing booked, nothing blocked', async () => {
        const { moduleRef } = await bootWithBookings([]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'PRO', 'MONTHLY', new Date('2026-06-15'));
        assert.deepEqual(
            dto.blockers.filter((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN'),
            [],
        );
        await moduleRef.close();
    });
});
