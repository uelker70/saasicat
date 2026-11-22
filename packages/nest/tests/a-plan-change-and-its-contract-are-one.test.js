// @requirement SC-CHG-025 — A plan change made at once and its contract are one

// A plan change made at once, and a switch to a newer version made at once,
// end in the contract that records them, or nothing changes. What the contract
// could refuse is asked before anything is written; where the contract still
// cannot be written, the subscription is written back as it was read and the
// change is refused. Left standing, the subscription would name the new plan
// while the contract in force — what entitlements read first and the journal
// charges from — names the old one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { ConflictException } from '@nestjs/common';
import { CONTRACT_ERROR_CODES, NO_SCHEDULED_CHANGE } from '@saasicat/core';

import {
    PlanChangePreviewService,
    SubscriptionContractFreezeService,
    VersionOfferService,
    VersionSwitchService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { tenantBillingRoutes } from './helpers/tenant-billing-routes.js';
import { boundPlanVersion, usageRecord } from './helpers/subscription-fixtures.js';
import { BOUND, NOW, V2, repositoryWith, subscription } from './helpers/version-offers.js';

const DAY_MS = 86_400_000;

const STARTER = {
    id: 'STARTER',
    name: 'Starter',
    tagline: '',
    marketed: true,
    monthlyNet: 19,
    yearlyNet: 190,
    quotas: { users: 3 },
    features: ['CORE'],
};
const STANDARD = { ...STARTER, id: 'STANDARD', name: 'Standard', monthlyNet: 49, yearlyNet: 490 };
const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    plans: [STARTER, STANDARD],
};

const AGREED_AT = new Date('2026-09-01T10:00:00.000Z');

/** A STARTER subscription inside a running month, past due, with a change of rhythm scheduled. */
function starter(overrides = {}) {
    const now = Date.now();
    return usageRecord({
        plan: 'STARTER',
        billingCycle: 'MONTHLY',
        status: 'PAST_DUE',
        currentPeriodStart: new Date(now - 15 * DAY_MS),
        currentPeriodEnd: new Date(now + 16 * DAY_MS),
        billingAnchorDay: 31,
        pendingPlan: 'STARTER',
        pendingBillingCycle: 'YEARLY',
        pendingEffectiveAt: new Date(now + 16 * DAY_MS),
        pendingChangeVersionId: null,
        pendingAgreement: { termsVersion: null, cancellationNoticeDays: 30, agreedAt: AGREED_AT },
        ...overrides,
    });
}

/** What the take-back writes for `read`: the row as it was, its version bound again. */
function takenBackFrom(read) {
    return {
        planId: read.plan,
        cycle: read.billingCycle,
        status: read.status,
        currentPeriodStart: read.currentPeriodStart,
        currentPeriodEnd: read.currentPeriodEnd,
        billingAnchorDay: read.billingAnchorDay,
        pendingPlan: read.pendingPlan,
        pendingBillingCycle: read.pendingBillingCycle,
        pendingEffectiveAt: read.pendingEffectiveAt,
        pendingCancellationNoticeDays: read.pendingAgreement?.cancellationNoticeDays ?? null,
        pendingAgreedAt: read.pendingAgreement?.agreedAt ?? null,
    };
}

/** The facts of a write that say what it puts back. */
function asWritten(input) {
    return {
        planId: input.planId,
        cycle: input.cycle,
        status: input.putsBack?.status,
        currentPeriodStart: input.putsBack?.currentPeriodStart,
        currentPeriodEnd: input.putsBack?.currentPeriodEnd,
        billingAnchorDay: input.putsBack?.billingAnchorDay,
        pendingPlan: input.putsBack?.scheduledChange.pendingPlan,
        pendingBillingCycle: input.putsBack?.scheduledChange.pendingBillingCycle,
        pendingEffectiveAt: input.putsBack?.scheduledChange.pendingEffectiveAt,
        pendingCancellationNoticeDays:
            input.putsBack?.scheduledChange.pendingCancellationNoticeDays,
        pendingAgreedAt: input.putsBack?.scheduledChange.pendingAgreedAt,
    };
}

