// A checkout offer concluded for a tenant whose subscription ended takes the
// tenant back, as a return through the platform's route does (`SC-CANC-034`):
// in the conclusion's transaction, the end and the reason it put the tenant in
// are lifted, the reason locked first, as a deletion that begins beside it and
// a return beside it lock it. Where the tenant cannot come back, the offer is
// refused as the return is, before anything is written, and stays open. A
// tenant without an end concludes as before.
//
// Fahrschule Weber's subscription ended on 30 September, its data is deleted
// on 30 October, Berlin time. The application concludes an offer of its own
// for it, its subscription started again in `within`; the offer service runs
// over the database the return and the deletion run on
// (`helpers/subscription-return.js`).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { CheckoutOfferService, SaaSiCatModule } from '../dist/platform/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import {
    FakeInstallationMarkRepository,
    FakeSubscriptionContractRepository,
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
    FakeTenantDeletionRepository,
} from '../dist/testing/index.js';
import {
    BUNDLE_VERSION,
    PLAN_VERSION,
    buildOfferService,
    fakeBundleRepo,
    fakeOfferRepo,
    fakePlanRepo,
} from './helpers/checkout-catalogue.js';
import { fakeSubscriberRepo } from './helpers/conclusion.js';
import { aDeletion } from './helpers/installation-mark.js';
import { ISSUER } from './helpers/invoice-run.js';
import {
    ADMIN,
    ADMIN_TAG,
    DELETES_ON,
    DELETION_DAY,
    ENDED,
    LAST_MOMENT,
    RETURN_AT,
    SUBSCRIPTION,
    TENANT,
    V3,
    aBarrier,
    aDeletionHeldAtItsBeginning,
    aReturnHeldAtItsWrite,
    aTenantThatEnded,
    contractsOf,
    deletedAfterASecondEnd,
    endsOf,
    firstEndedReasonOf,
    reasonsOf,
    untilItWaitsOrEnds,
} from './helpers/subscription-return.js';
import { RUN } from './helpers/tenant-deletion.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const refusedWith = (code) => (error) => error.response?.code === code;

/** A quarter of an hour after the end: the run that records it. */
const RECORDED = new Date('2026-09-30T22:15:00.000Z');

/** The offer's contract, in force from the moment the application concludes it. */
const concludedFor = (at) => ({ tenantId: TENANT, effectiveFrom: at });

/**
 * An offer service over `tenant`'s database, concluding with its subscriber
 * and its contract store and taking it back through its return service, and
 * an open offer of STANDARD, monthly, naming the add-on versions
 * `bundleVersionIds`; `services` replaces others the offer service is built
 * with. The offer store takes a consume back with the transaction it ran on.
 */
async function anOfferFor(tenant, { bundleVersionIds = [], ...services } = {}) {
    const repo = fakeOfferRepo();
    const consume = repo.consume.bind(repo);
    repo.consume = async (id, tx) => {
        const consumed = await consume(id, tx);
        tx.undo.push(() => Object.assign(repo.rows.get(id), { status: 'open', consumedAt: null }));
        return consumed;
    };
    const { service } = buildOfferService({
        repo,
        contracts: tenant.contractService,
        transactions: tenant.transactions,
        subscribers: tenant.subscriber,
        returns: tenant.service,
        ...services,
    });
    const offer = await service.create({
        planKey: 'STANDARD',
        billingCycle: 'monthly',
        bundleVersionIds,
    });
    return { offers: service, offer, statusOf: () => repo.rows.get(offer.id).status };
}

/**
 * What the application writes in the conclusion's transaction: its
 * subscription started again from `at`, taken back with the transaction.
 * `ran` counts the times it did.
 */
function startingTheSubscription(tenant, at, ran = []) {
    return async (tx) => {
        ran.push(at);
        const row = tenant.subscription.row;
        const before = { ...row };
        tx.undo.push(() => Object.assign(row, before));
        Object.assign(row, {
            status: 'ACTIVE',
            currentPeriodStart: at,
            currentPeriodEnd: new Date(at.getTime() + 30 * 24 * 60 * 60 * 1000),
            canceledAt: null,
            canceledEffectiveAt: null,
        });
    };
}

