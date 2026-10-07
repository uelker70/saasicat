import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EndAtOnceService, givenPlanCatalogSource } from '../dist/billing/index.js';
import { CATALOG, refusalOf } from './helpers/feature-withdrawal-fixtures.js';
import { usageRecord } from './helpers/subscription-fixtures.js';
import { noticeRecord } from './helpers/version-notices.js';

// While a feature is withdrawn, a subscription it reached may end at once,
// without notice — whatever cancellation was declared before — for as long as
// its plan or special terms would grant the feature; a booking it reached may
// end alone, for as long as its version would. The end is the moment it is
// declared, recorded as ending at once before it is written, and what it
// credits is shown first and is the figure the account writes.

const NOW = new Date('2026-06-15T10:00:00.000Z');
const later = (ms) => new Date(NOW.getTime() + ms);

function withdrawal(fields = {}) {
    return {
        id: 'fw-1',
        featureKey: 'EXPORT',
        reason: 'The export service has been switched off.',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        liftedFrom: null,
        reductions: [],
        announcedAt: new Date('2026-05-30T00:00:00.000Z'),
        announcedBy: 'web:ops@example.com:admin',
        liftedAt: null,
        liftedBy: null,
        ...fields,
    };
}

/** What the subscription was told: its plan reduced by 5, its booking by 2, unless said. */
function told(overrides = {}) {
    return {
        kind: 'feature-withdrawn',
        tenantId: 't1',
        subscriptionId: 'sub-t1',
        withdrawalId: 'fw-1',
        featureKey: 'EXPORT',
        featureLabel: 'Data export',
        reason: 'The export service has been switched off.',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        lines: [
            {
                line: 'plan',
                key: 'PRO',
                label: 'Pro',
                subscriptionBundleId: null,
                billingCycle: 'MONTHLY',
                reductionNet: 5,
            },
            {
                line: 'bundle',
                key: 'EXPORT_PLUS',
                label: 'Export plus',
                subscriptionBundleId: 'sb-t1',
                billingCycle: 'MONTHLY',
                reductionNet: 2,
            },
        ],
        specialTerms: false,
        ...overrides,
    };
}

function booking(fields = {}) {
    return {
        id: 'sb-t1',
        subscriptionId: 'sub-t1',
        bundleVersionId: 'bv-export-1',
        startedAt: new Date('2026-02-01T00:00:00.000Z'),
        minimumTermEndsAt: null,
        billingCycle: null,
        currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
        canceledAt: null,
        canceledEffectiveAt: null,
        ...fields,
    };
}

async function ending({
    subscription: subscriptionFields = {},
    withdrawals = [withdrawal()],
    notice = told(),
    bookings = [booking()],
    planGrants = ['EXPORT'],
    versionGrants = { 'bv-export-1': ['EXPORT'] },
    writes: writeFields = {},
    bookingStore: bookingFields = {},
} = {}) {
    const subscription = usageRecord({
        id: 'sub-t1',
        plan: 'PRO',
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
        planVersion: { id: 'pv-pro-1', planId: 'PRO', version: 1 },
        ...subscriptionFields,
    });
    const notices = noticeRecord();
    if (notice) {
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'feature-withdrawn',
                    subject: notice.withdrawalId,
                    content: notice,
                },
            ],
            new Date('2026-05-30T00:00:00.000Z'),
        );
    }
    const calls = [];
    const writes = {
        async cancelSubscription(tenantId, input) {
            calls.push(['cancelSubscription', input]);
            const free =
                subscription.canceledAt === null && subscription.canceledEffectiveAt === null;
            if (free) {
                subscription.canceledAt = input.canceledAt;
                subscription.canceledEffectiveAt = input.effectiveAt;
                subscription.status = 'CANCELED';
            }
            return {
                canceledAt: subscription.canceledAt,
                canceledEffectiveAt: subscription.canceledEffectiveAt,
                status: subscription.status,
                alreadyCanceled: !free,
            };
        },
        async endNow(tenantId, input) {
            calls.push(['endNow', input]);
            const ended =
                subscription.canceledEffectiveAt?.getTime() ===
                input.expectedCanceledEffectiveAt.getTime();
            if (ended) {
                subscription.canceledAt = input.at;
                subscription.canceledEffectiveAt = input.at;
                subscription.status = 'CANCELED';
            }
            return {
                ended,
                canceledAt: subscription.canceledAt,
                canceledEffectiveAt: subscription.canceledEffectiveAt,
                status: subscription.status,
            };
        },
        ...writeFields,
    };
    const bookingStore = {
        async listBySubscription() {
            return bookings;
        },
        async cancel(id, data) {
            calls.push(['cancelBooking', id, data]);
            Object.assign(
                bookings.find((one) => one.id === id),
                data,
            );
        },
        async endNow(id, input) {
            calls.push(['endBookingNow', id, input]);
            const row = bookings.find((one) => one.id === id);
            if (
                row?.canceledEffectiveAt?.getTime() !== input.expectedCanceledEffectiveAt.getTime()
            ) {
                return null;
            }
            Object.assign(row, { canceledAt: input.at, canceledEffectiveAt: input.at });
            return row;
        },
        ...bookingFields,
    };
    const service = new EndAtOnceService(
        { list: async () => withdrawals },
        notices,
        { findForTenant: async () => subscription },
        writes,
        givenPlanCatalogSource(CATALOG),
        {
            contractFeaturesFor: async () => ({
                planVersionId: 'pv-pro-1',
                features: new Set(planGrants),
            }),
            withReplacements: (features) => new Set(features),
            invalidateTenant: (tenantId) => calls.push(['invalidate', tenantId]),
        },
        { tell: async (content, subject) => calls.push(['tell', content.kind, subject]) },
        bookingStore,
        { findVersionById: async (id) => ({ features: versionGrants[id] ?? [] }) },
        {
            endOnCancellation: async (tenantId, at) =>
                calls.push(['endContract', at.toISOString()]),
            freezeOnPlanChange: async (tenantId, plan, cycle, from) =>
                calls.push(['refreeze', from.toISOString()]),
        },
        {
            creditOfEndingAtOnce: async (tenantId, subscriptionBundleId, at) => {
                calls.push(['credit', at.toISOString()]);
                return { creditNet: subscriptionBundleId ? 6.67 : 39.34, currency: 'EUR' };
            },
            recordDueCharges: async (tenantId, at) => calls.push(['charge', at.toISOString()]),
        },
    );
    return { service, subscription, bookings, notices, calls };
}