const refusedWith = (code) => (error) => error.response?.code === code;

/** A store that fails, as a database does: no code, nothing for the tenant to act on. */
const storeDown = () => {
    throw new Error('connection reset');
};

/**
 * A plan change through the tenant route, over `subscription`, with every port
 * it writes to recorded. `freeze` is what writing the contract does.
 */
function theRoute(subscription, { freeze = async () => {}, check = async () => {}, claims } = {}) {
    const calls = {
        immediate: [],
        scheduled: [],
        checked: [],
        frozen: [],
        charged: [],
        audited: [],
        auditEntries: [],
    };
    const writes = {
        async changePlanImmediate(tenantId, input) {
            calls.immediate.push(input);
            const claimed = claims ? claims(calls.immediate.length) : true;
            return { plan: input.planId, billingCycle: input.cycle, claimed };
        },
        async schedulePlanChange(tenantId, input) {
            calls.scheduled.push(input);
            return { claimed: true };
        },
    };
    const entitlements = {
        computeLimits: async () => ({ plan: 'STARTER', quotas: { users: 3 }, features: new Set() }),
        invalidateTenant() {},
    };
    const usage = { findForTenant: async () => subscription };
    const controller = tenantBillingRoutes({
        entitlements,
        planPreview: new PlanChangePreviewService(
            givenPlanCatalogSource(CATALOG),
            entitlements,
            usage,
            { snapshot: async () => ({ users: 1 }) },
        ),
        subscriptionUsage: usage,
        usageSnapshot: { snapshot: async () => ({}) },
        subscriptionWrite: writes,
        tenantIdResolver: () => 't1',
        userIdResolver: () => 'u1',
        auditService: {
            log: async (entry) => {
                calls.audited.push(entry.action);
                calls.auditEntries.push(entry);
            },
        },
        contractFreeze: {
            async assertPartyFor() {},
            async assertContractFor(...args) {
                calls.checked.push(args);
                await check(...args);
            },
            async freezeOnPlanChange(...args) {
                calls.frozen.push(args);
                await freeze(...args);
            },
        },
        charges: {
            async recordDueCharges(tenantId) {
                calls.charged.push(tenantId);
                return [];
            },
        },
    });
    const change = (plan, billingCycle) =>
        controller.changePlan(
            { user: { tenantId: 't1', sub: 'u1' }, headers: {} },
            {
                plan,
                billingCycle,
            },
        );
    return { calls, change };
}

describe('a plan change made at once, whose contract is written', () => {
    test('stands, is charged and recorded, and nothing is taken back', async () => {
        const { calls, change } = theRoute(starter());

        const result = await change('STANDARD', 'MONTHLY');

        assert.equal(result.plan, 'STANDARD');
        assert.equal(calls.immediate.length, 1, 'the change alone was written');
        assert.equal(calls.frozen.length, 1);
        assert.deepEqual(calls.charged, ['t1']);
        assert.ok(calls.audited.includes('CHANGE_PLAN'));
    });

    test('is asked of its whole contract first: the plan, the rhythm, from today', async () => {
        const { calls, change } = theRoute(starter());

        await change('STANDARD', 'YEARLY');

        const [[tenantId, target, intended]] = calls.checked;
        assert.equal(tenantId, 't1');
        assert.deepEqual(target, { plan: 'STANDARD', planVersionId: null });
        assert.deepEqual([intended.cycle, intended.endsAt], ['YEARLY', null]);
        assert.ok(Date.now() - intended.effectiveFrom < 1000, 'from today');
    });
});

