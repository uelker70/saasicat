// A retirement takes effect: the subscriptions it reached move to the
// replacement at the date they were told, a subscriber may switch before that
// date at the price they had, a version subscriptions still move onto cannot
// end first, and the operator sees how far each retirement has come.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { scheduledChangeAfterWrite } from '@saasicat/core';

import {
    RetirementMoveService,
    RetirementSwitchService,
    VersionNoticeCron,
} from '../dist/billing/index.js';
import { PlanVersionsService } from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';
import {
    DATE,
    REPLACEMENT_SIDE,
    noticeFor,
    retirementServiceOver,
    subscriptionOf,
    tenantOf,
    deliveredAllBut,
    recorded,
    told,
    usageOver,
} from './helpers/retirement-fixtures.js';

const DAY = 24 * 60 * 60 * 1000;
const BEFORE = new Date('2026-03-20T10:00:00.000Z');
/**
 * The two ways the version retired is off sale, as `writesOver` takes them: a
 * successor closed its window, which leaves it bookable for what was quoted at
 * it, or its own end did, which leaves it bookable for nothing.
 */
const OFF_SALE = [
    ['was closed by a successor', []],
    ['has ended', ['pv-1']],
];

/**
 * A write that claims the row where `claims` says so, and then binds what was
 * asked — the plan and the version quoted — and leaves of the scheduled change
 * what the shared rule says, as an adapter does. A version in `ended` takes no
 * bookings: asked for alone, it is bound only where the write puts a binding
 * back (`restoresQuotedVersion`), as the port says.
 */
function writesOver(subs, claims = () => true, ended = []) {
    const calls = [];
    return {
        calls,
        async changePlanImmediate(tenantId, input) {
            calls.push({ tenantId, input });
            const refused =
                input.quotedVersionOnly &&
                ended.includes(input.quotedPlanVersionId) &&
                !input.restoresQuotedVersion;
            const claimed = !refused && claims(tenantId, input);
            const sub = subs.find((candidate) => tenantOf(candidate) === tenantId);
            if (claimed && sub) {
                Object.assign(sub, scheduledChangeAfterWrite(sub, input));
                sub.plan = input.planId;
                sub.planVersion = { id: input.quotedPlanVersionId, planId: input.planId };
            }
            return { plan: input.planId, billingCycle: input.cycle, claimed };
        },
    };
}

/** The parts a move and a switch write through, each recording what it was asked. */
function sideEffects({ party = async () => {}, freeze = async () => {} } = {}) {
    const frozen = [];
    const recorded = [];
    const invalidated = [];
    const audited = [];
    return {
        frozen,
        recorded,
        invalidated,
        audited,
        contractFreeze: {
            assertPartyFor: party,
            async freezeOnPlanChange(...args) {
                frozen.push(args);
                return freeze(...args);
            },
        },
        charges: {
            async recordDueCharges(tenantId) {
                recorded.push(tenantId);
                return [];
            },
        },
        entitlements: { invalidateTenant: (tenantId) => invalidated.push(tenantId) },
        audit: { log: async (entry) => audited.push(entry) },
    };
}

/** The run over `subs`, told `notices`, every part in memory. */
async function aRun({
    subs = [subscriptionOf('t1')],
    notices = [noticeFor('t1')],
    claims,
    party,
    freeze,
    bypass = null,
    ended,
    delivered = true,
} = {}) {
    const effects = sideEffects({ party, freeze });
    const writes = writesOver(subs, claims, ended);
    const service = new RetirementMoveService(
        usageOver(subs),
        await (delivered ? told : recorded)(...notices),
        writes,
        effects.entitlements,
        bypass,
        effects.contractFreeze,
        effects.charges,
        effects.audit,
    );
    return { service, writes, subs, ...effects };
}

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('expected a refusal');
}

