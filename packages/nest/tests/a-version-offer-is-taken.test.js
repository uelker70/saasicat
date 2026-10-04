// @requirement SC-SUB-021 — A newer version is taken by naming it, the way its kind says

// Taking a version offer. The offer decides how it is taken — an improvement
// and more for more at once, with the term and the period kept; one that takes
// something away at the end of the term, like a downgrade — and the switch goes
// ahead only while the version the page showed is still the one offered.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
    AcceptVersionOfferDto,
    TenantAdminGuard,
    TenantBillingController,
    VersionOfferService,
    VersionSwitchService,
} from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { GUARDS, bootable } from './helpers/operator-routes.js';
import {
    BOUND,
    NOW,
    PERIOD_END,
    V2,
    repositoryWith,
    subscription,
} from './helpers/version-offers.js';

const IMPROVEMENT = V2({ quotas: { users: 5, vehicles: 150 } });
const MORE_FOR_MORE = V2({ monthlyNet: '59.00', quotas: { users: 8, vehicles: 200 } });
const TAKES_AWAY = V2({ monthlyNet: '45.00', quotas: { users: 3, vehicles: 200 } });

/** The switch over one subscription of tenant t1, with every port it writes to recorded. */
function aSwitch({
    sub = subscription(),
    live = IMPROVEMENT,
    plans = repositoryWith([BOUND], live),
    usage = {},
    claimed = true,
    whileWriting = () => {},
} = {}) {
    const calls = {
        immediate: [],
        scheduled: [],
        invalidated: [],
        asked: [],
        frozen: [],
        charged: [],
    };
    const subscriptions = { findForTenant: async (id) => (id === 't1' ? sub : null) };
    const offers = new VersionOfferService(subscriptions, plans, null);
    const write = {
        changePlanImmediate: async (tenantId, input) => {
            calls.immediate.push(input);
            whileWriting();
            return { plan: input.planId, billingCycle: input.cycle, claimed };
        },
        schedulePlanChange: async (tenantId, input) => {
            calls.scheduled.push(input);
            whileWriting();
            return { claimed };
        },
    };
    const contractFreeze = {
        assertPartyFor: async (...args) => calls.asked.push(args),
        freezeOnPlanChange: async (...args) => calls.frozen.push(args),
    };
    const charges = { recordDueCharges: async (tenantId) => calls.charged.push(tenantId) };
    const service = new VersionSwitchService(
        offers,
        subscriptions,
        { snapshot: async () => usage },
        write,
        { invalidateTenant: (tenantId) => calls.invalidated.push(tenantId) },
        contractFreeze,
        charges,
    );
    return { calls, service, contractFreeze, take: (id = 'pv-2') => service.take('t1', id, NOW) };
}

const refusedWith = (code) => (error) => error.response?.code === code;

describe('an improvement and more for more are taken at once', () => {
    /** The part of the write that says which version is bound, and from which it was decided. */
    const bindingOf = ({
        planId,
        cycle,
        keepsBoundVersion,
        quotedPlanVersionId,
        quotedVersionOnly,
        expectedPlanVersionId,
    }) => ({
        planId,
        cycle,
        keepsBoundVersion,
        quotedPlanVersionId,
        quotedVersionOnly,
        expectedPlanVersionId,
    });
    // The version offered or nothing, and only while the one read is still bound.
    const BINDS_THE_OFFER = {
        planId: 'STANDARD',
        cycle: 'MONTHLY',
        keepsBoundVersion: false,
        quotedPlanVersionId: 'pv-2',
        quotedVersionOnly: true,
        expectedPlanVersionId: 'pv-1',
    };

    test('an improvement binds the version offered on the plan and in the rhythm the subscription has', async () => {
        const { calls, take } = aSwitch({ live: IMPROVEMENT });

        const result = await take();

        assert.deepEqual(result, {
            class: 'improvement',
            fromPlanVersionId: 'pv-1',
            planVersionId: 'pv-2',
            immediate: true,
            takesEffectAt: NOW.toISOString(),
        });
        assert.deepEqual(calls.immediate.map(bindingOf), [BINDS_THE_OFFER]);
        assert.equal(calls.scheduled.length, 0);
    });

    test('more for more is taken the same way', async () => {
        const { calls, take } = aSwitch({ live: MORE_FOR_MORE });

        const result = await take();

        assert.equal(result.class, 'more-for-more');
        assert.equal(result.immediate, true);
        assert.deepEqual(calls.immediate.map(bindingOf), [BINDS_THE_OFFER]);
    });

    test('the term and the period are kept: no window is opened and the status stays', async () => {
        const { calls, take } = aSwitch();
        await take();
        const input = calls.immediate[0];
        assert.equal(input.periodStart, null);
        assert.equal(input.periodEnd, null);
        assert.equal(input.nextStatus, null);
    });

    test('the successor contract is frozen from now and the account brought up to date', async () => {
        const { calls, take } = aSwitch();
        await take();
        assert.deepEqual(calls.frozen, [['t1', 'STANDARD', 'MONTHLY', NOW, null]]);
        assert.deepEqual(calls.charged, ['t1']);
        assert.deepEqual(calls.invalidated, ['t1']);
    });

    test('a subscription cancelled for later is switched, and its contract still ends then', async () => {
        const { calls, take } = aSwitch({
            sub: subscription({ canceledAt: NOW, canceledEffectiveAt: PERIOD_END }),
        });
        await take();
        assert.equal(calls.immediate[0].expectedCanceledAt, NOW);
        assert.deepEqual(calls.frozen[0][4], PERIOD_END);
    });

    test('the party is asked about the contract the switch freezes: from now, in its rhythm, to its end', async () => {
        const { calls, take } = aSwitch({
            sub: subscription({ canceledAt: NOW, canceledEffectiveAt: PERIOD_END }),
        });
        await take();
        const [, , cycle, effectiveFrom, endsAt] = calls.frozen[0];
        assert.deepEqual(calls.asked, [['t1', { effectiveFrom, cycle, endsAt }]]);
    });

    test('in a trial nothing is frozen and nothing charged', async () => {
        const { calls, take } = aSwitch({
            sub: subscription({ status: 'TRIAL', trialEndsAt: PERIOD_END }),
        });
        const result = await take();
        assert.equal(result.immediate, true);
        assert.deepEqual(calls.frozen, []);
        assert.deepEqual(calls.charged, []);
    });
});

