import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';

import { UnprocessableEntityException } from '@nestjs/common';
import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN, resolveErrorMessage } from '@saasicat/core';
import {
    EndAtOnceService,
    FeatureWithdrawalTenantController,
    SubscriptionContractFreezeService,
    SubscriptionEndService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import { EntitlementService } from '../dist/entitlement/index.js';
import { CATALOG, refusalOf } from './helpers/feature-withdrawal-fixtures.js';
import {
    boundPlanVersion,
    entitlementServiceFor,
    usageRecord,
} from './helpers/subscription-fixtures.js';
import { noticeRecord } from './helpers/version-notices.js';

// While a feature is withdrawn, a subscription it reached may end at once,
// without notice — whatever cancellation was declared before — for as long as
// its plan or special terms would grant the feature; a booking it reached may
// end alone, for as long as its version would. The end is the moment it is
// declared, recorded as ending at once before it is written, and what it
// credits is shown first and is the figure the account writes.

const NOW = new Date('2026-06-15T10:00:00.000Z');
const later = (ms) => new Date(NOW.getTime() + ms);
/** The days around `NOW` in UTC, the zone of an installation that names none. */
const NOW_DAYS = { until: '2026-06-15', from: '2026-06-15' };
/** The days around midnight before 1 July in UTC. */
const JULY_DAYS = { until: '2026-06-30', from: '2026-07-01' };
/** The tenant's administrator confirming, as the route passes it on. */
const CONFIRMED = { by: 'web:admin@t1.example:tenant-self-service' };

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
        pendingBundleVersionId: null,
        pendingVersionEffectiveAt: null,
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
    contractFreeze: freezeFields = {},
    freeze = null,
    settings = null,
    ends = null,
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
        async restoreCancellation(id, input) {
            calls.push(['putBookingBack', id, input]);
            const row = bookings.find((one) => one.id === id);
            if (
                row?.canceledAt?.getTime() !== input.endedAt.getTime() ||
                row.canceledEffectiveAt?.getTime() !== input.endedAt.getTime()
            ) {
                return null;
            }
            Object.assign(row, {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.canceledEffectiveAt,
            });
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
        freeze ?? {
            endOnCancellation: async (tenantId, at) =>
                calls.push(['endContract', at.toISOString()]),
            assertPartyFor: async (tenantId, intended) => calls.push(['assertParty', intended]),
            freezeOnPlanChange: async (tenantId, plan, cycle, from) =>
                calls.push(['refreeze', from.toISOString()]),
            ...freezeFields,
        },
        {
            creditOfEndingAtOnce: async (tenantId, subscriptionBundleId, at) => {
                calls.push(['credit', at.toISOString()]);
                return { creditNet: subscriptionBundleId ? 6.67 : 39.34, currency: 'EUR' };
            },
            recordDueCharges: async (tenantId, at) => calls.push(['charge', at.toISOString()]),
        },
        settings,
        ends && endOfSubscriptionOver(ends, subscription, settings),
    );
    return { service, subscription, bookings, notices, calls };
}