// @requirement SC-SUB-031 — A subscription continues on the replacement at the date it was told
describe('the move at the date', () => {
    test('moves a subscription still on the version retired, keeping its term and what it scheduled', async () => {
        const { service, writes, frozen, recorded, invalidated } = await aRun();

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 1, failed: 0 });
        assert.deepEqual(writes.calls, [
            {
                tenantId: 't1',
                input: {
                    planId: 'PLUS',
                    cycle: 'MONTHLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                    expectedCanceledAt: null,
                    expectedPlanVersionId: 'pv-1',
                    keepsBoundVersion: false,
                    quotedPlanVersionId: 'pv-9',
                    quotedVersionOnly: true,
                    keepsPendingChange: true,
                },
            },
        ]);
        assert.deepEqual(frozen, [
            ['t1', 'PLUS', 'MONTHLY', DATE, null, { retirementId: 'ret-1' }],
        ]);
        assert.deepEqual(recorded, ['t1']);
        assert.deepEqual(invalidated, ['t1']);
    });

    test('records the move under the platform job, naming both versions', async () => {
        const { service, audited } = await aRun();

        await service.moveDue(DATE);

        assert.equal(audited.length, 1);
        const [entry] = audited;
        assert.deepEqual(entry.actor, {
            userId: null,
            email: 'platform',
            source: 'job',
            context: 'retirement-moves',
        });
        assert.equal(entry.action, 'PLAN_VERSION_RETIREMENT_MOVE');
        assert.equal(entry.entityId, 'sub-t1');
        assert.deepEqual(entry.changes, {
            tenantId: 't1',
            retirementId: 'ret-1',
            fromPlanVersionId: 'pv-1',
            toPlanVersionId: 'pv-9',
            effectiveAt: DATE.toISOString(),
        });
    });

    test('moves nothing before the date, and catches up a run that did not happen', async () => {
        const early = await aRun();
        const late = await aRun();

        const beforeIt = await early.service.moveDue(new Date(DATE.getTime() - 1));
        const weeksLater = await late.service.moveDue(new Date(DATE.getTime() + 40 * DAY));

        assert.deepEqual(beforeIt, { moved: 0, failed: 0 });
        assert.equal(early.writes.calls.length, 0);
        assert.equal(weeksLater.moved, 1);
    });

    test('leaves a subscription that has ended by its date, and moves one that ends after it', async () => {
        const endedAtTheDate = subscriptionOf('t1', {
            canceledAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledEffectiveAt: DATE,
        });
        const endsAfter = subscriptionOf('t2', {
            canceledAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date(DATE.getTime() + 1),
        });
        const { service, writes, frozen } = await aRun({
            subs: [endedAtTheDate, endsAfter],
            notices: [noticeFor('t1'), noticeFor('t2')],
        });

        const run = await service.moveDue(DATE);

        assert.equal(run.moved, 1);
        assert.deepEqual(
            writes.calls.map((call) => call.tenantId),
            ['t2'],
        );
        // The contract it writes still ends when the subscription does.
        assert.deepEqual(frozen[0][4], new Date(DATE.getTime() + 1));
    });

    test('leaves a subscription whose own change takes it off the version by its date', async () => {
        const ownChangeAtTheDate = subscriptionOf('t1', {
            pendingPlan: 'SMALL',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: DATE,
        });
        const ownChangeAfter = subscriptionOf('t2', {
            pendingPlan: 'SMALL',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: new Date(DATE.getTime() + 1),
        });
        const { service, writes } = await aRun({
            subs: [ownChangeAtTheDate, ownChangeAfter],
            notices: [noticeFor('t1'), noticeFor('t2')],
        });

        await service.moveDue(DATE);

        assert.deepEqual(
            writes.calls.map((call) => [call.tenantId, call.input.keepsPendingChange]),
            [['t2', true]],
        );
    });

    test('moves a trial without a contract or a charge: both come when it converts', async () => {
        const { service, writes, frozen, recorded } = await aRun({
            subs: [subscriptionOf('t1', { status: 'TRIAL' })],
        });

        await service.moveDue(DATE);

        assert.equal(writes.calls.length, 1);
        assert.deepEqual(frozen, []);
        assert.deepEqual(recorded, []);
    });

    test('a subscription that changed between the read and the write is left to the next run', async () => {
        const subs = [subscriptionOf('t1')];
        const { service, audited } = await aRun({
            subs,
            claims: () => {
                subs[0].pendingPlan = 'SMALL';
                return false;
            },
        });

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 0, failed: 0 });
        assert.deepEqual(audited, []);
    });

    test('a replacement the write refuses is a failure, recorded once however often it is tried', async () => {
        const { service, audited } = await aRun({ claims: () => false });

        const first = await service.moveDue(DATE);
        const second = await service.moveDue(new Date(DATE.getTime() + 15 * 60 * 1000));

        assert.equal(first.failed, 1);
        assert.equal(second.failed, 1);
        assert.deepEqual(
            audited.map((entry) => [entry.action, entry.changes.reason]),
            [['PLAN_VERSION_RETIREMENT_MOVE_FAILED', 'replacement-not-bookable']],
        );
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('moves nothing whose notice has reached nobody, however late it is', async () => {
        const { service, writes } = await aRun({ delivered: false });

        const run = await service.moveDue(new Date(DATE.getTime() + 40 * DAY));

        assert.deepEqual(run, { moved: 0, failed: 0 });
        assert.equal(writes.calls.length, 0);
    });

    test('a tenant without a subscriber to name is not moved at all', async () => {
        const { service, writes, audited } = await aRun({
            party: async () => {
                throw new Error('SUBSCRIBER_REQUIRED');
            },
        });

        const run = await service.moveDue(DATE);

        assert.equal(run.failed, 1);
        assert.equal(writes.calls.length, 0);
        assert.equal(audited[0].changes.reason, 'no-party');
    });

    for (const [offSale, ended] of OFF_SALE) {
        test(`a move whose contract cannot be written is put back, and the next run makes both, where the version retired ${offSale}`, async () => {
            let fails = true;
            const subs = [subscriptionOf('t1')];
            const { service, writes, frozen, recorded, audited } = await aRun({
                subs,
                ended,
                freeze: async () => {
                    if (fails) throw new Error('database gone');
                },
            });

            const first = await service.moveDue(DATE);
            const afterFirst = subs[0].planVersion.id;
            fails = false;
            const second = await service.moveDue(new Date(DATE.getTime() + 15 * 60 * 1000));

            assert.deepEqual(first, { moved: 0, failed: 1 });
            assert.equal(afterFirst, 'pv-1', 'put back on the version retired');
            assert.deepEqual(second, { moved: 1, failed: 0 });
            assert.equal(subs[0].planVersion.id, 'pv-9');
            assert.deepEqual(
                writes.calls.map(({ input }) => [
                    input.expectedPlanVersionId,
                    input.quotedPlanVersionId,
                ]),
                [
                    ['pv-1', 'pv-9'],
                    ['pv-9', 'pv-1'],
                    ['pv-1', 'pv-9'],
                ],
            );
            assert.equal(frozen.length, 2);
            assert.deepEqual(recorded, ['t1'], 'charged once, after the move that held');
            assert.deepEqual(
                audited.map(({ action, changes }) => [
                    action,
                    changes.reason ?? null,
                    changes.putBack ?? null,
                ]),
                [
                    ['PLAN_VERSION_RETIREMENT_MOVE_FAILED', 'contract-not-written', true],
                    ['PLAN_VERSION_RETIREMENT_MOVE', null, null],
                ],
            );
        });
    }

    test('a move put back takes the change of rhythm it scheduled back to the plan it left', async () => {
        const sub = subscriptionOf('t1', {
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        let whileMoved = null;
        const { service } = await aRun({
            subs: [sub],
            freeze: async () => {
                whileMoved = sub.pendingPlan;
                throw new Error('database gone');
            },
        });

        await service.moveDue(DATE);

        assert.equal(whileMoved, 'PLUS', 'moved, the change of rhythm followed it to PLUS');
        assert.equal(sub.planVersion.id, 'pv-1', 'put back');
        assert.deepEqual([sub.pendingPlan, sub.pendingBillingCycle], ['STANDARD', 'YEARLY']);
    });

    test('a put-back that fails outright is recorded as one refused, and the run goes on', async () => {
        const { service, audited } = await aRun({
            subs: [subscriptionOf('t1'), subscriptionOf('t2')],
            notices: [noticeFor('t1'), noticeFor('t2')],
            claims: (tenantId, input) => {
                if (input.restoresQuotedVersion) throw new Error('database gone');
                return true;
            },
            freeze: async (tenantId) => {
                if (tenantId === 't1') throw new Error('database gone');
            },
        });

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 1, failed: 1 });
        assert.deepEqual(
            audited.map(({ entityId, action, changes }) => [
                entityId,
                action,
                changes.putBack ?? null,
            ]),
            [
                ['sub-t1', 'PLAN_VERSION_RETIREMENT_MOVE_FAILED', false],
                ['sub-t2', 'PLAN_VERSION_RETIREMENT_MOVE', null],
            ],
        );
    });

    test('a move that cannot be put back either says so in the audit log', async () => {
        let writes = 0;
        const { service, audited } = await aRun({
            claims: () => (writes += 1) === 1,
            freeze: async () => {
                throw new Error('database gone');
            },
        });

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 0, failed: 1 });
        assert.equal(audited[0].changes.putBack, false);
    });

    test('a change of rhythm scheduled between the read and the write is left to the next run', async () => {
        const subs = [subscriptionOf('t1')];
        const { service, audited } = await aRun({
            subs,
            claims: () => {
                subs[0].pendingBillingCycle = 'YEARLY';
                return false;
            },
        });

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 0, failed: 0 });
        assert.deepEqual(audited, []);
    });

    test('a subscription already on the replacement is left alone', async () => {
        const subs = [
            subscriptionOf('t1', { plan: 'PLUS', planVersion: { id: 'pv-9', planId: 'PLUS' } }),
        ];
        const { service, writes, frozen } = await aRun({ subs });

        const run = await service.moveDue(DATE);

        assert.deepEqual(run, { moved: 0, failed: 0 });
        assert.equal(writes.calls.length + frozen.length, 0);
    });

    test('runs across tenants: the write is made inside the bypass', async () => {
        let depth = 0;
        const inside = [];
        const bypass = {
            async runWithBypass(work) {
                depth += 1;
                try {
                    return await work();
                } finally {
                    depth -= 1;
                }
            },
        };
        const { service } = await aRun({
            bypass,
            claims: () => {
                inside.push(depth > 0);
                return true;
            },
        });

        await service.moveDue(DATE);

        assert.deepEqual(inside, [true]);
    });

    test('the quarter-hour run moves what is due after the notices, and pauses under maintenance', async () => {
        const calls = [];
        const notices = { sendDue: async () => (calls.push('notices'), { told: 0, failed: 0 }) };
        const retirements = {
            sendUndelivered: async () => (calls.push('retirement notices'), { told: 0, failed: 0 }),
        };
        const moves = {
            moveDue: async () => (calls.push('moves'), { moved: 0, failed: 0 }),
        };
        const running = new VersionNoticeCron(notices, null, retirements, moves);
        const locked = new VersionNoticeCron(
            notices,
            { isLocked: async () => true },
            retirements,
            moves,
        );

        await running.sendDueNotices();
        await locked.sendDueNotices();

        assert.deepEqual(calls, ['notices', 'retirement notices', 'moves']);
    });
});