/** Holds the tenant back with an open reason of `kind`. */
const heldBy = (tenant, kind) =>
    tenant.holds.record({
        tenantId: TENANT,
        kind,
        reference: SUBSCRIPTION,
        note: null,
        since: ENDED,
        recordedBy: kind === 'suspended' ? 'cli:ops' : RUN,
    });

/** What the stores hold of the tenant and the offer, to show a refused offer wrote nothing. */
async function whatIsKept(tenant, statusOf) {
    return {
        offer: statusOf(),
        subscription: { ...tenant.subscription.row },
        reasons: structuredClone(reasonsOf(tenant)),
        ends: structuredClone(endsOf(tenant)),
        contracts: (await contractsOf(tenant)).length,
    };
}

/** Asserts that concluding `offer` at `at` is refused with `code`, writing nothing, its own writes never run. */
async function refusedWritingNothing(tenant, { offers, offer, statusOf }, at, code) {
    const before = await whatIsKept(tenant, statusOf);
    const ran = [];
    await assert.rejects(
        offers.conclude(offer.id, concludedFor(at), startingTheSubscription(tenant, at, ran)),
        refusedWith(code),
    );
    assert.deepEqual(await whatIsKept(tenant, statusOf), before);
    assert.equal(statusOf(), 'open');
    assert.deepEqual(ran, []);
    assert.deepEqual(tenant.calls.audited, []);
}

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a checkout offer for a tenant whose subscription ended takes it back', () => {
    test('on 20 October: its contract is written, and the end and its reason are lifted as of then, by the offer', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);
        const ran = [];

        const concluded = await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, RETURN_AT, ran),
        );

        assert.deepEqual(
            (await contractsOf(tenant)).map((contract) => contract.originalOfferId),
            [offer.id],
        );
        assert.equal(concluded.contract.originalOfferId, offer.id);
        assert.deepEqual(
            endsOf(tenant).map((end) => end.liftedAt),
            [RETURN_AT],
        );
        const reason = firstEndedReasonOf(tenant);
        assert.deepEqual(
            [reason.liftedAt, reason.liftedBy],
            [RETURN_AT, `checkout-offer:${offer.id}`],
        );
        assert.deepEqual(ran, [RETURN_AT]);
    });

    test('the last moment of the day before the deletion day is still in time', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: LAST_MOMENT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);

        await offers.conclude(
            offer.id,
            concludedFor(LAST_MOMENT),
            startingTheSubscription(tenant, LAST_MOMENT),
        );

        assert.deepEqual(
            endsOf(tenant).map((end) => end.liftedAt),
            [LAST_MOMENT],
        );
    });

    test('is audited as a return, naming the offer, its contract and the end it lifted, and no person', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);

        const { contract } = await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, RETURN_AT),
        );

        assert.deepEqual(tenant.calls.audited, [
            {
                actor: {
                    userId: null,
                    email: 'platform',
                    source: 'job',
                    context: 'checkout-offer',
                },
                entity: 'Subscription',
                entityId: TENANT,
                tenantId: TENANT,
                action: 'SUBSCRIPTION_RETURNED',
                changes: {
                    via: 'checkout-offer',
                    offerId: offer.id,
                    contractId: contract.id,
                    plan: 'STANDARD',
                    billingCycle: 'MONTHLY',
                    planVersionId: PLAN_VERSION.id,
                    endedAt: ENDED.toISOString(),
                    deletesOn: DELETES_ON,
                },
            },
        ]);
    });

    test('concluded already for the tenant, it answers the conclusion that stands and lifts nothing a second time', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);
        const first = await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, RETURN_AT),
        );
        t.mock.timers.setTime(LAST_MOMENT.getTime());
        const ran = [];

        const again = await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, LAST_MOMENT, ran),
        );

        assert.equal(again.contract.id, first.contract.id);
        assert.deepEqual(ran, []);
        assert.deepEqual(
            endsOf(tenant).map((end) => end.liftedAt),
            [RETURN_AT],
        );
        assert.equal(tenant.calls.audited.length, 1);
    });

    test('once deleted after a later end, the reason it lifted names the tenant’s administrator, not the operator', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);
        const { contract } = await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, RETURN_AT),
        );
        t.mock.timers.reset();

        const deleted = await deletedAfterASecondEnd(tenant, contract.id);

        assert.equal(deleted.deleted, 1);
        assert.equal(firstEndedReasonOf(tenant).liftedBy, 'tenant-admin');
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('an offer for a tenant whose subscription ended with an add-on booked', () => {
    const BOOKED = { ...BUNDLE_VERSION, version: 1 };
    const OFFERED = { ...BUNDLE_VERSION, id: 'bv-2', version: 2 };

    test('takes it back without that add-on: not granted again, and not read as booked in another version', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded({ ended: false });
        const booked = await tenant.bookings.add({
            subscriptionId: SUBSCRIPTION,
            bundleVersionId: BOOKED.id,
            startedAt: new Date('2026-03-01T00:00:00.000Z'),
        });
        await tenant.subscriptionEnds.recordEnded(RECORDED);
        const { offers, offer } = await anOfferFor(tenant, {
            bundleVersionIds: [OFFERED.id],
            bundles: fakeBundleRepo([BOOKED, OFFERED]),
            subscriptionUsage: tenant.subscription,
            bookings: tenant.bookings,
        });

        await offers.conclude(
            offer.id,
            concludedFor(RETURN_AT),
            startingTheSubscription(tenant, RETURN_AT),
        );

        const kept = await tenant.bookings.findById(booked.id);
        assert.deepEqual([kept.canceledAt, kept.canceledEffectiveAt], [ENDED, ENDED]);
        tenant.entitlements.invalidateTenant(TENANT);
        const granted = await tenant.entitlements.computeLimits(TENANT, RETURN_AT);
        assert.equal([...granted.features].includes('ARCHIVE'), false);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('an offer for a tenant that cannot come back is refused as a return is, and stays open', () => {
    test('from midnight of the deletion day, naming the day', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: DELETION_DAY });
        const tenant = await aTenantThatEnded();
        const conclusion = await anOfferFor(tenant);

        await refusedWritingNothing(
            tenant,
            conclusion,
            DELETION_DAY,
            'TENANT_RETURN_DELETION_DAY_REACHED',
        );
        await assert.rejects(
            conclusion.offers.conclude(conclusion.offer.id, concludedFor(DELETION_DAY)),
            (error) => error.response.params.deletesOn === DELETES_ON,
        );
    });

    test('once its deletion has begun, as the tenant is told wherever it asks — before what the offer itself is asked', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'deleting');
        // The deletion has closed the subscriber's link to the tenant: a
        // party the offer would otherwise ask about first.
        tenant.state.subscriberMissing = true;

        await refusedWritingNothing(
            tenant,
            await anOfferFor(tenant),
            RETURN_AT,
            'TENANT_BEING_DELETED',
        );
    });

    test('while the operator suspends it', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        await heldBy(tenant, 'suspended');

        await refusedWritingNothing(
            tenant,
            await anOfferFor(tenant),
            RETURN_AT,
            'TENANT_SUSPENDED',
        );
    });

    test('where the application’s own writes fail: the end and its reason stay, the offer stays open, no contract', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded();
        const { offers, offer, statusOf } = await anOfferFor(tenant);
        const before = await whatIsKept(tenant, statusOf);

        await assert.rejects(
            offers.conclude(offer.id, concludedFor(RETURN_AT), async () => {
                throw new Error('the subscription could not be started');
            }),
            /the subscription could not be started/,
        );

        assert.deepEqual(await whatIsKept(tenant, statusOf), before);
        assert.deepEqual(tenant.calls.audited, []);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('a tenant without an end concludes an offer as before', () => {
    test('one in its trial: the contract is written, nothing is lifted or audited', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded({ ended: false });
        const { offers, offer } = await anOfferFor(tenant);

        await offers.conclude(offer.id, concludedFor(RETURN_AT));

        assert.equal((await contractsOf(tenant)).length, 1);
        assert.deepEqual(reasonsOf(tenant), []);
        assert.deepEqual(tenant.calls.audited, []);
    });

    test('one the operator suspends without an end: concluded, its suspension left as it is', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const tenant = await aTenantThatEnded({ ended: false });
        await heldBy(tenant, 'suspended');
        const { offers, offer } = await anOfferFor(tenant);

        await offers.conclude(offer.id, concludedFor(RETURN_AT));

        assert.equal((await contractsOf(tenant)).length, 1);
        assert.deepEqual(
            reasonsOf(tenant).map((reason) => [reason.kind, reason.liftedAt]),
            [['suspended', null]],
        );
        assert.deepEqual(tenant.calls.audited, []);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('an offer, a deletion and a return beside it lock one reason', { timeout: 5000 }, () => {
    test('the deletion first: the offer waits for it, finds the tenant being deleted and is refused', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: LAST_MOMENT });
        const tenant = await aTenantThatEnded();
        const { offers, offer, statusOf } = await anOfferFor(tenant);
        const held = aDeletionHeldAtItsBeginning(tenant);

        const deleting = tenant.run.service.deleteDue(DELETION_DAY);
        await held.arrived;
        const concluding = offers.conclude(
            offer.id,
            concludedFor(LAST_MOMENT),
            startingTheSubscription(tenant, LAST_MOMENT),
        );
        await untilItWaitsOrEnds(tenant.holds, concluding);
        held.open();

        await assert.rejects(concluding, refusedWith('TENANT_BEING_DELETED'));
        await deleting;
        assert.equal(statusOf(), 'open');
        assert.equal(endsOf(tenant)[0].liftedAt, null);
        assert.equal((await contractsOf(tenant)).length, 0);
    });

    test('the offer first: the deletion waits for it, finds the reason lifted and begins nothing', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: LAST_MOMENT });
        const tenant = await aTenantThatEnded();
        const { offers, offer } = await anOfferFor(tenant);
        // Held once the offer has the reason locked, before it lifts it.
        const held = aBarrier();
        const lockAllOf = tenant.holds.lockAllOf.bind(tenant.holds);
        let first = true;
        tenant.holds.lockAllOf = async (tenantId, tx) => {
            if (first) {
                first = false;
                await held.pass();
            }
            return lockAllOf(tenantId, tx);
        };

        const concluding = offers.conclude(
            offer.id,
            concludedFor(LAST_MOMENT),
            startingTheSubscription(tenant, LAST_MOMENT),
        );
        await held.arrived;
        const deleting = tenant.run.service.deleteDue(DELETION_DAY);
        await untilItWaitsOrEnds(tenant.holds, deleting);
        held.open();

        await concluding;
        assert.deepEqual(await deleting, { deleted: 0, halted: 0, failed: 0 });
        assert.deepEqual(tenant.records.deletions, []);
        assert.equal(firstEndedReasonOf(tenant).liftedBy, `checkout-offer:${offer.id}`);
    });

    test('a return through the route first: the offer waits for it, finds a contract in force and is refused', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: LAST_MOMENT });
        const tenant = await aTenantThatEnded();
        const { offers, offer, statusOf } = await anOfferFor(tenant);
        const held = aReturnHeldAtItsWrite(tenant);

        const returning = tenant.service.takeOut(
            TENANT,
            { plan: 'STANDARD', billingCycle: 'MONTHLY', planVersionId: V3.id },
            ADMIN,
            LAST_MOMENT,
        );
        await held.arrived;
        const concluding = offers.conclude(
            offer.id,
            concludedFor(LAST_MOMENT),
            startingTheSubscription(tenant, LAST_MOMENT),
        );
        await untilItWaitsOrEnds(tenant.holds, concluding);
        held.open();

        await returning;
        await assert.rejects(concluding, refusedWith('CHECKOUT_OFFER_CONTRACT_IN_FORCE'));
        assert.equal(statusOf(), 'open');
        assert.deepEqual(
            (await contractsOf(tenant)).map((contract) => contract.originalOfferId ?? null),
            [null],
        );
        assert.equal(firstEndedReasonOf(tenant).liftedBy, ADMIN_TAG);
    });
});

