// A cancelled add-on ends on its effective date, whatever contract is in force.
//
// The platform writes a contract again when an add-on is booked, cancelled or
// reinstated, and not when a date arrives. So what an add-on grants has to end
// by itself: a contract written on the day of the cancellation must not carry
// the add-on in its entitlements, and the booking has to grant it until then.
//
// Every case below runs through the real freeze and the real entitlement
// service over one set of bookings, in the order a tenant meets them: book,
// cancel, and then only the clock moves.

// @requirement SC-BUN-034 — A cancelled add-on ends on its effective date, whatever contract is in force

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SubscriptionContractFreezeService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { EntitlementService } from '../dist/entitlement/index.js';
import {
    FakePlanVersionRepository,
    FakeSubscriptionContractRepository,
    FakeSubscriptionRepository,
    FakeTransactionRunner,
} from '../dist/testing/index.js';
import { boundPlanVersion } from './helpers/subscription-fixtures.js';

const STANDARD = {
    id: 'STANDARD',
    name: 'Standard',
    tagline: '',
    marketed: true,
    monthlyNet: 49,
    yearlyNet: 490,
    quotas: { users: 5, storageGb: 5 },
    features: ['CORE'],
};

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Demo App' },
    currency: 'EUR',
    vatRate: 19,
    plans: [STANDARD],
};

/** Two add-ons, so that one can end while the other runs on. */
const VERSIONS = {
    'bv-archive': { bundleKey: 'ARCHIVE', features: ['ARCHIVE'], quotas: { storageGb: 20 } },
    'bv-team': { bundleKey: 'TEAM', features: ['TEAM'], quotas: { users: 10 } },
};

const PARTIES = {
    subscriberId: 'subscriber-t1',
    subscriber: {
        customerNumber: '10001',
        legalName: 'Tenant One GmbH',
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: null,
    },
    issuer: null,
};

const BOOKED = new Date('2026-05-01T00:00:00.000Z');
const CANCELLED = new Date('2026-05-10T00:00:00.000Z');
const ENDS = new Date('2026-06-01T00:00:00.000Z');
const BEFORE = new Date('2026-05-20T00:00:00.000Z');
const LATER = new Date('2026-07-15T00:00:00.000Z');

function tenant() {
    const bookings = [];
    const subscriptions = new FakeSubscriptionRepository();
    const planVersions = new FakePlanVersionRepository();
    const contracts = new FakeSubscriptionContractRepository();
    const planVersion = {
        planId: 'STANDARD',
        quotas: STANDARD.quotas,
        features: STANDARD.features,
    };
    planVersions.set(planVersion);
    subscriptions.set({
        id: 'sub-1',
        tenantId: 't1',
        plan: 'STANDARD',
        status: 'ACTIVE',
        isPilot: false,
        trialEntitlementPlan: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        customLimits: null,
        planVersionId: 'pv-standard',
        planVersion,
        canceledAt: null,
        canceledEffectiveAt: null,
    });

    const entitlements = new EntitlementService(
        givenPlanCatalogSource(CATALOG),
        subscriptions,
        planVersions,
        new FakeTransactionRunner(),
        null,
        {
            listActiveBySubscription: async (_subscriptionId, asOf) =>
                bookings.filter(
                    (b) => b.canceledEffectiveAt === null || b.canceledEffectiveAt > asOf,
                ),
        },
        { findVersionById: async (id) => VERSIONS[id] ?? null },
        contracts,
    );

    // The source bills every booking that has not ended, a cancelled one
    // included, the way both applications built on the platform do.
    const freeze = new SubscriptionContractFreezeService(
        givenPlanCatalogSource(CATALOG),
        entitlements,
        {
            assertPartyFor: async () => {},
            findActiveByTenantId: (tenantId, asOf) =>
                contracts.findActiveByTenantId(tenantId, asOf),
            terminate: (id, data) => contracts.terminate(id, data),
            create: (data) => contracts.create({ ...data, parties: PARTIES }),
        },
        {
            findBoundPlanVersion: async () => boundPlanVersion(STANDARD, 'pv-standard'),
            loadBookedBundles: async () => ({
                lineItems: bookings.map((b) => ({
                    kind: 'bundle',
                    sourceKey: VERSIONS[b.bundleVersionId].bundleKey,
                    sourceVersionId: b.bundleVersionId,
                    titleSnapshot: VERSIONS[b.bundleVersionId].bundleKey,
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 10,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: VERSIONS[b.bundleVersionId].features,
                    quotaEffectsSnapshot: VERSIONS[b.bundleVersionId].quotas,
                    metadata: null,
                })),
                bundleVersionIds: bookings.map((b) => b.bundleVersionId),
            }),
        },
    );
    const writeContract = (at) => freeze.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', at, null);

    return {
        contracts,
        entitlements,
        async book(bundleVersionId) {
            bookings.push({
                id: `sb-${bundleVersionId}`,
                bundleVersionId,
                canceledEffectiveAt: null,
            });
            await writeContract(BOOKED);
        },
        async cancel(bundleVersionId) {
            bookings.find((b) => b.bundleVersionId === bundleVersionId).canceledEffectiveAt = ENDS;
            await writeContract(CANCELLED);
        },
        async reinstate(bundleVersionId, at) {
            bookings.find((b) => b.bundleVersionId === bundleVersionId).canceledEffectiveAt = null;
            await writeContract(at);
        },
        /** Uncached, so each read answers for its own moment. */
        grants(at) {
            entitlements.invalidateTenant('t1');
            return entitlements.computeLimits('t1', at);
        },
    };
}