describe('one that takes something away is taken at the end of the term', () => {
    test('scheduled for the term end and bound to the version offered', async () => {
        const { calls, take } = aSwitch({ live: TAKES_AWAY, usage: { users: 3 } });

        const result = await take();

        assert.deepEqual(result, {
            class: 'takes-something-away',
            fromPlanVersionId: 'pv-1',
            planVersionId: 'pv-2',
            immediate: false,
            takesEffectAt: PERIOD_END.toISOString(),
        });
        assert.deepEqual(calls.scheduled, [
            {
                pendingPlan: 'STANDARD',
                pendingBillingCycle: 'MONTHLY',
                pendingEffectiveAt: PERIOD_END,
                expectedCanceledAt: null,
                expectedPlanVersionId: 'pv-1',
                expectedPendingPlan: null,
                pendingChangeVersionId: 'pv-2',
            },
        ]);
        assert.equal(calls.immediate.length, 0);
        assert.deepEqual(calls.frozen, [], 'the contract is frozen when the change comes due');
        assert.deepEqual(calls.invalidated, ['t1']);
    });

    test('the party is asked about the contract that runs from the term end', async () => {
        const { calls, take } = aSwitch({ live: TAKES_AWAY, usage: { users: 3 } });
        await take();
        assert.deepEqual(calls.asked, [
            ['t1', { effectiveFrom: PERIOD_END, cycle: 'MONTHLY', endsAt: null }],
        ]);
    });

    test('usage up to the lower quota fits', async () => {
        const { calls, take } = aSwitch({ live: TAKES_AWAY, usage: { users: 3, vehicles: 200 } });
        await take();
        assert.equal(calls.scheduled.length, 1);
    });

    test('usage one above the lower quota is refused like a downgrade, with the numbers', async () => {
        const { calls, take } = aSwitch({ live: TAKES_AWAY, usage: { users: 4 } });

        await assert.rejects(take(), (error) => {
            assert.equal(error.getStatus(), 400);
            assert.equal(error.response.code, 'PLAN_CHANGE_BLOCKED');
            assert.deepEqual(error.response.blockers, [
                {
                    code: 'QUOTA_OVER_TARGET',
                    message:
                        'Current usage 4 exceeds the target limit 3 (users) in the STANDARD plan. Please reduce usage first.',
                    params: { used: '4', targetMax: 3, quotaKey: 'users', planName: 'STANDARD' },
                },
            ]);
            return true;
        });
        assert.equal(calls.scheduled.length, 0);
    });

    test('a quota the version offered no longer carries allows nothing', async () => {
        const dropped = V2({ quotas: { users: 5 } });
        const { take } = aSwitch({ live: dropped, usage: { users: 5, vehicles: 1 } });
        await assert.rejects(take(), refusedWith('PLAN_CHANGE_BLOCKED'));
    });

    test('an unlimited quota holds any usage', async () => {
        const unlimited = V2({ features: ['DASHBOARD'], quotas: { users: -1, vehicles: 100 } });
        const { calls, take } = aSwitch({ live: unlimited, usage: { users: 1000 } });
        await take();
        assert.equal(calls.scheduled.length, 1);
    });

    test('refused while the cancellation lands at the term end, since it would never happen', async () => {
        const { calls, take } = aSwitch({
            live: TAKES_AWAY,
            sub: subscription({ canceledAt: NOW, canceledEffectiveAt: PERIOD_END }),
        });
        await assert.rejects(take(), (error) => {
            assert.equal(error.response.code, 'VERSION_SWITCH_AFTER_CANCELLATION');
            assert.deepEqual(error.response.params, {
                canceledEffectiveAt: PERIOD_END.toISOString(),
                takesEffectAt: PERIOD_END.toISOString(),
            });
            return true;
        });
        assert.equal(calls.scheduled.length, 0);
    });

    test('refused where the version offered stops being sold at the term end', async () => {
        const ending = V2({ ...TAKES_AWAY, id: 'pv-2', endsAt: PERIOD_END.toISOString() });
        const { calls, take } = aSwitch({ live: ending, usage: { users: 3 } });
        await assert.rejects(take(), (error) => {
            assert.equal(error.response.code, 'VERSION_ENDS_BEFORE_SWITCH');
            assert.deepEqual(error.response.params, {
                takesEffectAt: PERIOD_END.toISOString(),
                validUntil: null,
                endsAt: PERIOD_END.toISOString(),
            });
            return true;
        });
        assert.equal(calls.scheduled.length, 0);
    });

    test('taken where it is ended a moment after the term end', async () => {
        const later = new Date(PERIOD_END.getTime() + 1).toISOString();
        const ending = V2({ ...TAKES_AWAY, id: 'pv-2', endsAt: later });
        const { calls, take } = aSwitch({ live: ending, usage: { users: 3 } });
        await take();
        assert.equal(calls.scheduled.length, 1);
    });

    test('refused where its window closes the day before the term end, taken where it closes that day', async () => {
        const closesBefore = V2({ ...TAKES_AWAY, id: 'pv-2', validUntil: '2026-12-31' });
        const closesThatDay = V2({ ...TAKES_AWAY, id: 'pv-2', validUntil: '2027-01-01' });
        await assert.rejects(
            aSwitch({ live: closesBefore, usage: { users: 3 } }).take(),
            refusedWith('VERSION_ENDS_BEFORE_SWITCH'),
        );
        const { calls, take } = aSwitch({ live: closesThatDay, usage: { users: 3 } });
        await take();
        assert.equal(calls.scheduled.length, 1);
    });

    test('taken where the cancellation lands after the term end', async () => {
        const later = new Date(PERIOD_END.getTime() + 1);
        const { calls, take } = aSwitch({
            live: TAKES_AWAY,
            sub: subscription({ canceledAt: NOW, canceledEffectiveAt: later }),
        });
        await take();
        assert.equal(calls.scheduled[0].expectedCanceledAt, NOW);
    });
});

