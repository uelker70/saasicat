import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { SaaSiCatModule } from '../dist/platform/index.js';
import { PlanChangePreviewService, TenantBillingModule } from '../dist/billing/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';

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
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19.0,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    plans: [
        // Ranked below Pro, so a move from Pro to Basic lands at the end of the term.
        {
            id: 'BASIC',
            name: 'Basic',
            tagline: '',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 8 },
            features: ['CORE'],
        },
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

/** An add-on version as the catalogue reads it, sold to every plan unless `planIds` says otherwise. */
function addOnVersion(id, planIds = []) {
    return {
        id,
        bundleId: `b-${id}`,
        bundleKey: id.toUpperCase(),
        label: `Add-on ${id}`,
        version: 1,
        features: ['EXTRA'],
        quotas: {},
        compatibility: { planIds },
        pricingOverrides: [],
        monthlyNet: '5.00',
        yearlyNet: '50.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
    };
}

/** What the add-on catalogue holds: one add-on for every plan, one for Pro only. */
const ADD_ONS = [
    addOnVersion('bv-1'),
    addOnVersion('bv-pro-only', ['PRO']),
    // Any plan may book it, but only Pro has a price for it.
    {
        ...addOnVersion('bv-pro-priced'),
        monthlyNet: null,
        yearlyNet: null,
        pricingOverrides: [{ planId: 'PRO', monthlyNet: '5.00', yearlyNet: '50.00' }],
    },
];
const addOnCatalogue = {
    findVersionById: async (id) => ADD_ONS.find((v) => v.id === id) ?? null,
    findById: async (id) => ({ id, deletedAt: null }),
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

/** Records every `asOf` the service asks with, and every booking it changes. */
function bundleRepository(bookings) {
    const askedAt = [];
    const changed = [];
    return {
        askedAt,
        changed,
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
        findById: async (id) => bookings.find((b) => b.id === id) ?? null,
        add: async () => {
            throw new Error('not used');
        },
        cancel: async (id, patch) => {
            changed.push(['cancel', id]);
            return { ...bookings.find((b) => b.id === id), ...patch };
        },
        reactivate: async (id) => {
            changed.push(['reactivate', id]);
            return { ...bookings.find((b) => b.id === id), canceledAt: null };
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
                findActive: async () => ({
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
        catalog: { bundleRepository: addOnCatalogue },
    };
}

async function bootWithBookings(bookings, subscription = SUBSCRIPTION) {
    const repo = bundleRepository(bookings);
    const moduleRef = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                adapters: { secretSealer: storeSecretsInPlainText() },
                planCatalog: CATALOG,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence: persistenceWith(repo),
                tenantBilling: {
                    authGuards: { jwt: FakeJwtGuard },
                    subscriptionUsagePort: { findForTenant: async () => subscription },
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

// @requirement SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made
// @requirement SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running
// @requirement SC-CHG-024 — A plan change is refused while a booked add-on cannot run on the target plan
describe('the plan-change rule reaches the bookings in a real container', () => {
    test('a yearly add-on blocks a move to monthly when the module is composed normally', async () => {
        const { moduleRef, repo } = await bootWithBookings([YEARLY_BOOKING]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'PRO', 'MONTHLY', new Date('2026-06-15'));
        assert.ok(
            dto.blockers.some((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE'),
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
            dto.blockers.filter((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE'),
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
            dto.blockers.filter((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE'),
            [],
        );
        await moduleRef.close();
    });
});

/** The tenant's add-on route as the container built it. */
function bundleRoute(moduleRef) {
    for (const mod of moduleRef['container'].getModules().values()) {
        for (const [type, wrapper] of mod.controllers) {
            if (type?.name === 'GeneratedTenantSubscriptionBundlesController')
                return wrapper.instance;
        }
    }
    throw new Error('the add-on route is not mounted');
}

const PRO_ONLY_BOOKING = {
    ...YEARLY_BOOKING,
    bundleVersionId: 'bv-pro-only',
    billingCycle: 'MONTHLY',
};

/** The blockers a booked add-on raises against a plan change. */
const addOnBlockers = (dto) =>
    dto.blockers.filter((b) =>
        [
            'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN',
            'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE',
        ].includes(b.code),
    );

// @requirement SC-CHG-024 — A plan change is refused while a booked add-on cannot run on the target plan
describe('a plan change, and the add-ons booked, in a real container', () => {
    test('an add-on sold for Pro only blocks a move to Basic', async () => {
        const { moduleRef } = await bootWithBookings([PRO_ONLY_BOOKING]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        const blocker = dto.blockers.find(
            (b) => b.code === 'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN',
        );
        assert.ok(
            blocker,
            `the add-on catalogue did not reach the preview: ${JSON.stringify(dto.blockers)}`,
        );
        assert.deepEqual(blocker.params, {
            bundleName: 'Add-on bv-pro-only',
            planName: 'Basic',
            until: '2027-01-01',
        });
        await moduleRef.close();
    });

    test('an add-on with no price on the target plan in its rhythm blocks the move as well', async () => {
        const { moduleRef } = await bootWithBookings([
            { ...PRO_ONLY_BOOKING, bundleVersionId: 'bv-pro-priced' },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(
            dto.blockers
                .filter((b) => b.code === 'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN')
                .map((b) => b.params.bundleName),
            ['Add-on bv-pro-priced'],
        );
        await moduleRef.close();
    });

    test('an add-on the target plan can carry does not block it', async () => {
        const { moduleRef } = await bootWithBookings([
            { ...PRO_ONLY_BOOKING, bundleVersionId: 'bv-1' },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(addOnBlockers(dto), []);
        await moduleRef.close();
    });

    test('a booking cancelled to end before the change lands does not block it', async () => {
        const { moduleRef } = await bootWithBookings([
            { ...PRO_ONLY_BOOKING, canceledEffectiveAt: new Date('2026-12-01') },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(addOnBlockers(dto), []);
        await moduleRef.close();
    });

    test('it names the day a cancelled booking ends, where that comes after the change lands', async () => {
        const { moduleRef } = await bootWithBookings([
            {
                ...PRO_ONLY_BOOKING,
                canceledAt: new Date('2026-06-01'),
                canceledEffectiveAt: new Date('2027-03-01'),
            },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(
            addOnBlockers(dto).map((b) => b.params.until),
            ['2027-03-01'],
        );
        await moduleRef.close();
    });

    test('it names the end of the subscription where a cancelled booking would outlast it', async () => {
        const { moduleRef } = await bootWithBookings(
            [
                {
                    ...PRO_ONLY_BOOKING,
                    canceledAt: new Date('2026-06-01'),
                    canceledEffectiveAt: new Date('2027-03-01'),
                },
            ],
            {
                ...SUBSCRIPTION,
                canceledAt: new Date('2026-06-10'),
                canceledEffectiveAt: new Date('2026-10-01'),
            },
        );
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(
            addOnBlockers(dto).map((b) => b.params.until),
            ['2026-10-01'],
        );
        await moduleRef.close();
    });

    test('it names the earliest day the add-on could end: the later of its period and its commitment', async () => {
        const { moduleRef } = await bootWithBookings([
            { ...PRO_ONLY_BOOKING, minimumTermEndsAt: new Date('2027-06-01') },
        ]);
        const preview = moduleRef.get(PlanChangePreviewService);

        const dto = await preview.preview('t1', 'BASIC', 'YEARLY', new Date('2026-06-15'));
        assert.deepEqual(
            addOnBlockers(dto).map((b) => b.params.until),
            ['2027-06-01'],
        );
        await moduleRef.close();
    });
});

// @requirement SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to
describe('a booking, and the plans the subscription moves to, in a real container', () => {
    test('is refused where the plan a scheduled change moves to cannot carry the add-on', async () => {
        const { moduleRef } = await bootWithBookings([], {
            ...SUBSCRIPTION,
            pendingPlan: 'BASIC',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2027-01-01'),
        });

        const dto = await bundleRoute(moduleRef).preview(
            { user: { tenantId: 't1' } },
            { bundleVersionId: 'bv-pro-only' },
        );
        assert.deepEqual(
            dto.blockers
                .filter((b) => b.code === 'BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN')
                .map((b) => b.params),
            [{ planKey: 'BASIC', billingCycle: 'YEARLY', from: '2027-01-01' }],
            `the plans ahead did not reach the add-on route: ${JSON.stringify(dto.blockers)}`,
        );
        await moduleRef.close();
    });

    test('reinstating a cancelled one is refused against that plan too, and nothing changes', async () => {
        const { moduleRef, repo } = await bootWithBookings(
            [
                {
                    ...PRO_ONLY_BOOKING,
                    canceledAt: new Date('2026-06-01'),
                    // Still to come whenever this runs: a cancellation in
                    // effect is answered before the plans are asked.
                    canceledEffectiveAt: new Date('2099-01-01'),
                },
            ],
            {
                ...SUBSCRIPTION,
                pendingPlan: 'BASIC',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: new Date('2027-01-01'),
            },
        );

        await assert.rejects(
            () => bundleRoute(moduleRef).reactivate({ user: { tenantId: 't1' } }, 'sb-1'),
            (error) => {
                assert.equal(error.getStatus(), 422);
                assert.deepEqual(error.getResponse().params, {
                    planKey: 'BASIC',
                    billingCycle: 'YEARLY',
                    from: '2027-01-01',
                });
                return true;
            },
        );
        assert.deepEqual(repo.changed, []);
        await moduleRef.close();
    });
});

/** A booking of another subscription, cancelled and still running. */
const ANOTHER_SUBSCRIPTIONS_BOOKING = {
    ...YEARLY_BOOKING,
    id: 'sb-2',
    subscriptionId: 'sub-2',
    canceledAt: new Date('2026-06-01'),
    canceledEffectiveAt: new Date('2099-01-01'),
};

/** Refused as a booking the route does not know. */
const unknownBooking = (error) => {
    assert.equal(error.getStatus(), 404);
    assert.equal(error.getResponse().code, 'SUBSCRIPTION_BUNDLE_NOT_FOUND');
    return true;
};

// @requirement SC-SEC-001 — A tenant never sees another tenant's data
// @requirement SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session
describe('the add-on route acts only on the bookings of the subscription it serves', () => {
    test('a cancellation names a booking it does not hold, and nothing changes', async () => {
        const { moduleRef, repo } = await bootWithBookings([ANOTHER_SUBSCRIPTIONS_BOOKING]);

        await assert.rejects(
            () => bundleRoute(moduleRef).cancel({ user: { tenantId: 't1' } }, 'sb-2', {}),
            unknownBooking,
        );
        assert.deepEqual(repo.changed, []);
        await moduleRef.close();
    });

    test('a reinstatement names a booking it does not hold, and nothing changes', async () => {
        const { moduleRef, repo } = await bootWithBookings([ANOTHER_SUBSCRIPTIONS_BOOKING]);

        await assert.rejects(
            () => bundleRoute(moduleRef).reactivate({ user: { tenantId: 't1' } }, 'sb-2'),
            unknownBooking,
        );
        assert.deepEqual(repo.changed, []);
        await moduleRef.close();
    });

    test('its own booking it does reinstate', async () => {
        const { moduleRef, repo } = await bootWithBookings([
            { ...ANOTHER_SUBSCRIPTIONS_BOOKING, subscriptionId: 'sub-1' },
        ]);

        await bundleRoute(moduleRef).reactivate({ user: { tenantId: 't1' } }, 'sb-2');

        assert.deepEqual(repo.changed, [['reactivate', 'sb-2']]);
        await moduleRef.close();
    });
});

// @requirement SC-CHG-024 — A plan change is refused while a booked add-on cannot run on the target plan
describe('a module wired by hand', () => {
    test('refuses to start with the bookings and without the add-ons they name', () => {
        // Without the versions only the rhythm could be asked, and a change
        // would move an add-on onto a plan it was never sold for, unnoticed.
        assert.throws(
            () =>
                TenantBillingModule.forRoot({
                    authGuards: { jwt: FakeJwtGuard },
                    subscriptionUsagePort: { useValue: {} },
                    usageSnapshotPort: { useValue: {} },
                    subscriptionWritePort: { useValue: {} },
                    subscriptionBundleRepository: { useValue: {} },
                }),
            /subscriptionBundleRepository without bundleRepository/,
        );
    });
});
