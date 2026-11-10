// A trial that ran out unbought ends when the application says so: its
// cancellation lands at the trial's end, and its end is recorded at once, with
// the deletion day and the reason that holds the tenant (`SC-CANC-027`). A
// running trial is not cut short, and a subscription that is no trial is not
// ended this way.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionEndService, TrialEndService } from '../dist/billing/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const TRIAL_ENDED = new Date('2026-11-01T09:00:00.000Z');
const NOW = new Date('2026-11-10T09:15:00.000Z');
const OPERATOR = { userId: 'u-1', email: 'ops@example.com', source: 'web', context: 's1' };

/** A tenant's subscription, kept as the application's store would keep it. */
function trialOf(overrides = {}) {
    return {
        id: 'sub-1',
        status: 'TRIAL',
        trialEndsAt: TRIAL_ENDED,
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    };
}

/** The service over `subscription`, and what it touched. */
function ending(subscription, { racedTo = null } = {}) {
    const seen = {
        subscription,
        cancelled: [],
        invalidated: [],
        contractsEnded: [],
        audited: [],
        bypassed: 0,
    };
    const usage = {
        findForTenant: async (tenantId) => (tenantId === 't-1' ? seen.subscription : null),
        listCancelled: async () => [],
    };
    const writes = {
        cancelSubscription: async (tenantId, input) => {
            seen.cancelled.push({ tenantId, ...input });
            if (racedTo) {
                return {
                    canceledAt: racedTo,
                    canceledEffectiveAt: racedTo,
                    status: 'CANCELED',
                    alreadyCanceled: true,
                };
            }
            seen.subscription = {
                ...seen.subscription,
                status: 'CANCELED',
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
            };
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: 'CANCELED',
                alreadyCanceled: false,
            };
        },
    };
    const bypass = {
        runWithBypass: async (work) => {
            seen.bypassed += 1;
            return work();
        },
    };
    seen.ends = new FakeSubscriptionEndRepository();
    seen.holds = new FakeTenantAccessHoldRepository();
    const endService = new SubscriptionEndService(
        usage,
        seen.ends,
        { readOnlyDays: 30 },
        BERLIN,
        bypass,
        seen.holds,
    );
    const service = new TrialEndService(
        usage,
        writes,
        endService,
        bypass,
        { invalidateTenant: (tenantId) => seen.invalidated.push(tenantId) },
        { endOnCancellation: async (tenantId, at) => seen.contractsEnded.push({ tenantId, at }) },
        { log: async (entry) => seen.audited.push(entry) },
    );
    return Object.assign(seen, { service });
}