/** Where `ends` keeps the end of `subscription` and the days its tenant is told: thirty read-only days. */
function endOfSubscriptionOver(ends, subscription, settings) {
    const service = new SubscriptionEndService(
        { findForTenant: async () => subscription, listCancelled: async () => [] },
        ends,
        { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] },
        settings ?? {},
    );
    service.onModuleInit();
    return service;
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
                effectiveFromDays: { until: '2026-05-31', from: '2026-06-01' },
                liftedFrom: null,
                liftedFromDays: null,
                inEffect: true,
                lines: [
                    { ...told().lines[0], reduced: true, fromChange: null, fromChangeDays: null },
                    { ...told().lines[1], reduced: true, fromChange: null, fromChangeDays: null },
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

    // @requirement SC-SUB-043 — A withdrawal reaches the line a change scheduled before it brings a subscription to
    test('says when a line a scheduled change brings begins, and reduces it once it runs', async () => {
        const JULY = new Date('2026-07-01T00:00:00.000Z');
        const yearly = { ...told().lines[0], billingCycle: 'YEARLY', reductionNet: 40 };
        // On Basic, without the feature, and moving to Pro yearly on 1 July.
        const before = await ending({
            subscription: {
                plan: 'BASIC',
                pendingPlan: 'PRO',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: JULY,
            },
            notice: told({ lines: [yearly] }),
            bookings: [],
            planGrants: [],
        });
        const [ahead] = await before.service.withdrawalsOf('t1', NOW);
        assert.deepEqual(ahead.lines, [
            {
                ...yearly,
                reduced: false,
                fromChange: JULY.toISOString(),
                fromChangeDays: JULY_DAYS,
            },
        ]);

        const after = await ending({
            subscription: { billingCycle: 'YEARLY' },
            notice: told({ lines: [yearly] }),
            bookings: [],
        });
        const [running] = await after.service.withdrawalsOf('t1', later(30 * 86_400_000));
        assert.deepEqual(running.lines, [
            { ...yearly, reduced: true, fromChange: null, fromChangeDays: null },
        ]);
    });

    // @requirement SC-SUB-043 — A withdrawal reaches the line a change scheduled before it brings a subscription to
    test('reduces the line held until the change, and the line it brings from then', async () => {
        const JULY = new Date('2026-07-01T00:00:00.000Z');
        const [monthly] = told().lines;
        const yearly = { ...monthly, billingCycle: 'YEARLY', reductionNet: 40 };
        const { service } = await ending({
            subscription: {
                pendingPlan: 'PRO',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: JULY,
            },
            notice: told({ lines: [monthly, yearly] }),
            bookings: [],
        });
        const [view] = await service.withdrawalsOf('t1', NOW);
        assert.deepEqual(view.lines, [
            { ...monthly, reduced: true, fromChange: null, fromChangeDays: null },
            {
                ...yearly,
                reduced: false,
                fromChange: JULY.toISOString(),
                fromChangeDays: JULY_DAYS,
            },
        ]);
    });

    // @requirement SC-SUB-043 — A withdrawal reaches the line a change scheduled before it brings a subscription to
    test('says when the scheduled move of a booking brings the version that grants the feature', async () => {
        const JULY = new Date('2026-07-01T00:00:00.000Z');
        const { service } = await ending({
            bookings: [
                booking({ pendingBundleVersionId: 'bv-export-2', pendingVersionEffectiveAt: JULY }),
            ],
            versionGrants: { 'bv-export-1': [], 'bv-export-2': ['EXPORT'] },
        });
        const [view] = await service.withdrawalsOf('t1', NOW);
        assert.deepEqual(view.lines[1], {
            ...told().lines[1],
            reduced: false,
            fromChange: JULY.toISOString(),
            fromChangeDays: JULY_DAYS,
        });
        assert.deepEqual(view.endable.subscriptionBundleIds, [], 'nothing missing yet to end');
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

        const ended = await service.end('t1', 'fw-1', null, NOW, CONFIRMED);

        assert.deepEqual(ended, {
            withdrawalId: 'fw-1',
            subscriptionBundleId: null,
            endsAt: NOW.toISOString(),
            endsDays: NOW_DAYS,
            creditNet: 39.34,
            currency: 'EUR',
            deletion: null,
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
            deletion: null,
        });
    });

    test('brings forward a cancellation declared for the end of the term', async () => {
        const declared = new Date('2027-01-01T00:00:00.000Z');
        const { service, subscription, calls } = await ending({
            subscription: { canceledAt: new Date('2026-04-01'), canceledEffectiveAt: declared },
        });
        await service.end('t1', 'fw-1', null, NOW, CONFIRMED);
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
        const refusal = await refusalOf(service.end('t1', 'fw-1', null, NOW, CONFIRMED));
        assert.deepEqual(
            [refusal.code, refusal.params],
            [
                'FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED',
                { date: '2027-01-01', lastDay: '2026-12-31' },
            ],
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

    test('is refused the same where the store names its end-now write as null', async () => {
        // A JavaScript adapter, or one built as `supported ? fn : null`: a null
        // write is as absent as a missing one, not a function to call.
        const { service, calls } = await ending({
            subscription: {
                canceledAt: new Date('2026-04-01'),
                canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
            },
            writes: { endNow: null },
        });
        const refusal = await refusalOf(service.end('t1', 'fw-1', null, NOW, CONFIRMED));
        assert.deepEqual(
            [refusal.code, refusal.params],
            [
                'FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED',
                { date: '2027-01-01', lastDay: '2026-12-31' },
            ],
        );
        assert.deepEqual(calls, []);
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
            service.end('t1', 'fw-1', null, NOW, CONFIRMED),
        ]) {
            const refusal = await refusalOf(attempt);
            assert.deepEqual(
                [refusal.code, refusal.params],
                [
                    'FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED',
                    { date: '2027-01-01', lastDay: '2026-12-31' },
                ],
            );
        }
        assert.deepEqual(calls, []);
    });

    test('is refused for a withdrawal it was not told of, or one not in effect now', async () => {
        assert.equal(
            (await refusalOf((await ending()).service.end('t1', 'fw-other', null, NOW, CONFIRMED)))
                .code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        assert.equal(
            (
                await refusalOf(
                    (await ending({ notice: null })).service.end(
                        't1',
                        'fw-1',
                        null,
                        NOW,
                        CONFIRMED,
                    ),
                )
            ).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        const ahead = await ending({ withdrawals: [withdrawal({ effectiveFrom: later(1) })] });
        assert.equal(
            (await refusalOf(ahead.service.end('t1', 'fw-1', null, NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_NOT_IN_EFFECT',
        );
        const lifted = await ending({ withdrawals: [withdrawal({ liftedFrom: NOW })] });
        assert.equal(
            (await refusalOf(lifted.service.end('t1', 'fw-1', null, NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_NOT_IN_EFFECT',
        );
        const effective = await ending({ withdrawals: [withdrawal({ effectiveFrom: NOW })] });
        assert.equal(
            (await effective.service.end('t1', 'fw-1', null, NOW, CONFIRMED)).endsAt,
            NOW.toISOString(),
            'from the date on',
        );
    });

    test('is refused once it has ended, and where the plan no longer grants the feature', async () => {
        const ended = await ending({ subscription: { canceledAt: NOW, canceledEffectiveAt: NOW } });
        assert.equal(
            (await refusalOf(ended.service.end('t1', 'fw-1', null, NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_ALREADY_ENDED',
        );
        const without = await ending({ planGrants: [] });
        assert.equal(
            (await refusalOf(without.service.end('t1', 'fw-1', null, NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });

    test('is open to a subscription reached through its special terms alone', async () => {
        const { service } = await ending({ notice: told({ lines: [], specialTerms: true }) });
        assert.equal(
            (await service.end('t1', 'fw-1', null, NOW, CONFIRMED)).endsAt,
            NOW.toISOString(),
        );
    });

    test('a second attempt after a failure ends at its own moment, not the failed one', async () => {
        const { service, subscription, notices } = await ending({
            writes: {
                cancelSubscription: async () => {
                    throw new Error('database gone');
                },
            },
        });
        await assert.rejects(service.end('t1', 'fw-1', null, NOW, CONFIRMED), /database gone/);
        assert.equal(subscription.canceledEffectiveAt, null, 'nothing ended');
        const retried = await ending({});
        // The record the first attempt left behind.
        retried.notices.rows.clear();
        for (const [key, row] of notices.rows) retried.notices.rows.set(key, row);
        const result = await retried.service.end('t1', 'fw-1', null, later(60_000), CONFIRMED);
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
            (await refusalOf(service.end('t1', 'fw-1', null, NOW, CONFIRMED))).code,
            'CANCELLATION_TERMS_CHANGED',
        );
    });

    test('shows what it would credit first, refused as the end would be', async () => {
        const { service, calls } = await ending();
        assert.deepEqual(await service.preview('t1', 'fw-1', null, NOW), {
            endsAt: NOW.toISOString(),
            endsDays: NOW_DAYS,
            creditNet: 39.34,
            currency: 'EUR',
            deletion: null,
        });
        assert.deepEqual(kinds(calls), ['credit'], 'and changes nothing');
        const without = await ending({ planGrants: [] });
        assert.equal(
            (await refusalOf(without.service.preview('t1', 'fw-1', null, NOW))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });
});

describe('the day its data is deleted on, where a subscription ends at once', () => {
    /** Thirty days from `NOW`, in UTC, the zone of an installation that names none. */
    const COUNTED_FROM_NOW = {
        readOnlyDays: 30,
        readOnlyUntil: '2026-07-14',
        deletesOn: '2026-07-15',
    };
    const endedAtOnceNotices = (notices) =>
        [...notices.rows.values()].filter((row) => row.kind === 'ended-at-once');
    /** The tenant's administrator, as the request carries them. */
    const ADMIN = {
        user: { tenantId: 't1', sub: 'u-admin', email: 'admin@t1.example' },
        headers: {},
    };
    /** The route over `service`, writing its audit entries to `audited`. */
    const routeOver = (service, audited) =>
        new FeatureWithdrawalTenantController(
            service,
            null,
            null,
            (req) => req.user.email,
            () => 's1',
            { log: async (entry) => audited.push(entry) },
        );
    /** A store that cannot record an announcement, and the errors `service` logs. */
    const failingToAnnounce = () => {
        const ends = new FakeSubscriptionEndRepository();
        ends.announce = async () => {
            throw new Error('store unavailable');
        };
        return ends;
    };
    const loggedBy = (service) => {
        const logged = [];
        service.logger.error = (message) => logged.push(message);
        return logged;
    };
    const withoutId = (ends) => ends.announcements.map(({ id: _id, ...kept }) => kept);

    // @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
    test('is stated by the preview and the end, recorded by the end, and named in its notice', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const { service, notices } = await ending({ ends });

        const preview = await service.preview('t1', 'fw-1', null, NOW);
        assert.deepEqual(preview.deletion, COUNTED_FROM_NOW);
        assert.deepEqual(ends.announcements, [], 'a preview records nothing');

        const ended = await service.end('t1', 'fw-1', null, NOW, {
            ...CONFIRMED,
            expectedDeletesOn: '2026-07-15',
        });

        assert.deepEqual(ended.deletion, COUNTED_FROM_NOW);
        assert.deepEqual(withoutId(ends), [
            {
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                endsAt: NOW,
                readOnlyDays: 30,
                deletesOn: '2026-07-15',
                announcedAt: NOW,
                announcedBy: CONFIRMED.by,
                liftedAt: null,
            },
        ]);
        assert.deepEqual(
            endedAtOnceNotices(notices).map((row) => row.content.deletion),
            [COUNTED_FROM_NOW],
        );
    });

    // @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
    test('is none for a booking that ends alone, and none is recorded', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const { service, notices } = await ending({ ends });

        assert.equal((await service.preview('t1', 'fw-1', 'sb-t1', NOW)).deletion, null);
        assert.equal((await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED)).deletion, null);

        assert.deepEqual(ends.announcements, []);
        assert.deepEqual(
            endedAtOnceNotices(notices).map((row) => row.content.deletion),
            [null],
        );
    });

    // @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
    test('is the day the tenant was told when it cancelled for a later date: shown, kept and named', async () => {
        const declared = new Date('2027-01-01T00:00:00.000Z');
        const ends = new FakeSubscriptionEndRepository();
        await ends.announce({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt: declared,
            readOnlyDays: 30,
            deletesOn: '2027-01-31',
            announcedAt: new Date('2026-04-01T00:00:00.000Z'),
            announcedBy: 'web:owner@t1.example:s0',
        });
        const { service, notices } = await ending({
            ends,
            subscription: { canceledAt: new Date('2026-04-01'), canceledEffectiveAt: declared },
        });
        const told = { readOnlyDays: 30, readOnlyUntil: '2027-01-30', deletesOn: '2027-01-31' };

        assert.deepEqual((await service.preview('t1', 'fw-1', null, NOW)).deletion, told);
        const ended = await service.end('t1', 'fw-1', null, NOW, {
            ...CONFIRMED,
            expectedDeletesOn: '2027-01-31',
        });

        assert.deepEqual(ended.deletion, told);
        assert.equal(ends.announcements.length, 1);
        assert.equal(ends.announcements[0].announcedBy, 'web:owner@t1.example:s0', 'kept');
        assert.deepEqual(
            endedAtOnceNotices(notices).map((row) => row.content.deletion),
            [told],
        );
    });

    /** Ends at once after a page that showed `shownDay`, which no longer applies. */
    const askedAgainWhereThePageShowed = async (shownDay) => {
        const ends = new FakeSubscriptionEndRepository();
        const { service, subscription, notices, calls } = await ending({ ends });

        const refusal = await refusalOf(
            service.end('t1', 'fw-1', null, NOW, { ...CONFIRMED, expectedDeletesOn: shownDay }),
        );

        assert.deepEqual(
            [refusal.status, refusal.code, refusal.deletion],
            [409, 'CANCELLATION_TERMS_CHANGED', COUNTED_FROM_NOW],
        );
        assert.deepEqual(calls, [], 'no end, no contract, no credit, no message');
        assert.deepEqual(endedAtOnceNotices(notices), [], 'and no record of the attempt');
        assert.equal(subscription.canceledEffectiveAt, null);
        assert.deepEqual(ends.announcements, []);
    };

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    describe('is asked again, before anything is written, where the page showed', () => {
        test('a day earlier', () => askedAgainWhereThePageShowed('2026-07-14'));
        test('a day later', () => askedAgainWhereThePageShowed('2026-07-16'));
    });

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('is asked again where the page showed a day and none is recorded here', async () => {
        const { service, calls } = await ending();

        const refusal = await refusalOf(
            service.end('t1', 'fw-1', null, NOW, { ...CONFIRMED, expectedDeletesOn: '2026-07-15' }),
        );

        assert.deepEqual([refusal.code, refusal.deletion], ['CANCELLATION_TERMS_CHANGED', null]);
        assert.deepEqual(calls, []);
    });

    // @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
    test('that cannot be recorded leaves the end standing, still credits and tells, logs it once and answers that none is on record', async () => {
        const { service, subscription, calls } = await ending({ ends: failingToAnnounce() });
        const logged = loggedBy(service);

        const ended = await service.end('t1', 'fw-1', null, NOW, CONFIRMED);

        assert.equal(ended.deletion, null);
        assert.equal(subscription.canceledEffectiveAt.toISOString(), NOW.toISOString());
        assert.equal(logged.length, 1);
        assert.match(
            logged[0],
            /deletion day after an end at once failed \(tenant t1\).*store unavailable/s,
        );
        assert.deepEqual(kinds(calls), [
            'credit',
            'cancelSubscription',
            'endContract',
            'invalidate',
            'charge',
            'tell',
        ]);
    });

    // @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('through the route, is checked against the day sent, recorded as told by the administrator, and audited', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const { service } = await ending({ ends });
        const audited = [];
        const route = routeOver(service, audited);

        const refusal = await refusalOf(
            route.end(ADMIN, 'fw-1', { expectedDeletesOn: '2000-01-01' }),
        );
        assert.equal(refusal.code, 'CANCELLATION_TERMS_CHANGED');
        assert.deepEqual(ends.announcements, []);

        const ended = await route.end(ADMIN, 'fw-1', {});

        assert.equal(ends.announcements[0]?.announcedBy, 'web:admin@t1.example:s1');
        assert.deepEqual(
            [audited[0]?.changes.deletesOn, audited[0]?.changes.readOnlyDays],
            [ended.deletion.deletesOn, 30],
        );
    });

    // @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
    // @requirement SC-AUD-021 — An audit entry names the tenant it concerns, so the tenant's deletion takes it along
    test('through the route, where the day cannot be recorded, the end stands, answers, is audited without a day, credits and tells', async () => {
        const { service, subscription, calls } = await ending({ ends: failingToAnnounce() });
        const logged = loggedBy(service);
        const audited = [];

        const ended = await routeOver(service, audited).end(ADMIN, 'fw-1', {});

        assert.equal(ended.deletion, null);
        // The route ends it at the moment of the request, which the answer names.
        assert.equal(subscription.canceledEffectiveAt.toISOString(), ended.endsAt);
        assert.deepEqual(
            audited.map(({ action, tenantId, changes }) => [
                action,
                tenantId,
                changes.deletesOn,
                changes.readOnlyDays,
            ]),
            [['END_SUBSCRIPTION_AT_ONCE', 't1', null, null]],
        );
        assert.deepEqual(
            kinds(calls).filter((kind) => kind === 'charge' || kind === 'tell'),
            ['charge', 'tell'],
        );
        assert.equal(logged.length, 1);
    });

    /** Where midnight falls two hours before it does in UTC, in June. */
    const BERLIN = { timeZone: 'Europe/Berlin' };
    const MINUTES = 60_000;
    const heldSince = async (holds) =>
        (await holds.listOpen('t1'))
            .filter((hold) => hold.kind === 'ended')
            .map((hold) => [hold.reference, hold.since]);

    /**
     * Ends the subscription at once, in an installation in `settings`'s zone,
     * where its day cannot be recorded, and hands back what its page showed,
     * the answer, and the run that finds it afterwards: over the same store,
     * with the reasons that hold its tenant, and the subscription listed as
     * the shipped adapters list it — by its two cancellation dates.
     */
    const endedWithoutADay = async (settings = null) => {
        const ends = failingToAnnounce();
        const holds = new FakeTenantAccessHoldRepository();
        const { service, subscription } = await ending({ ends, settings });
        loggedBy(service);
        const shown = (await service.preview('t1', 'fw-1', null, NOW)).deletion;
        const ended = await service.end('t1', 'fw-1', null, NOW, CONFIRMED);
        const run = new SubscriptionEndService(
            {
                findForTenant: async () => subscription,
                listCancelled: async () => [
                    {
                        tenantId: 't1',
                        subscriptionId: subscription.id,
                        canceledAt: subscription.canceledAt,
                        canceledEffectiveAt: subscription.canceledEffectiveAt,
                    },
                ],
            },
            ends,
            { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] },
            settings ?? {},
            null,
            holds,
        );
        run.onModuleInit();
        return { shown, ended, ends, holds, run };
    };

    // @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
    test('that could not be recorded is given by the run: counted from the day it ended, recorded once, and its tenant held from that moment', async () => {
        const { shown, ended, ends, holds, run } = await endedWithoutADay();

        assert.deepEqual(await run.recordEnded(later(15 * MINUTES)), { ended: 1 });

        assert.equal(ended.deletion, null);
        assert.deepEqual(ends.announcements, [], 'none announced');
        assert.equal(shown.deletesOn, '2026-07-15');
        assert.deepEqual(
            ends.ends.map(({ endsAt, deletesOn }) => [endsAt, deletesOn]),
            [[NOW, '2026-07-15']],
        );
        assert.deepEqual(await heldSince(holds), [['sub-t1', NOW]]);

        assert.deepEqual(await run.recordEnded(later(30 * MINUTES)), { ended: 0 });
        assert.equal(ends.ends.length, 1, 'recorded once');
        assert.deepEqual(await heldSince(holds), [['sub-t1', NOW]], 'held once');
    });

    // @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
    test('that could not be recorded, given by a run after midnight in the zone, is a day later than its page showed: the gap keeps the data longer, never shorter', async () => {
        const { shown, ends, holds, run } = await endedWithoutADay(BERLIN);

        // 00:05 on 16 June in Berlin, while it is still 15 June in UTC.
        await run.recordEnded(new Date('2026-06-15T22:05:00.000Z'));

        assert.equal(shown.deletesOn, '2026-07-15');
        assert.equal(ends.ends[0]?.deletesOn, '2026-07-16');
        assert.deepEqual(await heldSince(holds), [['sub-t1', NOW]], 'held from when it ended');
    });
});

// @requirement SC-BUN-062 — An add-on that grants a withdrawn feature can be ended at once on its own
describe('ending a booking at once', () => {
    test('ends it alone, now, writes the contract again and credits its unused rest', async () => {
        const { service, bookings, subscription, calls } = await ending();
        const ended = await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);
        assert.equal(ended.subscriptionBundleId, 'sb-t1');
        assert.equal(ended.creditNet, 6.67);
        assert.deepEqual(calls[2], [
            'cancelBooking',
            'sb-t1',
            { canceledAt: NOW, canceledEffectiveAt: NOW },
        ]);
        assert.deepEqual(kinds(calls), [
            'assertParty',
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
        await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);
        assert.deepEqual(calls[2], [
            'endBookingNow',
            'sb-t1',
            { at: NOW, expectedCanceledEffectiveAt: declared },
        ]);
    });

    test('is refused for a booking it did not reach, or whose version no longer grants it', async () => {
        const other = await ending({ bookings: [booking({ id: 'sb-other' })] });
        assert.equal(
            (await refusalOf(other.service.end('t1', 'fw-1', 'sb-other', NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
        const switched = await ending({ bookings: [booking({ bundleVersionId: 'bv-lite' })] });
        assert.equal(
            (await refusalOf(switched.service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_DOES_NOT_REACH',
        );
    });

    test('is refused once the booking has ended', async () => {
        const { service } = await ending({
            bookings: [booking({ canceledAt: NOW, canceledEffectiveAt: NOW })],
        });
        assert.equal(
            (await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED))).code,
            'FEATURE_WITHDRAWAL_ALREADY_ENDED',
        );
    });
});

// @requirement SC-BUN-067 — An add-on ended at once and the contract without it are one
describe('an add-on ended at once, and the contract without it', () => {
    /** A refusal of the contract's own, as the freeze or its check raises it. */
    const refusedBecause = (code) => {
        throw new UnprocessableEntityException({ code, message: code, params: {} });
    };
    const storeDown = async () => {
        throw new Error('database gone');
    };
    const loggedBy = (service) => {
        const logged = [];
        service.logger.error = (message) => logged.push(message);
        return logged;
    };
    const recorded = (notices) =>
        [...notices.rows.values()].filter((row) => row.kind === 'ended-at-once');

    /**
     * Whether the add-on's feature is granted after the attempt, read the way
     * the entitlements read it: first from the contract in force — the one
     * naming the add-on, since no other was written — then from the bookings
     * running. On a plan that does not grant it.
     */
    async function exportGrantedAfter(bookings) {
        const running = bookings.filter(
            (one) => one.canceledEffectiveAt === null || one.canceledEffectiveAt > NOW,
        );
        const service = entitlementServiceFor(
            EntitlementService,
            usageRecord({ id: 'sub-t1', plan: 'STARTER', status: 'ACTIVE' }),
            {
                contract: {
                    id: 'c-in-force',
                    tenantId: 't1',
                    status: 'active',
                    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                    effectiveUntil: null,
                    originalBundleVersionIds: ['bv-export-1'],
                    lineItems: [
                        {
                            kind: 'bundle',
                            sourceKey: 'EXPORT_PLUS',
                            sourceVersionId: 'bv-export-1',
                            featuresSnapshot: ['EXPORT'],
                            quotaEffectsSnapshot: {},
                        },
                    ],
                    entitlementSnapshot: {
                        plan: 'STARTER',
                        quotas: {},
                        features: ['READ_ONLY', 'EXPORT'],
                    },
                },
                bundles: running,
                versions: { 'bv-export-1': { features: ['EXPORT'] } },
            },
        );
        return (await service.computeLimits('t1')).features.has('EXPORT');
    }

    test('asks its party first, for the contract the end writes: from now, until the subscription ends', async () => {
        const declared = new Date('2026-12-01T00:00:00.000Z');
        const { service, calls } = await ending({
            subscription: { canceledAt: new Date('2026-05-01'), canceledEffectiveAt: declared },
        });

        await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);

        assert.deepEqual(calls[0], [
            'assertParty',
            { effectiveFrom: NOW, cycle: 'MONTHLY', endsAt: declared },
        ]);
        assert.ok(kinds(calls).indexOf('assertParty') < kinds(calls).indexOf('cancelBooking'));
    });

    test('asks the subscriber alone in a trial, which commits to no period', async () => {
        const { service, calls } = await ending({ subscription: { status: 'TRIAL' } });

        await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);

        assert.deepEqual(calls[0], ['assertParty', null]);
    });

    test('whose party is refused before it is written refuses the end with that reason, and nothing is written', async () => {
        const { service, bookings, notices, calls } = await ending({
            contractFreeze: {
                assertPartyFor: async () => refusedBecause('TAX_TREATMENT_NOT_SUPPORTED'),
            },
        });

        const refusal = await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED));

        assert.equal(refusal.code, 'TAX_TREATMENT_NOT_SUPPORTED');
        assert.equal(bookings[0].canceledEffectiveAt, null, 'the booking runs on');
        assert.deepEqual(recorded(notices), [], 'no end recorded');
        assert.deepEqual(kinds(calls), [], 'nothing ended, credited or told');
    });

    test('whose party is refused refuses the preview the same', async () => {
        const { service, calls } = await ending({
            contractFreeze: {
                assertPartyFor: async () => refusedBecause('SUBSCRIBER_REQUIRED'),
            },
        });

        const refusal = await refusalOf(service.preview('t1', 'fw-1', 'sb-t1', NOW));

        assert.equal(refusal.code, 'SUBSCRIBER_REQUIRED');
        assert.deepEqual(kinds(calls), []);
    });

    test('of an add-on the source can no longer price is still ended, and the contract written after it names it no more', async () => {
        const bookings = [booking()];
        const written = [];
        const freeze = new SubscriptionContractFreezeService(
            givenPlanCatalogSource(CATALOG),
            {
                invalidateTenant() {},
                async computeContractLimits() {
                    return {
                        limits: { plan: 'PRO', quotas: {}, features: new Set() },
                        leftOutBundleVersionIds: [],
                    };
                },
            },
            {
                async assertPartyFor() {},
                async writeSuccessor(previous, data) {
                    written.push(data);
                    return { id: 'c-without-the-add-on' };
                },
                async findActiveByTenantId() {
                    return null;
                },
            },
            {
                findBoundPlanVersion: async () => boundPlanVersion(CATALOG.plans[0], 'pv-pro-1'),
                // Prices every add-on running, and finds no price for this one's version any more.
                loadBookedBundles: async () => {
                    const running = bookings.filter((one) => one.canceledEffectiveAt === null);
                    if (running.length > 0) {
                        throw new Error(
                            `No price for add-on version ${running[0].bundleVersionId}`,
                        );
                    }
                    return { lineItems: [], bundleVersionIds: [] };
                },
            },
            undefined,
            null,
            null,
            null,
            null,
        );
        const { service } = await ending({ bookings, freeze });

        const ended = await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);

        assert.equal(ended.endsAt, NOW.toISOString());
        assert.equal(bookings[0].canceledEffectiveAt.toISOString(), NOW.toISOString());
        assert.equal(written.length, 1, 'the contract without it is written');
        assert.deepEqual(
            written[0].lineItems.map((line) => [line.kind, line.sourceVersionId]),
            [['plan', 'pv-pro-1']],
        );
    });

    test('the store fails to write puts the booking back as it was read, and refuses the end with a code', async () => {
        const { service, bookings, calls } = await ending({
            contractFreeze: { freezeOnPlanChange: storeDown },
        });
        const logged = loggedBy(service);

        const refusal = await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED));

        assert.deepEqual(
            [refusal.status, refusal.code],
            [503, 'FEATURE_WITHDRAWAL_END_CONTRACT_NOT_WRITTEN'],
        );
        assert.deepEqual(calls.at(-2), [
            'putBookingBack',
            'sb-t1',
            { endedAt: NOW, canceledAt: null, canceledEffectiveAt: null },
        ]);
        assert.deepEqual(calls.at(-1), ['invalidate', 't1'], 'the entitlements read it again');
        assert.equal(bookings[0].canceledAt, null);
        assert.equal(bookings[0].canceledEffectiveAt, null, 'the booking runs on');
        assert.ok(!kinds(calls).includes('charge'), 'nothing credited');
        assert.ok(!kinds(calls).includes('tell'), 'nobody told of an end that did not happen');
        assert.equal(logged.length, 1);
        assert.match(logged[0], /sb-t1.*tenant t1.*put back.*database gone/s);
    });

    test('put back, it runs on, so the contract that still names it grants nothing it does not have', async () => {
        const { service, bookings } = await ending({
            contractFreeze: { freezeOnPlanChange: storeDown },
        });
        loggedBy(service);

        await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED));

        const runs = bookings[0].canceledEffectiveAt === null;
        assert.equal(await exportGrantedAfter(bookings), runs);
        assert.ok(runs, 'and it runs');
    });

    test('one cancelled for a later date is put back on that cancellation', async () => {
        const declaredAt = new Date('2026-06-10T00:00:00.000Z');
        const declared = new Date('2026-07-01T00:00:00.000Z');
        const { service, bookings } = await ending({
            bookings: [booking({ canceledAt: declaredAt, canceledEffectiveAt: declared })],
            contractFreeze: { freezeOnPlanChange: storeDown },
        });
        loggedBy(service);

        const refusal = await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED));

        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_END_CONTRACT_NOT_WRITTEN');
        assert.deepEqual(
            [bookings[0].canceledAt, bookings[0].canceledEffectiveAt],
            [declaredAt, declared],
        );
    });

    test('refused after the end with a reason of its own is put back and refused with that reason', async () => {
        const { service, bookings } = await ending({
            contractFreeze: {
                freezeOnPlanChange: async () => refusedBecause('SUBSCRIBER_REQUIRED'),
            },
        });
        loggedBy(service);

        const refusal = await refusalOf(service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED));

        assert.equal(refusal.code, 'SUBSCRIBER_REQUIRED');
        assert.equal(bookings[0].canceledEffectiveAt, null, 'put back');
    });

    describe('where the booking cannot be put back', () => {
        /** Ends with a contract the store fails to write, over the booking store given. */
        async function endStands(bookingStore) {
            const { service, bookings, calls } = await ending({
                bookingStore,
                contractFreeze: { freezeOnPlanChange: storeDown },
            });
            const logged = loggedBy(service);

            const ended = await service.end('t1', 'fw-1', 'sb-t1', NOW, CONFIRMED);

            assert.equal(ended.endsAt, NOW.toISOString());
            assert.equal(bookings[0].canceledEffectiveAt.toISOString(), NOW.toISOString());
            assert.deepEqual(kinds(calls).slice(-3), ['invalidate', 'charge', 'tell']);
            assert.equal(logged.length, 1);
            assert.match(logged[0], /sb-t1.*tenant t1.*without its contract.*database gone/s);
        }

        test('because it ends otherwise by now, the end stands, is credited and told, and the log names the booking', () =>
            endStands({ restoreCancellation: async () => null }));

        test('because the store fails again, the end stands, is credited and told, and the log names the booking', () =>
            endStands({ restoreCancellation: storeDown }));

        test('because the store cannot put a booking back, the end stands, is credited and told, and the log names the booking', () =>
            endStands({ restoreCancellation: undefined }));
    });
});

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server
describe('the days a tenant is shown of a withdrawal', () => {
    const BERLIN = { timeZone: 'Europe/Berlin' };
    /** Midnight before 1 July in Berlin: still 30 June in UTC. */
    const MIDNIGHT_IN_BERLIN = new Date('2026-06-30T22:00:00.000Z');
    const AROUND_MIDNIGHT = { until: '2026-06-30', from: '2026-07-01' };
    /** Midnight before 1 September in Berlin. */
    const RETURNS = new Date('2026-08-31T22:00:00.000Z');

    test('are read in the zone the settings name, from when it is missing and from when it returns', async () => {
        const { service } = await ending({
            settings: BERLIN,
            withdrawals: [withdrawal({ effectiveFrom: MIDNIGHT_IN_BERLIN, liftedFrom: RETURNS })],
        });
        const [view] = await service.withdrawalsOf('t1', NOW);
        assert.deepEqual(view.effectiveFromDays, AROUND_MIDNIGHT);
        assert.deepEqual(view.liftedFromDays, { until: '2026-08-31', from: '2026-09-01' });
    });

    test('in UTC where the settings name none', async () => {
        const { service } = await ending({
            withdrawals: [withdrawal({ effectiveFrom: MIDNIGHT_IN_BERLIN })],
        });
        const [view] = await service.withdrawalsOf('t1', NOW);
        assert.deepEqual(view.effectiveFromDays, { until: '2026-06-30', from: '2026-06-30' });
        assert.equal(view.liftedFromDays, null, 'and none for a withdrawal not lifted');
    });

    // @requirement SC-SUB-043 — A withdrawal reaches the line a change scheduled before it brings a subscription to
    test('name the days of when a scheduled change brings a line, in that zone', async () => {
        const yearly = { ...told().lines[0], billingCycle: 'YEARLY', reductionNet: 40 };
        const { service } = await ending({
            settings: BERLIN,
            subscription: {
                plan: 'BASIC',
                pendingPlan: 'PRO',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: MIDNIGHT_IN_BERLIN,
            },
            notice: told({ lines: [yearly] }),
            bookings: [],
            planGrants: [],
        });
        const [view] = await service.withdrawalsOf('t1', NOW);
        assert.deepEqual(view.lines[0].fromChangeDays, AROUND_MIDNIGHT);
    });

    test('a refusal for a cancellation on record names the day it lands and the last day it runs', async () => {
        const { service } = await ending({
            settings: BERLIN,
            subscription: {
                canceledAt: new Date('2026-04-01'),
                // Midnight before 1 January in Berlin: still 31 December in UTC.
                canceledEffectiveAt: new Date('2026-12-31T23:00:00.000Z'),
            },
            writes: { endNow: undefined },
        });
        const refusal = await refusalOf(service.end('t1', 'fw-1', null, NOW, CONFIRMED));
        assert.deepEqual(refusal.params, { date: '2027-01-01', lastDay: '2026-12-31' });
        assert.deepEqual(refusal.dayParams, ['date', 'lastDay']);
    });

    test('and says it runs until that day, where the cancellation lands in the middle of one', async () => {
        // A minimum term keeps the time of day the booking was made: this one
        // lands at 14:37 on 1 December, so 1 December is both days, and the
        // sentence may not promise the end of it.
        const { service } = await ending({
            subscription: {
                canceledAt: new Date('2026-04-01'),
                canceledEffectiveAt: new Date('2026-12-01T14:37:00.000Z'),
            },
            writes: { endNow: undefined },
        });
        const refusal = await refusalOf(service.end('t1', 'fw-1', null, NOW, CONFIRMED));
        const english =
            'Your cancellation is recorded and cannot be brought forward here: it runs until 2026-12-01, and until then the reduction applies.';
        assert.deepEqual(refusal.params, { date: '2026-12-01', lastDay: '2026-12-01' });
        assert.equal(resolveErrorMessage(refusal, {}, ERROR_MESSAGES_EN), english);
        assert.equal(
            resolveErrorMessage(refusal, {}, ERROR_MESSAGES_DE),
            'Ihre Kündigung ist erfasst und kann hier nicht vorgezogen werden: Es läuft bis 2026-12-01, und bis dahin gilt die Minderung.',
        );
        assert.equal(refusal.message, english, 'and the English diagnostic says the same');
    });

    test('of an end at once are the days around the moment it ends, previewed and done', async () => {
        const previewed = await ending({ settings: BERLIN });
        const preview = await previewed.service.preview('t1', 'fw-1', null, MIDNIGHT_IN_BERLIN);
        assert.deepEqual(preview.endsDays, AROUND_MIDNIGHT);

        const done = await ending({ settings: BERLIN });
        const ended = await done.service.end('t1', 'fw-1', null, MIDNIGHT_IN_BERLIN, CONFIRMED);
        assert.deepEqual(ended.endsDays, AROUND_MIDNIGHT);
    });
});