/** The switch over `sub`, with the retirement pending until DATE. */
function aSwitch({
    sub = subscriptionOf('t1'),
    notice = noticeFor('t1'),
    claims,
    party,
    freeze,
    blockedPlans = null,
    ended,
} = {}) {
    const effects = sideEffects({ party, freeze });
    const subs = [sub];
    const writes = writesOver(subs, claims, ended);
    const retirements = {
        async pendingFor(subscription, now) {
            return subscription.planVersion?.id === notice.retired.planVersionId &&
                new Date(notice.effectiveAt) > now
                ? notice
                : null;
        },
    };
    const service = new RetirementSwitchService(
        retirements,
        usageOver(subs),
        writes,
        effects.entitlements,
        blockedPlans,
        effects.contractFreeze,
        effects.charges,
    );
    return { service, writes, sub, ...effects };
}

// @requirement SC-SUB-032 — A subscriber may switch to the replacement early, at no more than they paid
describe('the free switch before the date', () => {
    test('moves at once, keeps the term, and holds the price until the date where the replacement costs more', async () => {
        const { service, writes, frozen, recorded } = aSwitch();

        const result = await service.switchNow('t1', 'pv-9', BEFORE);

        assert.deepEqual(result, {
            fromPlanVersionId: 'pv-1',
            planVersionId: 'pv-9',
            heldUntilDay: '2026-06-30',
        });
        assert.deepEqual(writes.calls[0].input, {
            planId: 'PLUS',
            cycle: 'MONTHLY',
            periodStart: null,
            periodEnd: null,
            nextStatus: null,
            expectedCanceledAt: null,
            expectedPlanVersionId: 'pv-1',
            keepsBoundVersion: false,
            quotedPlanVersionId: 'pv-9',
            quotedVersionOnly: true,
        });
        assert.deepEqual(frozen, [
            [
                't1',
                'PLUS',
                'MONTHLY',
                BEFORE,
                null,
                {
                    retirementId: 'ret-1',
                    priceHold: { amountNet: 3, until: DATE, lastDay: '2026-06-30' },
                },
            ],
        ]);
        assert.deepEqual(recorded, ['t1']);
    });

    test('holds the difference of the subscriber’s own rhythm', async () => {
        const { service, frozen } = aSwitch({
            sub: subscriptionOf('t1', { billingCycle: 'YEARLY' }),
        });

        await service.switchNow('t1', 'pv-9', BEFORE);

        assert.equal(frozen[0][2], 'YEARLY');
        assert.equal(frozen[0][5].priceHold.amountNet, 30);
    });

    test('holds nothing where the replacement costs the same or less', async () => {
        for (const monthlyNet of [49, 45]) {
            const notice = noticeFor('t1', {
                replacement: { ...REPLACEMENT_SIDE, monthlyNet },
            });
            const { service, frozen } = aSwitch({ notice });

            const result = await service.switchNow('t1', 'pv-9', BEFORE);

            assert.equal(result.heldUntilDay, null, `at ${monthlyNet}`);
            assert.equal(frozen[0][5].priceHold, null, `at ${monthlyNet}`);
        }
    });

    test('is refused where no retirement waits for its date', async () => {
        const { service, writes } = aSwitch();

        const error = await rejection(service.switchNow('t1', 'pv-9', DATE));

        assert.equal(error.getResponse().code, 'RETIREMENT_SWITCH_NOT_PENDING');
        assert.equal(writes.calls.length, 0);
    });

    test('is refused, with the retirement as it stands, where the page named another version', async () => {
        const { service } = aSwitch();

        const error = await rejection(service.switchNow('t1', 'pv-8', BEFORE));

        assert.equal(error.getStatus(), 409);
        assert.equal(error.getResponse().code, 'RETIREMENT_SWITCH_CHANGED');
        assert.equal(error.getResponse().retirement.replacement.planVersionId, 'pv-9');
    });

    test('opens only after the trial', async () => {
        const { service, writes } = aSwitch({ sub: subscriptionOf('t1', { status: 'TRIAL' }) });

        const error = await rejection(service.switchNow('t1', 'pv-9', BEFORE));

        assert.equal(error.getResponse().code, 'RETIREMENT_SWITCH_IN_TRIAL');
        assert.equal(writes.calls.length, 0);
    });

    test('is refused while something is outstanding, as a version offer is', async () => {
        const cases = [
            ['a change scheduled', { sub: subscriptionOf('t1', { pendingPlan: 'STANDARD' }) }],
            [
                'an ended subscription',
                {
                    sub: subscriptionOf('t1', {
                        canceledAt: new Date('2026-03-01T00:00:00.000Z'),
                        canceledEffectiveAt: new Date('2026-03-19T00:00:00.000Z'),
                    }),
                },
            ],
            [
                'a plan held for a special contract',
                { blockedPlans: { asSource: ['STANDARD'], asTarget: [] } },
            ],
            ['a replacement held for one', { blockedPlans: { asSource: [], asTarget: ['PLUS'] } }],
            [
                'a replacement with no price in the rhythm',
                {
                    sub: subscriptionOf('t1', { billingCycle: 'YEARLY' }),
                    notice: noticeFor('t1', {
                        replacement: { ...REPLACEMENT_SIDE, yearlyNet: null },
                    }),
                },
            ],
        ];
        for (const [name, options] of cases) {
            const { service, writes } = aSwitch(options);

            const error = await rejection(service.switchNow('t1', 'pv-9', BEFORE));

            assert.equal(error.getResponse().code, 'RETIREMENT_SWITCH_NOT_OPEN', name);
            assert.equal(writes.calls.length, 0, name);
        }
    });

    test('is refused where the subscription changed between the read and the write', async () => {
        const { service, frozen } = aSwitch({ claims: () => false });

        const error = await rejection(service.switchNow('t1', 'pv-9', BEFORE));

        assert.equal(error.getResponse().code, 'SUBSCRIPTION_CHANGED');
        assert.deepEqual(frozen, []);
    });

    for (const [offSale, ended] of OFF_SALE) {
        test(`whose contract cannot be written is put back and refused, and nothing is charged, where the version retired ${offSale}`, async () => {
            const { service, writes, recorded, sub } = aSwitch({
                ended,
                freeze: async () => {
                    throw new Error('database gone');
                },
            });

            await rejection(service.switchNow('t1', 'pv-9', BEFORE));

            assert.deepEqual(
                writes.calls.map(({ input }) => [
                    input.expectedPlanVersionId,
                    input.quotedPlanVersionId,
                ]),
                [
                    ['pv-1', 'pv-9'],
                    ['pv-9', 'pv-1'],
                ],
            );
            assert.equal(sub.planVersion.id, 'pv-1');
            assert.deepEqual(recorded, []);
        });
    }

    test('that is put back keeps a change scheduled while its contract was being written', async () => {
        const sub = subscriptionOf('t1');
        const { service } = aSwitch({
            sub,
            freeze: async () => {
                // Another request of the tenant schedules a change of rhythm
                // on the replacement it now sees.
                Object.assign(sub, {
                    pendingPlan: 'PLUS',
                    pendingBillingCycle: 'YEARLY',
                    pendingEffectiveAt: new Date('2026-07-01T00:00:00.000Z'),
                });
                throw new Error('database gone');
            },
        });

        await rejection(service.switchNow('t1', 'pv-9', BEFORE));

        assert.equal(sub.planVersion.id, 'pv-1', 'put back');
        assert.deepEqual(
            [sub.pendingPlan, sub.pendingBillingCycle],
            ['STANDARD', 'YEARLY'],
            'the change scheduled meanwhile survives, on the plan it is back on',
        );
    });

    test('that cannot be put back either says so in the log, naming the subscription', async () => {
        let writes = 0;
        const { service, sub } = aSwitch({
            claims: () => (writes += 1) === 1,
            freeze: async () => {
                throw new Error('database gone');
            },
        });
        const logged = [];
        const original = Logger.prototype.error;
        Logger.prototype.error = function (message) {
            logged.push(String(message));
        };
        try {
            await rejection(service.switchNow('t1', 'pv-9', BEFORE));
        } finally {
            Logger.prototype.error = original;
        }

        assert.equal(sub.planVersion.id, 'pv-9', 'left on the replacement');
        assert.ok(
            logged.some(
                (line) => line.includes('sub-t1') && line.includes('could not be put back'),
            ),
            logged.join('\n'),
        );
    });

    test('is refused before anything moves where the contract could not name its party', async () => {
        const { service, writes } = aSwitch({
            party: async () => {
                throw new Error('SUBSCRIBER_REQUIRED');
            },
        });

        await rejection(service.switchNow('t1', 'pv-9', BEFORE));

        assert.equal(writes.calls.length, 0);
    });

    test('is offered with its terms where it is open, and not otherwise', async () => {
        const open = aSwitch();
        const inATrial = aSwitch({ sub: subscriptionOf('t1', { status: 'TRIAL' }) });

        const offered = await open.service.openFor(open.sub, BEFORE);
        const notOffered = await inATrial.service.openFor(inATrial.sub, BEFORE);

        assert.deepEqual(offered.terms, {
            priceNet: 52,
            held: { priceNet: 49, amountNet: 3, lastDay: '2026-06-30' },
        });
        assert.equal(notOffered, null);
    });
});