/**
 * The platform as an application composes it, with tenant billing recording
 * the ends of subscriptions and checkout offers concluded through the
 * platform, every adapter a fake; `TENANT`'s subscription ended at `ENDED`.
 */
async function aPlatformWithAnEndedTenant() {
    const holds = new FakeTenantAccessHoldRepository();
    const ends = new FakeSubscriptionEndRepository();
    await holds.record({
        tenantId: TENANT,
        kind: 'ended',
        reference: SUBSCRIPTION,
        note: null,
        since: ENDED,
        recordedBy: RUN,
    });
    await ends.record({
        tenantId: TENANT,
        subscriptionId: SUBSCRIPTION,
        endsAt: ENDED,
        deletesOn: DELETES_ON,
        recordedAt: ENDED,
        recordedBy: RUN,
    });
    const subscribers = fakeSubscriberRepo([TENANT]);
    const root = SaaSiCatModule.forRoot({
        adapters: { secretSealer: storeSecretsInPlainText() },
        planCatalog: {
            schemaVersion: 1,
            app: { name: 'Drive School' },
            currency: 'EUR',
            vatRate: 19,
            issuer: ISSUER,
            tenantBilling: {
                cancellationNoticeDays: { monthly: 0, yearly: 0 },
                selfServiceBlockedPlans: { asTarget: [], asSource: [] },
                endOfSubscription: { readOnlyDays: 30, reminderDaysBefore: [10, 3] },
            },
            plans: [],
        },
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            core: {
                tenantAccessHolds: holds,
                subscriptionEnds: ends,
                installationMark: new FakeInstallationMarkRepository(),
                tenantDeletions: new FakeTenantDeletionRepository(),
                mfa: {},
                audit: { write: async () => {} },
                rlsBypass: { runWithBypass: (fn) => fn() },
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriberRepository: {
                    ...subscribers,
                    findById: async () => null,
                    listTenantLinks: async () => [],
                },
                subscriptionRepository: { findByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
                subscriptionContractRepository: new FakeSubscriptionContractRepository(),
            },
            tenantBilling: {
                subscriptionUsagePort: { findForTenant: async () => null },
                subscriptionWritePort: {},
            },
        },
        tenantBilling: {
            authGuards: [],
            notices: { port: sendingPort(), record: noticeRecord() },
            subscriptionEnds: { export: anExport(), deletion: aDeletion() },
        },
        checkoutOffer: {
            checkoutOfferRepository: fakeOfferRepo(),
            planRepository: fakePlanRepo(),
            bundleRepository: fakeBundleRepo(),
        },
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    return { moduleRef, holds, ends };
}

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('an application that composes the platform', () => {
    test('concludes an offer through it that takes a tenant whose subscription ended back', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: RETURN_AT });
        const platform = await aPlatformWithAnEndedTenant();
        try {
            const offers = platform.moduleRef.get(CheckoutOfferService, { strict: false });
            const offer = await offers.create({ planKey: 'STANDARD', billingCycle: 'monthly' });

            await offers.conclude(offer.id, concludedFor(RETURN_AT));

            assert.deepEqual(
                platform.ends.ends.map((end) => end.liftedAt),
                [RETURN_AT],
            );
            assert.deepEqual(
                platform.holds.holds.map((hold) => hold.liftedBy),
                [`checkout-offer:${offer.id}`],
            );
        } finally {
            await platform.moduleRef.close();
        }
    });
});
