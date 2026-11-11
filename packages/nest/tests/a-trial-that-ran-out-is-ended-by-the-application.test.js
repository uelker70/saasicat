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

/**
 * The service over `subscription`, and what it touched. `storedMeanwhile`
 * stands for what another writer stored between the read and the write: the
 * conditional end then claims nothing, and answers that instead.
 */
function ending(subscription, { storedMeanwhile = null, withoutEndTrial = false } = {}) {
    const seen = {
        subscription,
        trialsEnded: [],
        invalidated: [],
        contractsEnded: [],
        audited: [],
        bypassed: 0,
    };
    const usage = {
        findForTenant: async (tenantId) => (tenantId === 't-1' ? seen.subscription : null),
        // What the quarter-hourly run reads: the subscription, once a
        // cancellation was declared for it.
        listCancelled: async () => {
            const { id, canceledAt, canceledEffectiveAt } = seen.subscription;
            return canceledAt || canceledEffectiveAt
                ? [{ tenantId: 't-1', subscriptionId: id, canceledAt, canceledEffectiveAt }]
                : [];
        },
    };
    const writes = withoutEndTrial
        ? { cancelSubscription: async () => assert.fail('a trial is not ended unconditionally') }
        : {
              endTrial: async (tenantId, input) => {
                  seen.trialsEnded.push({ tenantId, ...input });
                  if (storedMeanwhile) return { ended: false, ...storedMeanwhile };
                  seen.subscription = {
                      ...seen.subscription,
                      status: 'CANCELED',
                      canceledAt: input.at,
                      canceledEffectiveAt: input.trialEndsAt,
                  };
                  return {
                      ended: true,
                      canceledAt: input.at,
                      canceledEffectiveAt: input.trialEndsAt,
                      status: 'CANCELED',
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
    const endService = (seen.endService = new SubscriptionEndService(
        usage,
        seen.ends,
        { readOnlyDays: 30 },
        BERLIN,
        bypass,
        seen.holds,
    ));
    endService.onModuleInit();
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

        assert.deepEqual(run.trialsEnded, [{ tenantId: 't-1', at: NOW, trialEndsAt: TRIAL_ENDED }]);
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
        assert.equal(run.trialsEnded.length, 1);
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
        assert.deepEqual(later.trialsEnded, []);
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
            assert.deepEqual(run.trialsEnded, []);
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
        assert.deepEqual(run.trialsEnded, []);
        assert.deepEqual(run.audited, []);
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('a trial its tenant cancelled, and was told a day for, ends with that day', async () => {
        const cancelledOn = new Date('2026-10-20T08:00:00.000Z');
        const run = ending(trialOf({ canceledAt: cancelledOn, canceledEffectiveAt: TRIAL_ENDED }));
        await run.ends.announce({
            tenantId: 't-1',
            subscriptionId: 'sub-1',
            endsAt: TRIAL_ENDED,
            readOnlyDays: 30,
            deletesOn: '2026-12-01',
            announcedAt: cancelledOn,
            announcedBy: 'web:admin@example.com:s1',
        });

        const end = await run.service.endRanOut('t-1', OPERATOR, NOW);

        // Recorded on the 10th, it would have been counted to 10 December.
        assert.equal(end.deletesOn, '2026-12-01');
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

    for (const [what, subscription] of [
        [
            'a paid term whose cancellation landed after the trial',
            trialOf({
                status: 'ACTIVE',
                trialEndsAt: new Date('2026-10-01T00:00:00.000Z'),
                canceledAt: new Date('2026-10-05T08:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-10-31T23:00:00.000Z'),
            }),
        ],
        [
            'a subscription that never had a trial, whose cancellation landed',
            trialOf({
                status: 'CANCELED',
                trialEndsAt: null,
                canceledAt: new Date('2026-10-05T08:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-10-31T23:00:00.000Z'),
            }),
        ],
    ]) {
        test(`refuses ${what}: the run records that end, not the trial's`, async () => {
            const run = ending(subscription);
            await assert.rejects(
                run.service.endRanOut('t-1', OPERATOR, NOW),
                refusedAs('TRIAL_NOT_RUN_OUT'),
            );
            assert.deepEqual(run.ends.ends, []);
            assert.deepEqual(await run.holds.listOpen('t-1'), []);
        });
    }

    test('leaves a trial its tenant cancelled after it ran out to the run, which records that end', async () => {
        // Run out on 1 November; the tenant cancelled it on the 5th, before the
        // application's job reached it. That cancellation lands on the 5th,
        // after the trial's end, as a paid term's would: nothing stored tells
        // the two apart, so this call refuses and the run records it.
        const cancelledOn = new Date('2026-11-05T10:00:00.000Z');
        const run = ending(
            trialOf({
                status: 'CANCELED',
                canceledAt: cancelledOn,
                canceledEffectiveAt: cancelledOn,
            }),
        );

        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );
        assert.deepEqual(run.ends.ends, []);

        assert.deepEqual(await run.endService.recordEnded(NOW), { ended: 1 });
        assert.equal(run.ends.ends[0]?.endsAt, cancelledOn);
        assert.equal(run.ends.ends[0]?.recordedBy, 'job:platform:subscription-ends');
    });

    test('refuses a converted trial whose paid term was cancelled meanwhile and has landed', async () => {
        const run = ending(trialOf(), {
            storedMeanwhile: {
                status: 'CANCELED',
                canceledAt: new Date('2026-11-09T08:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-11-09T09:00:00.000Z'),
            },
        });
        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );
        assert.deepEqual(run.ends.ends, []);
    });

    test('refuses a tenant without a subscription', async () => {
        const run = ending(trialOf());
        await assert.rejects(
            run.service.endRanOut('t-other', OPERATOR, NOW),
            refusedAs('NO_SUBSCRIPTION'),
        );
    });

    test('a trial that converted between the read and the write is left running, and nothing is recorded', async () => {
        const run = ending(trialOf(), {
            storedMeanwhile: { status: 'ACTIVE', canceledAt: null, canceledEffectiveAt: null },
        });

        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );

        assert.deepEqual(run.ends.ends, []);
        assert.deepEqual(await run.holds.listOpen('t-1'), [], 'a paying tenant is not held back');
        assert.deepEqual(run.invalidated, []);
        assert.deepEqual(run.audited, []);
    });

    test('a cancellation declared meanwhile with time still to run is no end yet', async () => {
        const run = ending(trialOf(), {
            storedMeanwhile: {
                status: 'ACTIVE',
                canceledAt: new Date('2026-11-10T09:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-12-01T00:00:00.000Z'),
            },
        });

        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            refusedAs('TRIAL_NOT_RUN_OUT'),
        );
        assert.deepEqual(run.ends.ends, []);
        assert.deepEqual(await run.holds.listOpen('t-1'), []);
    });

    test('a trial another caller ended meanwhile ends at the moment stored, and tells nobody twice', async () => {
        const run = ending(trialOf(), {
            storedMeanwhile: {
                status: 'CANCELED',
                canceledAt: new Date('2026-11-10T09:14:00.000Z'),
                canceledEffectiveAt: TRIAL_ENDED,
            },
        });

        const end = await run.service.endRanOut('t-1', OPERATOR, NOW);

        assert.equal(end.endsAt, TRIAL_ENDED);
        assert.deepEqual(run.invalidated, []);
        assert.deepEqual(run.audited, []);
    });

    test('refuses over a write port that cannot end a trial conditionally, naming the method', async () => {
        const run = ending(trialOf(), { withoutEndTrial: true });
        await assert.rejects(
            run.service.endRanOut('t-1', OPERATOR, NOW),
            /`endTrial`.*SC-CANC-027/s,
        );
        assert.deepEqual(run.ends.ends, []);
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