describe('the switch goes ahead only while the version shown is still the offer', () => {
    test('another version named is refused, carrying the offer as it stands', async () => {
        const { calls, take } = aSwitch();
        await assert.rejects(take('pv-3'), (error) => {
            assert.equal(error.getStatus(), 409);
            assert.equal(error.response.code, 'VERSION_OFFER_CHANGED');
            assert.equal(error.response.offer.offered.planVersionId, 'pv-2');
            return true;
        });
        assert.equal(calls.immediate.length + calls.scheduled.length, 0);
    });

    test('no offer at all is refused the same way, carrying none', async () => {
        const { take } = aSwitch({ live: BOUND });
        await assert.rejects(take(), (error) => {
            assert.equal(error.response.code, 'VERSION_OFFER_CHANGED');
            assert.equal(error.response.offer, null);
            return true;
        });
    });

    test('a subscription that moved before an immediate switch was written is told to reload', async () => {
        const { take } = aSwitch({ live: IMPROVEMENT, claimed: false });
        await assert.rejects(take(), refusedWith('SUBSCRIPTION_CHANGED'));
    });

    test('a version no longer offered when the write came is answered with the offer as it stands', async () => {
        // Published between the read and the write: the store bound nothing,
        // and the version named is no longer the one offered.
        let live = IMPROVEMENT;
        const plans = {
            findVersionById: async (id) => (id === BOUND.id ? BOUND : null),
            findActivePlanVersion: async () => live,
        };
        const { take } = aSwitch({
            plans,
            claimed: false,
            whileWriting: () => {
                live = V2({ id: 'pv-3', version: 3, quotas: { users: 5, vehicles: 300 } });
            },
        });
        await assert.rejects(take(), (error) => {
            assert.equal(error.response.code, 'VERSION_OFFER_CHANGED');
            assert.equal(error.response.offer.offered.planVersionId, 'pv-3');
            return true;
        });
    });

    test('and so is one that moved before a switch at the term end was recorded', async () => {
        const { take } = aSwitch({ live: TAKES_AWAY, claimed: false });
        await assert.rejects(take(), refusedWith('SUBSCRIPTION_CHANGED'));
    });

    test('a tenant with no subscription is told so', async () => {
        const { service } = aSwitch();
        await assert.rejects(
            service.take('t-unknown', 'pv-2', NOW),
            refusedWith('SUBSCRIPTION_NOT_FOUND'),
        );
    });

    test('a tenant the contract freeze cannot name is refused before anything moves', async () => {
        const { calls, contractFreeze, take } = aSwitch();
        contractFreeze.assertPartyFor = async () => {
            throw new Error('no subscriber');
        };
        await assert.rejects(take(), /no subscriber/);
        assert.equal(calls.immediate.length, 0);
    });
});