const refusedAs = (code) => (error) => {
    assert.equal(error.getResponse().code, code);
    return true;
};

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('a trial that ran out, ended by the application', () => {
    test('lands at the trial’s end, and its end is recorded at once with the day its data goes', async () => {
        const run = ending(trialOf());

        const end = await run.service.endRanOut('t-1', OPERATOR, NOW);

        assert.deepEqual(run.cancelled, [
            { tenantId: 't-1', canceledAt: NOW, effectiveAt: TRIAL_ENDED, terminateNow: true },
        ]);
        // Ended on 1 November, recorded on the 10th: thirty days from the later.
        assert.deepEqual(
            { endsAt: end.endsAt, deletesOn: end.deletesOn, recordedBy: end.recordedBy },
            { endsAt: TRIAL_ENDED, deletesOn: '2026-12-10', recordedBy: 'web:ops@example.com:s1' },
        );
        const [hold] = await run.holds.listOpen('t-1');
        assert.deepEqual(
            { kind: hold?.kind, reference: hold?.reference, since: hold?.since },
            { kind: 'ended', reference: 'sub-1', since: TRIAL_ENDED },
        );
    });

    test('lets the entitlements, the contract and the audit log know, as a cancellation does', async () => {
        const run = ending(trialOf());

        await run.service.endRanOut('t-1', OPERATOR, NOW);

        assert.deepEqual(run.invalidated, ['t-1']);
        assert.deepEqual(run.contractsEnded, [{ tenantId: 't-1', at: TRIAL_ENDED }]);
        assert.equal(run.audited.length, 1);
        assert.deepEqual(
            {
                actor: run.audited[0].actor,
                action: run.audited[0].action,
                reason: run.audited[0].changes.reason,
            },
            { actor: OPERATOR, action: 'CANCEL_SUBSCRIPTION', reason: 'trial-ran-out' },
        );
    });

    test('called again, answers the same end and writes nothing more', async () => {
        const run = ending(trialOf());
        const first = await run.service.endRanOut('t-1', OPERATOR, NOW);

        const again = await run.service.endRanOut(
            't-1',
            OPERATOR,
            new Date('2026-11-11T09:00:00.000Z'),
        );

        assert.deepEqual(again, first);
        assert.equal(run.cancelled.length, 1);
        assert.equal(run.audited.length, 1);
        assert.equal((await run.holds.listOpen('t-1')).length, 1);
    });

    test('a trial ending this very moment has run out; one ending a millisecond later has not', async () => {
        const atItsEnd = ending(trialOf({ trialEndsAt: NOW }));
        assert.equal((await atItsEnd.service.endRanOut('t-1', OPERATOR, NOW)).endsAt, NOW);

        const later = ending(trialOf({ trialEndsAt: new Date(NOW.getTime() + 1) }));
        await assert.rejects(
            later.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );
        assert.deepEqual(later.cancelled, []);
        assert.deepEqual(later.ends.ends, []);
    });

    for (const [what, subscription] of [
        ['a subscription that is no trial', trialOf({ status: 'ACTIVE' })],
        ['a trial without an end', trialOf({ trialEndsAt: null })],
    ]) {
        test(`refuses ${what}, and writes nothing`, async () => {
            const run = ending(subscription);
            await assert.rejects(
                run.service.endRanOut('t-1', OPERATOR, NOW),
                refusedAs('TRIAL_NOT_RUN_OUT'),
            );
            assert.deepEqual(run.cancelled, []);
            assert.deepEqual(await run.holds.listOpen('t-1'), []);
        });
    }

    test('takes the cancellation the tenant declared in its trial once it has landed, without writing another', async () => {
        const run = ending(
            trialOf({
                canceledAt: new Date('2026-10-20T08:00:00.000Z'),
                canceledEffectiveAt: TRIAL_ENDED,
            }),
        );

        const end = await run.service.endRanOut('t-1', OPERATOR, NOW);

        assert.equal(end.endsAt, TRIAL_ENDED);
        assert.deepEqual(run.cancelled, []);
        assert.deepEqual(run.audited, []);
    });

    test('refuses while the cancellation the tenant declared has not landed yet', async () => {
        const run = ending(
            trialOf({
                trialEndsAt: new Date('2026-11-20T09:00:00.000Z'),
                canceledAt: new Date('2026-10-20T08:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-11-20T09:00:00.000Z'),
            }),
        );
        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );
    });

    test('refuses a tenant without a subscription', async () => {
        const run = ending(trialOf());
        await assert.rejects(
            run.service.endRanOut('t-other', OPERATOR, NOW),
            refusedAs('NO_SUBSCRIPTION'),
        );
    });

    test('where another caller declared it first, ends at the moment that one stored, and tells nobody twice', async () => {
        const stored = new Date('2026-11-05T12:00:00.000Z');
        const run = ending(trialOf(), { racedTo: stored });

        const end = await run.service.endRanOut('t-1', OPERATOR, NOW);

        assert.equal(end.endsAt, stored);
        assert.deepEqual(run.invalidated, []);
        assert.deepEqual(run.audited, []);
    });

    test('reads and writes across tenants, as a job of the application asks without a request', async () => {
        const run = ending(trialOf());
        await run.service.endRanOut('t-1', OPERATOR, NOW);
        assert.ok(run.bypassed >= 1);
    });

    test('where the application names nobody, a job of the platform’s ended it', async () => {
        const run = ending(trialOf());

        const end = await run.service.endRanOut('t-1', undefined, NOW);

        assert.equal(end.recordedBy, 'job:platform:trials-ended');
        assert.equal(run.audited[0].actor.source, 'job');
    });
});