async function bookedAndCancelled() {
    const t = tenant();
    await t.book('bv-archive');
    await t.cancel('bv-archive');
    return t;
}

describe('an add-on cancelled under a contract', () => {
    test('grants what it granted until its effective date, counted once', async () => {
        const t = await bookedAndCancelled();

        const limits = await t.grants(BEFORE);

        assert.deepEqual([...limits.features].sort(), ['ARCHIVE', 'CORE']);
        assert.equal(limits.quotas.storageGb, 25, 'the plan’s 5 and the add-on’s 20, once each');
    });

    test('still grants it a moment before the date', async () => {
        const t = await bookedAndCancelled();

        const limits = await t.grants(new Date(ENDS.getTime() - 1));

        assert.ok(limits.features.has('ARCHIVE'));
    });

    test('grants nothing of it from the date on, with no write in between', async () => {
        const t = await bookedAndCancelled();

        for (const at of [ENDS, LATER]) {
            const limits = await t.grants(at);
            assert.deepEqual([...limits.features], ['CORE'], at.toISOString());
            assert.equal(limits.quotas.storageGb, 5, at.toISOString());
        }
    });

    test('the contract written on cancelling keeps its line and leaves it out of the entitlements', async () => {
        const t = await bookedAndCancelled();

        const contract = await t.contracts.findActiveByTenantId('t1', BEFORE);

        assert.ok(
            contract.lineItems.some((line) => line.sourceVersionId === 'bv-archive'),
            'the add-on is billed until its date, so the contract still names it',
        );
        assert.deepEqual(contract.entitlementSnapshot.features, ['CORE']);
        assert.equal(contract.entitlementSnapshot.quotas.storageGb, 5);
        assert.deepEqual(
            contract.entitlementSnapshot.leftOutBundleVersionIds,
            ['bv-archive'],
            'the snapshot names what it left out, so a reader knows it is not in there',
        );
    });

    test('an add-on beside it that is not cancelled runs on', async () => {
        const t = tenant();
        await t.book('bv-archive');
        await t.book('bv-team');
        await t.cancel('bv-archive');

        const before = await t.grants(BEFORE);
        const after = await t.grants(LATER);

        assert.equal(before.quotas.users, 15, 'the running add-on is counted once');
        assert.deepEqual([...after.features].sort(), ['CORE', 'TEAM']);
        assert.equal(after.quotas.users, 15);
        assert.equal(after.quotas.storageGb, 5);
    });

    test('reinstated before its date, it runs on past it', async () => {
        const t = await bookedAndCancelled();
        await t.reinstate('bv-archive', BEFORE);

        const limits = await t.grants(LATER);

        assert.ok(limits.features.has('ARCHIVE'));
        assert.equal(limits.quotas.storageGb, 25);
    });
});

describe('a contract that recorded the add-on in its own entitlements', () => {
    // Written before the platform left a cancelled add-on out, or by an
    // application concluding a contract itself: the snapshot contains the
    // add-on and names nothing as left out. Counting the booking on top of it
    // would grant the add-on's quota twice until its date.
    async function underAContractThatContainsIt() {
        const t = await bookedAndCancelled();
        const written = await t.contracts.findActiveByTenantId('t1', BEFORE);
        await t.contracts.terminate(written.id, {
            effectiveUntil: CANCELLED,
            status: 'superseded',
        });
        await t.contracts.create({
            tenantId: 't1',
            parties: PARTIES,
            effectiveFrom: CANCELLED,
            originalBundleVersionIds: ['bv-archive'],
            priceSnapshot: written.priceSnapshot,
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 5, storageGb: 25 },
                features: ['ARCHIVE', 'CORE'],
            },
            lineItems: [],
        });
        return t;
    }

    test('keeps counting a cancelled add-on once', async () => {
        const t = await underAContractThatContainsIt();

        const limits = await t.grants(BEFORE);

        assert.equal(limits.quotas.storageGb, 25, 'the add-on’s quota was counted twice');
    });

    test('does not report the add-on as left out, since it is in there', async () => {
        // A snapshot written from such an answer would name the add-on while
        // containing it, and the booking would then count it a second time.
        const t = await underAContractThatContainsIt();

        const answer = await t.entitlements.computeContractLimits('t1', BEFORE, CATALOG);

        assert.equal(answer.limits.quotas.storageGb, 25);
        assert.deepEqual(answer.leftOutBundleVersionIds, []);
    });
});

// @requirement SC-ENTL-016 — An answer computed before an end date arrives is not served after it
describe('a remembered answer and a cancelled add-on', () => {
    test('an answer computed before the date is not served on it', async () => {
        const t = await bookedAndCancelled();
        t.entitlements.invalidateTenant('t1');
        const oneMinuteBefore = new Date(ENDS.getTime() - 60_000 + 1);

        const cached = await t.entitlements.computeLimits('t1', oneMinuteBefore);
        const onTheDate = await t.entitlements.computeLimits('t1', ENDS);

        assert.ok(cached.features.has('ARCHIVE'));
        assert.ok(!onTheDate.features.has('ARCHIVE'), 'the cached answer outlived the add-on');
    });
});