describe('POST billing/version-offer/accept', () => {
    const refusedFields = (body) =>
        validateSync(plainToInstance(AcceptVersionOfferDto, body), {
            whitelist: true,
            forbidUnknownValues: true,
        }).map((error) => error.property);

    test('names the version shown, and nothing else is needed', () => {
        assert.deepEqual(refusedFields({ planVersionId: 'pv-2' }), []);
    });

    test('a missing, empty or non-text version is refused', () => {
        assert.deepEqual(refusedFields({}), ['planVersionId']);
        assert.deepEqual(refusedFields({ planVersionId: '' }), ['planVersionId']);
        assert.deepEqual(refusedFields({ planVersionId: 2 }), ['planVersionId']);
    });

    test('asks for the tenant administrator', () => {
        const guards =
            Reflect.getMetadata(GUARDS, TenantBillingController.prototype.acceptVersionOffer) ?? [];
        assert.ok(guards.includes(TenantAdminGuard));
    });

    test("switches the caller's own tenant and records who did it", async () => {
        const options = bootable();
        const { catalog } = options.persistence;
        const reads = {
            ...repositoryWith([BOUND], IMPROVEMENT),
            findActivePlanVersion: async () => IMPROVEMENT,
        };
        const planRepository = new Proxy(reads, {
            get: (target, key) => (key in target ? target[key] : catalog.planRepository[key]),
        });
        const written = [];
        const audited = [];
        const core = {
            ...options.persistence.core,
            audit: { write: async (entry) => audited.push(entry) },
        };
        // Without a contract freeze and a journal: what those do after a switch
        // is the service's part, above. This is about who is switched.
        const tenantBilling = {
            ...options.tenantBilling,
            contractFreeze: undefined,
            chargeJournal: undefined,
            subscriptionUsagePort: {
                findForTenant: async (tenantId) => (tenantId === 't1' ? subscription() : null),
            },
            subscriptionWritePort: {
                changePlanImmediate: async (tenantId, input) => {
                    written.push([tenantId, input.quotedPlanVersionId]);
                    return { plan: input.planId, billingCycle: input.cycle, claimed: true };
                },
            },
        };
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    ...options,
                    persistence: {
                        ...options.persistence,
                        core,
                        catalog: { ...catalog, planRepository },
                    },
                    tenantBilling,
                }),
            ],
        }).compile();
        const controller = moduleRef.get(TenantBillingController, { strict: false });

        const result = await controller.acceptVersionOffer(
            {
                user: { tenantId: 't1', sub: 'u1', email: 'admin@t1.test' },
                query: { tenantId: 't2' },
            },
            { planVersionId: 'pv-2' },
        );

        assert.equal(result.planVersionId, 'pv-2');
        assert.deepEqual(written, [['t1', 'pv-2']]);
        assert.equal(audited.length, 1);
        assert.equal(audited[0].action, 'SWITCH_PLAN_VERSION');
        assert.equal(audited[0].entityId, 't1');
        assert.equal(audited[0].actor.userId, 'u1');
        const { offerClass, fromPlanVersionId, toPlanVersionId, takesEffectAt } =
            audited[0].changes;
        assert.deepEqual(
            { offerClass, fromPlanVersionId, toPlanVersionId, takesEffectAt },
            {
                offerClass: 'improvement',
                fromPlanVersionId: 'pv-1',
                toPlanVersionId: 'pv-2',
                takesEffectAt: result.takesEffectAt,
            },
        );
    });
});