/** The retirement service over `subs`, told `notices`. */
/** The retirement service over `subs`, told `notices` and with `untold` recorded beside them, undelivered. */
async function announced({ subs, notices, untold = [] }) {
    const record = deliveredAllBut(
        await recorded(...notices, ...untold),
        untold.map((notice) => notice.subscriptionId),
    );
    return retirementServiceOver({ subs, record });
}

// @requirement SC-PLAN-029 — A version subscriptions still move onto cannot end before they have
describe('ending a version subscriptions still move onto', () => {
    const later = new Date('2026-08-01T00:00:00.000Z');

    async function check(
        subs,
        notices = [noticeFor('t1'), noticeFor('t2', { effectiveAt: later.toISOString() })],
    ) {
        return announced({ subs, notices });
    }

    test('is refused before the day after the last of their dates, and allowed from it', async () => {
        const service = await check([subscriptionOf('t1'), subscriptionOf('t2')]);
        const earliest = new Date('2026-08-02T00:00:00.000Z');

        const error = await rejection(
            service.assertMayEnd('pv-9', new Date(earliest.getTime() - 1), BEFORE),
        );
        await service.assertMayEnd('pv-9', earliest, BEFORE);
        // Up to the moment the first date comes, nothing is overdue yet.
        await service.assertMayEnd('pv-9', earliest, new Date(DATE.getTime() - 1));

        assert.equal(error.getStatus(), 422);
        assert.deepEqual(error.getResponse().code, 'PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES');
        assert.deepEqual(error.getResponse().params, {
            version: 3,
            planKey: 'PLUS',
            date: '2026-08-02',
        });
    });

    test('is allowed where nobody is left to move: moved already, or ended by their date', async () => {
        const moved = subscriptionOf('t1', { planVersion: { id: 'pv-9', planId: 'PLUS' } });
        const ended = subscriptionOf('t2', {
            canceledAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledEffectiveAt: later,
        });
        const service = await check([moved, ended]);

        await service.assertMayEnd('pv-9', new Date('2026-04-01T00:00:00.000Z'), BEFORE);
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('is refused while a notice onto it has reached nobody, whatever end is asked for', async () => {
        const service = await announced({
            subs: [subscriptionOf('t1'), subscriptionOf('t2')],
            notices: [noticeFor('t1')],
            untold: [noticeFor('t2')],
        });

        const error = await rejection(
            service.assertMayEnd('pv-9', new Date('2028-01-01T00:00:00.000Z'), BEFORE),
        );

        assert.equal(error.getStatus(), 422);
        assert.equal(error.getResponse().code, 'PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED');
        assert.deepEqual(error.getResponse().params, { count: 1, version: 3, planKey: 'PLUS' });
    });

    test('is refused while a move is past its date and not made, whatever end is asked for', async () => {
        const service = await check([subscriptionOf('t1'), subscriptionOf('t2')]);

        const error = await rejection(
            service.assertMayEnd('pv-9', new Date('2027-06-01T00:00:00.000Z'), DATE),
        );

        assert.equal(error.getStatus(), 422);
        assert.equal(error.getResponse().code, 'PLAN_TERMINATE_WHILE_MOVES_OVERDUE');
        assert.deepEqual(error.getResponse().params, { count: 1, version: 3, planKey: 'PLUS' });
    });

    test('is allowed for a version no retirement names', async () => {
        const service = await check([subscriptionOf('t1'), subscriptionOf('t2')]);

        await service.assertMayEnd('pv-7', new Date('2026-04-01T00:00:00.000Z'), BEFORE);
    });

    test('is asked by the catalogue before it ends a version, which writes nothing when refused', async () => {
        const ended = [];
        const repo = new FakePlanRepository();
        repo.findVersionById = async () => ({
            id: 'pv-9',
            publishedAt: new Date(),
            supersededAt: null,
        });
        repo.terminate = async (id, endsAt) => (ended.push(id), { id, endsAt });
        const refusal = new Error('still moving');
        const endingCheck = {
            assertMayEnd: async () => {
                throw refusal;
            },
        };
        const versions = new PlanVersionsService(
            repo,
            null,
            { strictModeCheckMode: 'warn-only' },
            null,
            null,
            null,
            null,
            endingCheck,
        );

        const error = await rejection(
            versions.terminatePlanVersion('pv-9', new Date(Date.now() + 365 * DAY)),
        );

        assert.equal(error, refusal);
        assert.deepEqual(ended, []);
    });
});

// @requirement SC-SUB-033 — The operator sees how far each retirement has come
describe('how far a retirement has come', () => {
    test('counts the subscriptions it reached as moved, waiting, overdue or ended', async () => {
        const later = new Date('2026-09-01T00:00:00.000Z');
        const service = await announced({
            subs: [
                subscriptionOf('t1', { planVersion: { id: 'pv-9', planId: 'PLUS' } }),
                subscriptionOf('t2'),
                subscriptionOf('t3'),
                subscriptionOf('t4', {
                    canceledAt: new Date('2026-05-01T00:00:00.000Z'),
                    canceledEffectiveAt: DATE,
                }),
            ],
            notices: [
                noticeFor('t1'),
                noticeFor('t2', { effectiveAt: later.toISOString() }),
                noticeFor('t3'),
                noticeFor('t4'),
            ],
        });

        const [retirement] = await service.list(new Date('2026-07-02T00:00:00.000Z'));

        assert.deepEqual(retirement.progress, {
            moved: 1,
            waiting: 1,
            overdue: 1,
            ended: 1,
            notTold: 0,
            reminded: 0,
        });
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('counts a subscription whose notice has reached nobody as not told, not as overdue', async () => {
        const service = await announced({
            subs: [subscriptionOf('t1'), subscriptionOf('t2')],
            notices: [noticeFor('t1')],
            untold: [noticeFor('t2')],
        });

        const [retirement] = await service.list(new Date('2026-07-02T00:00:00.000Z'));

        assert.deepEqual([retirement.progress.overdue, retirement.progress.notTold], [1, 1]);
    });
});