const kinds = (calls) => calls.map(([kind]) => kind);

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('what the tenant sees of a withdrawal', () => {
    test('says what is reduced, and what may end at once', async () => {
        const { service } = await ending();
        assert.deepEqual(await service.withdrawalsOf('t1', NOW), [
            {
                withdrawalId: 'fw-1',
                featureKey: 'EXPORT',
                featureLabel: 'Data export',
                reason: 'The export service has been switched off.',
                effectiveFrom: '2026-06-01T00:00:00.000Z',
                liftedFrom: null,
                inEffect: true,
                lines: [
                    { ...told().lines[0], reduced: true },
                    { ...told().lines[1], reduced: true },
                ],
                specialTerms: false,
                endable: { subscription: true, subscriptionBundleIds: ['sb-t1'] },
            },
        ]);
    });

    test('opens nothing before the date, and is gone once the withdrawal is lifted', async () => {
        const ahead = await ending({ withdrawals: [withdrawal({ effectiveFrom: later(1) })] });
        const [view] = await ahead.service.withdrawalsOf('t1', NOW);
        assert.equal(view.inEffect, false);
        assert.deepEqual(view.endable, { subscription: false, subscriptionBundleIds: [] });

        const lifting = await ending({ withdrawals: [withdrawal({ liftedFrom: later(1) })] });
        assert.equal((await lifting.service.withdrawalsOf('t1', NOW)).length, 1, 'until the lift');
        const lifted = await ending({ withdrawals: [withdrawal({ liftedFrom: NOW })] });
        assert.deepEqual(await lifted.service.withdrawalsOf('t1', NOW), []);
    });

    test('ends the reduction with a change of plan or rhythm, and the right with the feature', async () => {
        const changed = await ending({ subscription: { billingCycle: 'YEARLY' } });
        const [view] = await changed.service.withdrawalsOf('t1', NOW);
        assert.equal(view.lines[0].reduced, false, 'the plan was reduced monthly');
        assert.equal(view.endable.subscription, true, 'and still grants the feature');

        const without = await ending({ planGrants: [] });
        const [other] = await without.service.withdrawalsOf('t1', NOW);
        assert.equal(other.endable.subscription, false, 'a plan without it has nothing missing');
    });

    test('shows nothing to a subscription it did not reach', async () => {
        const { service } = await ending({ notice: null });
        assert.deepEqual(await service.withdrawalsOf('t1', NOW), []);
    });
});

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('ending a subscription at once', () => {
    test('ends it now, records it first, ends the contract and credits the unused rest', async () => {
        const { service, subscription, notices, calls } = await ending();

        const ended = await service.end('t1', 'fw-1', null, NOW);

        assert.deepEqual(ended, {
            withdrawalId: 'fw-1',
            subscriptionBundleId: null,
            endsAt: NOW.toISOString(),
            creditNet: 39.34,
            currency: 'EUR',
        });
        assert.equal(subscription.canceledEffectiveAt.toISOString(), NOW.toISOString());
        assert.deepEqual(calls[1], [
            'cancelSubscription',
            { canceledAt: NOW, effectiveAt: NOW, terminateNow: true },
        ]);
        assert.deepEqual(kinds(calls), [
            'credit',
            'cancelSubscription',
            'endContract',
            'invalidate',
            'charge',
            'tell',
        ]);
        const record = [...notices.rows.values()].find((row) => row.kind === 'ended-at-once');
        assert.deepEqual(record.content, {
            kind: 'ended-at-once',
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            subscriptionBundleId: null,
            withdrawalId: 'fw-1',
            featureKey: 'EXPORT',
            featureLabel: 'Data export',
            endedAt: NOW.toISOString(),
        });
    });

    test('brings forward a cancellation declared for the end of the term', async () => {
        const declared = new Date('2027-01-01T00:00:00.000Z');
        const { service, subscription, calls } = await ending({
            subscription: { canceledAt: new Date('2026-04-01'), canceledEffectiveAt: declared },
        });
        await service.end('t1', 'fw-1', null, NOW);
        assert.deepEqual(calls[1], ['endNow', { at: NOW, expectedCanceledEffectiveAt: declared }]);
        assert.equal(subscription.canceledEffectiveAt.toISOString(), NOW.toISOString());
    });

    test('is refused, and nothing recorded, where the store cannot bring a declared end forward', async () => {
        const { service, notices, calls } = await ending({
            subscription: {
                canceledAt: new Date('2026-04-01'),
                canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
            },
            writes: { endNow: undefined },
        });
        const refusal = await refusalOf(service.end('t1', 'fw-1', null, NOW));
        assert.deepEqual(
            [refusal.code, refusal.params],
            ['FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED', { date: '2027-01-01' }],
        );
        assert.equal(
            [...notices.rows.values()].filter((row) => row.kind === 'ended-at-once').length,
            0,
        );
        assert.deepEqual(calls, []);
        assert.equal(
            (await refusalOf(service.preview('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED',
            'and no credit is shown for an end that cannot happen',
        );
    });

    test('is refused as one that cannot be brought forward where only the declaration date names the end', async () => {
        // A declared end only `canceledAt` carries: the guarded write compares
        // the effective date, so it would refuse every attempt as a change.
        const { service, calls } = await ending({
            subscription: {
                canceledAt: new Date('2027-01-01T00:00:00.000Z'),
                canceledEffectiveAt: null,
            },
        });
        for (const attempt of [
            service.preview('t1', 'fw-1', null, NOW),
            service.end('t1', 'fw-1', null, NOW),
        ]) {
            const refusal = await refusalOf(attempt);
            assert.deepEqual(
                [refusal.code, refusal.params],
                ['FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED', { date: '2027-01-01' }],
            );
        }
        assert.deepEqual(calls, []);
    });

    test('is refused for a withdrawal it was not told of, or one not in effect now', async () => {
        assert.equal(
            (await refusalOf((await ending()).service.end('t1', 'fw-other', null, NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        assert.equal(
            (await refusalOf((await ending({ notice: null })).service.end('t1', 'fw-1', null, NOW)))
                .code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        const ahead = await ending({ withdrawals: [withdrawal({ effectiveFrom: later(1) })] });
        assert.equal(
            (await refusalOf(ahead.service.end('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_NOT_IN_EFFECT',
        );
        const lifted = await ending({ withdrawals: [withdrawal({ liftedFrom: NOW })] });
        assert.equal(
            (await refusalOf(lifted.service.end('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_NOT_IN_EFFECT',
        );
        const effective = await ending({ withdrawals: [withdrawal({ effectiveFrom: NOW })] });
        assert.equal(
            (await effective.service.end('t1', 'fw-1', null, NOW)).endsAt,
            NOW.toISOString(),
            'from the date on',
        );
    });

    test('is refused once it has ended, and where the plan no longer grants the feature', async () => {
        const ended = await ending({ subscription: { canceledAt: NOW, canceledEffectiveAt: NOW } });
        assert.equal(
            (await refusalOf(ended.service.end('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_ALREADY_ENDED',
        );
        const without = await ending({ planGrants: [] });
        assert.equal(
            (await refusalOf(without.service.end('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });

    test('is open to a subscription reached through its special terms alone', async () => {
        const { service } = await ending({ notice: told({ lines: [], specialTerms: true }) });
        assert.equal((await service.end('t1', 'fw-1', null, NOW)).endsAt, NOW.toISOString());
    });

    test('a second attempt after a failure ends at its own moment, not the failed one', async () => {
        const { service, subscription, notices } = await ending({
            writes: {
                cancelSubscription: async () => {
                    throw new Error('database gone');
                },
            },
        });
        await assert.rejects(service.end('t1', 'fw-1', null, NOW), /database gone/);
        assert.equal(subscription.canceledEffectiveAt, null, 'nothing ended');
        const retried = await ending({});
        // The record the first attempt left behind.
        retried.notices.rows.clear();
        for (const [key, row] of notices.rows) retried.notices.rows.set(key, row);
        const result = await retried.service.end('t1', 'fw-1', null, later(60_000));
        assert.equal(result.endsAt, later(60_000).toISOString(), 'not backdated to the failure');
        assert.equal(
            retried.subscription.canceledEffectiveAt.toISOString(),
            later(60_000).toISOString(),
        );
        assert.deepEqual(
            [...retried.notices.rows.values()]
                .filter((row) => row.kind === 'ended-at-once')
                .map((row) => row.content.endedAt)
                .sort(),
            [NOW.toISOString(), later(60_000).toISOString()],
            'each attempt keeps its own record',
        );
    });

    test('is refused where the cancellation moved meanwhile', async () => {
        const declared = new Date('2027-01-01T00:00:00.000Z');
        const { service } = await ending({
            subscription: { canceledAt: new Date('2026-04-01'), canceledEffectiveAt: declared },
            writes: {
                endNow: async () => ({
                    ended: false,
                    canceledAt: new Date('2026-04-01'),
                    canceledEffectiveAt: new Date('2027-02-01T00:00:00.000Z'),
                    status: 'ACTIVE',
                }),
            },
        });
        assert.equal(
            (await refusalOf(service.end('t1', 'fw-1', null, NOW))).code,
            'CANCELLATION_TERMS_CHANGED',
        );
    });

    test('shows what it would credit first, refused as the end would be', async () => {
        const { service, calls } = await ending();
        assert.deepEqual(await service.preview('t1', 'fw-1', null, NOW), {
            endsAt: NOW.toISOString(),
            creditNet: 39.34,
            currency: 'EUR',
        });
        assert.deepEqual(kinds(calls), ['credit'], 'and changes nothing');
        const without = await ending({ planGrants: [] });
        assert.equal(
            (await refusalOf(without.service.preview('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });
});

// @requirement SC-BUN-062 — An add-on that grants a withdrawn feature can be ended at once on its own
describe('ending a booking at once', () => {
    test('ends it alone, now, writes the contract again and credits its unused rest', async () => {
        const { service, bookings, subscription, calls } = await ending();
        const ended = await service.end('t1', 'fw-1', 'sb-t1', NOW);
        assert.equal(ended.subscriptionBundleId, 'sb-t1');
        assert.equal(ended.creditNet, 6.67);
        assert.deepEqual(calls[1], [
            'cancelBooking',
            'sb-t1',
            { canceledAt: NOW, canceledEffectiveAt: NOW },
        ]);
        assert.deepEqual(kinds(calls), [
            'credit',
            'cancelBooking',
            'refreeze',
            'invalidate',
            'charge',
            'tell',
        ]);
        assert.equal(bookings[0].canceledEffectiveAt.toISOString(), NOW.toISOString());
        assert.equal(subscription.canceledEffectiveAt, null, 'the subscription runs on');
    });

    test('brings forward a booking cancelled for a later date', async () => {
        const declared = new Date('2026-07-01T00:00:00.000Z');
        const { service, calls } = await ending({
            bookings: [
                booking({ canceledAt: new Date('2026-06-10'), canceledEffectiveAt: declared }),
            ],
        });
        await service.end('t1', 'fw-1', 'sb-t1', NOW);
        assert.deepEqual(calls[1], [
            'endBookingNow',
            'sb-t1',
            { at: NOW, expectedCanceledEffectiveAt: declared },
        ]);
    });

    test('is refused for a booking it did not reach, or whose version no longer grants it', async () => {
        const other = await ending({ bookings: [booking({ id: 'sb-other' })] });
        assert.equal(
            (await refusalOf(other.service.end('t1', 'fw-1', 'sb-other', NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        const switched = await ending({ bookings: [booking({ bundleVersionId: 'bv-lite' })] });
        assert.equal(
            (await refusalOf(switched.service.end('t1', 'fw-1', 'sb-t1', NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });

    test('is refused once the booking has ended', async () => {
        const { service } = await ending({
            bookings: [booking({ canceledAt: NOW, canceledEffectiveAt: NOW })],
        });
        assert.equal(
            (await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW))).code,
            'FEATURE_WITHDRAWAL_ALREADY_ENDED',
        );
    });
});