describe('a plan change made at once, whose contract is refused before it is written', () => {
    test('is refused with the contract’s reason, and nothing is written', async () => {
        const { calls, change } = theRoute(starter(), {
            check: async () => {
                throw Object.assign(new Error('no subscriber'), {
                    response: { code: 'SUBSCRIBER_REQUIRED' },
                });
            },
        });

        await assert.rejects(change('STANDARD', 'MONTHLY'), refusedWith('SUBSCRIBER_REQUIRED'));

        assert.deepEqual(calls.immediate, [], 'nothing moved');
        assert.deepEqual(calls.frozen, []);
        assert.deepEqual(calls.charged, []);
        assert.ok(!calls.audited.includes('CHANGE_PLAN'));
    });
});

describe('a plan change made at once, whose contract cannot be written after it', () => {
    test('is taken back as it was read, and refused with a code, where the store failed', async () => {
        const read = starter();
        const { calls, change } = theRoute(read, { freeze: storeDown });

        await assert.rejects(
            change('STANDARD', 'MONTHLY'),
            refusedWith('PLAN_CHANGE_CONTRACT_NOT_WRITTEN'),
        );

        assert.equal(calls.immediate.length, 2, 'the change, then its take-back');
        assert.deepEqual(asWritten(calls.immediate[1]), takenBackFrom(read));
        assert.deepEqual(calls.charged, [], 'nothing charged from the contract it left');
        assert.ok(!calls.audited.includes('CHANGE_PLAN'), 'no change recorded that did not happen');
    });

    test('one that opened a period of its own gets the old window and billing day back', async () => {
        const read = starter();
        const { calls, change } = theRoute(read, { freeze: storeDown });

        await assert.rejects(change('STANDARD', 'YEARLY'));

        const [made, takenBack] = calls.immediate;
        assert.ok(made.periodStart, 'the change opened a yearly period');
        assert.equal(made.nextStatus, 'ACTIVE');
        assert.deepEqual(asWritten(takenBack), takenBackFrom(read));
    });

    // @requirement SC-CHG-011 — A decision taken against one state is not written into another
    test('is taken back only over the row as the change left it', async () => {
        const { calls, change } = theRoute(starter(), { freeze: storeDown });

        await assert.rejects(change('STANDARD', 'YEARLY'));

        const [made, takenBack] = calls.immediate;
        assert.deepEqual(takenBack.putsBack.asChanged, {
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
            status: 'ACTIVE',
            currentPeriodStart: made.periodStart,
            currentPeriodEnd: made.periodEnd,
            billingAnchorDay: made.periodStart.getUTCDate(),
            scheduledChange: NO_SCHEDULED_CHANGE,
        });
    });

    test('is refused with the contract’s own code where it refused after the write', async () => {
        const { calls, change } = theRoute(starter(), {
            // Another contract written between the read and each attempt.
            freeze: async () => {
                throw new ConflictException({
                    code: CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_CHANGED,
                });
            },
        });

        await assert.rejects(
            change('STANDARD', 'MONTHLY'),
            refusedWith('SUBSCRIPTION_CONTRACT_CHANGED'),
        );

        assert.equal(calls.immediate.length, 2, 'taken back');
    });

    test('where it cannot be taken back either, it is recorded as made and refused as standing', async () => {
        const { calls, change } = theRoute(starter(), {
            freeze: storeDown,
            claims: (write) => write === 1,
        });

        await assert.rejects(
            change('STANDARD', 'MONTHLY'),
            refusedWith('PLAN_CHANGE_STANDS_WITHOUT_CONTRACT'),
        );

        assert.equal(calls.immediate.length, 2, 'the take-back was tried');
        assert.deepEqual(calls.charged, ['t1'], 'the journal is brought up to date');
        const recorded = calls.auditEntries.filter(({ action }) => action === 'CHANGE_PLAN');
        assert.equal(recorded.length, 1, 'the change in effect is audited once');
        assert.equal(recorded[0].changes.toPlan, 'STANDARD');
        assert.equal(recorded[0].changes.contractWritten, false);
    });
});

describe('a plan change made at once in a trial', () => {
    test('ends in no contract: the party alone is asked, and it is never taken back', async () => {
        const end = new Date(Date.now() + 10 * DAY_MS);
        const { calls, change } = theRoute(starter({ status: 'TRIAL', trialEndsAt: end }), {
            freeze: storeDown,
        });

        await change('STANDARD', 'MONTHLY');

        assert.deepEqual(
            calls.checked.map(([, , intended]) => intended),
            [null],
        );
        assert.deepEqual(calls.frozen, [], 'its contract is frozen when it converts');
        assert.equal(calls.immediate.length, 1);
    });
});

/** The switch to version 2 of STANDARD over tenant t1, its ports recorded. */
function aSwitch({ sub = subscription(), freeze = async () => {}, claims } = {}) {
    const calls = {
        immediate: [],
        checked: [],
        frozen: [],
        charged: [],
        recorded: [],
        audited: [],
    };
    const subscriptions = { findForTenant: async (id) => (id === 't1' ? sub : null) };
    const offers = new VersionOfferService(
        subscriptions,
        repositoryWith([BOUND], V2({ quotas: { users: 5, vehicles: 150 } })),
    );
    const write = {
        changePlanImmediate: async (tenantId, input) => {
            calls.immediate.push(input);
            const claimed = claims ? claims(calls.immediate.length) : true;
            return { plan: input.planId, billingCycle: input.cycle, claimed };
        },
    };
    const contractFreeze = {
        assertPartyFor: async () => {},
        assertContractFor: async (...args) => calls.checked.push(args),
        freezeOnPlanChange: async (...args) => {
            calls.frozen.push(args);
            await freeze(...args);
        },
    };
    const service = new VersionSwitchService(
        offers,
        subscriptions,
        { snapshot: async () => ({}) },
        write,
        { invalidateTenant() {} },
        contractFreeze,
        { recordDueCharges: async (tenantId) => calls.charged.push(tenantId) },
    );
    const recordsWhatStands = async (result) => calls.recorded.push(result);
    const routes = tenantBillingRoutes({
        versionSwitches: service,
        tenantIdResolver: () => 't1',
        userIdResolver: () => 'u1',
        auditService: { log: async (entry) => calls.audited.push(entry) },
    });
    const accept = () =>
        routes.acceptVersionOffer(
            { user: { tenantId: 't1', sub: 'u1' }, headers: {} },
            { planVersionId: 'pv-2' },
        );
    return { calls, take: () => service.take('t1', 'pv-2', NOW, recordsWhatStands), accept };
}

describe('a switch to a newer version made at once', () => {
    test('is asked of its contract at the version offered, before anything is written', async () => {
        const { calls, take } = aSwitch();

        await take();

        const [[, target]] = calls.checked;
        assert.deepEqual(target, { plan: 'STANDARD', planVersionId: 'pv-2' });
        assert.equal(calls.immediate.length, 1);
    });

    test('whose contract cannot be written is put back on the version it left, and refused', async () => {
        const read = subscription({ billingAnchorDay: 1 });
        const { calls, take } = aSwitch({ sub: read, freeze: storeDown });

        await assert.rejects(take(), refusedWith('PLAN_CHANGE_CONTRACT_NOT_WRITTEN'));

        const [, takenBack] = calls.immediate;
        assert.equal(takenBack.quotedPlanVersionId, BOUND.id, 'the version it left');
        assert.equal(takenBack.restoresQuotedVersion, true, 'whether or not it is still on sale');
        assert.equal(
            takenBack.expectedPlanVersionId,
            'pv-2',
            'only while the switch is what stands',
        );
        assert.deepEqual(
            takenBack.putsBack.asChanged,
            {
                plan: read.plan,
                billingCycle: read.billingCycle,
                status: read.status,
                currentPeriodStart: read.currentPeriodStart,
                currentPeriodEnd: read.currentPeriodEnd,
                billingAnchorDay: 1,
                scheduledChange: NO_SCHEDULED_CHANGE,
            },
            'the switch moved the version alone, and cleared what it had scheduled',
        );
        assert.deepEqual(calls.charged, []);
        assert.deepEqual(calls.recorded, [], 'nothing recorded that did not happen');
    });

    test('whose take-back fails as well is recorded as made, charged and refused as standing', async () => {
        const { calls, take } = aSwitch({ freeze: storeDown, claims: (write) => write === 1 });

        await assert.rejects(take(), refusedWith('PLAN_CHANGE_STANDS_WITHOUT_CONTRACT'));

        assert.deepEqual(calls.charged, ['t1']);
        assert.equal(calls.recorded.length, 1, 'recorded once');
        assert.equal(calls.recorded[0].planVersionId, 'pv-2');
        assert.equal(calls.recorded[0].immediate, true);
    });

    test('whose take-back fails as well is audited by the route as a switch made without its contract', async () => {
        const { calls, accept } = aSwitch({ freeze: storeDown, claims: (write) => write === 1 });

        await assert.rejects(accept(), refusedWith('PLAN_CHANGE_STANDS_WITHOUT_CONTRACT'));

        assert.deepEqual(
            calls.audited.map(({ action, changes }) => [
                action,
                changes.toPlanVersionId,
                changes.contractWritten,
            ]),
            [['SWITCH_PLAN_VERSION', 'pv-2', false]],
        );
    });
});

describe('the contract a change made at once is checked against', () => {
    const MONTHLY_ONLY = { ...STARTER, yearlyNet: null };
    const catalog = { ...CATALOG, plans: [MONTHLY_ONLY, STANDARD] };

    function freezeService({ plans } = {}) {
        const calls = { asked: [], written: [] };
        const service = new SubscriptionContractFreezeService(
            givenPlanCatalogSource(catalog),
            {
                invalidateTenant() {},
                async computeContractLimits() {
                    return {
                        limits: { plan: 'STARTER', quotas: {}, features: new Set() },
                        leftOutBundleVersionIds: [],
                    };
                },
            },
            {
                async assertPartyFor(...args) {
                    calls.asked.push(args);
                },
                async writeSuccessor(...args) {
                    calls.written.push(args);
                    return { id: 'c' };
                },
                async findActiveByTenantId() {
                    return null;
                },
            },
            {
                // Bound today: STANDARD, the plan being left.
                findBoundPlanVersion: async () => boundPlanVersion(STANDARD, 'pv-standard'),
                loadBookedBundles: async () => ({ lineItems: [], bundleVersionIds: [] }),
            },
            undefined,
            null,
            null,
            null,
            plans,
        );
        return { calls, service };
    }

    const yearlyFromToday = { effectiveFrom: new Date(), cycle: 'YEARLY', endsAt: null };
    const monthlyFromToday = { ...yearlyFromToday, cycle: 'MONTHLY' };
    const starterVersion = {
        findVersionById: async () => boundPlanVersion(MONTHLY_ONLY, 'pv-starter'),
    };

    test('is composed at the version the change binds, not the one bound now', async () => {
        const { service } = freezeService({ plans: starterVersion });

        await assert.rejects(
            service.assertContractFor(
                't1',
                { plan: 'STARTER', planVersionId: 'pv-starter' },
                yearlyFromToday,
            ),
            (error) => error.response?.code === 'PLAN_NOT_SOLD_IN_CYCLE',
        );
    });

    test('and is written nowhere where it holds', async () => {
        const { calls, service } = freezeService({ plans: starterVersion });

        await service.assertContractFor(
            't1',
            { plan: 'STARTER', planVersionId: 'pv-starter' },
            monthlyFromToday,
        );

        assert.equal(calls.asked.length, 1, 'the party was asked of it');
        assert.deepEqual(calls.written, []);
    });

    test('asks the party alone where no repository reads the version', async () => {
        const { calls, service } = freezeService({ plans: null });

        await service.assertContractFor(
            't1',
            { plan: 'STARTER', planVersionId: 'pv-starter' },
            yearlyFromToday,
        );

        assert.deepEqual(calls.asked, [['t1', yearlyFromToday]]);
    });
});
