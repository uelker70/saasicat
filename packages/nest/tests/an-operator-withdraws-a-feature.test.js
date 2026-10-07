import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ACTOR,
    NOW,
    addOnVersion,
    bookingOf,
    codesOf,
    contractOf,
    planLine,
    planVersion,
    refusalOf,
    subscriptionOf,
    withdrawalRecord,
    withdrawalStore,
    withdrawing,
} from './helpers/feature-withdrawal-fixtures.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';
import { PublicCatalogController, givenPlanCatalogSource } from '../dist/billing/index.js';

const ms = (date, delta) => new Date(date.getTime() + delta);
const DATE = new Date('2026-07-01T00:00:00.000Z');

/** What the operator announces for EXPORT from 1 July, after the preview of `service`. */
async function announcement(service, overrides = {}) {
    const preview = await service.preview('EXPORT', DATE, NOW);
    return {
        featureKey: 'EXPORT',
        reason: 'The export service has been switched off.',
        effectiveFrom: DATE,
        reductions: [{ kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 5 }],
        subscriptionIds: preview.reached.map((row) => row.subscriptionId),
        ...overrides,
    };
}

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('the preview of a withdrawal', () => {
    test('refuses a feature the catalogue does not know, before anything is read', async () => {
        const { service } = withdrawing({
            usage: {
                listBoundToVersion: async () => {
                    throw new Error('read');
                },
            },
        });
        const refusal = await refusalOf(service.preview('NO_SUCH_FEATURE', null, NOW));
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_FEATURE_UNKNOWN');
        assert.deepEqual(refusal.params, { featureKey: 'NO_SUCH_FEATURE' });
    });

    test('refuses a date before now, and takes now and a date ahead', async () => {
        const { service } = withdrawing();
        const refusal = await refusalOf(service.preview('EXPORT', ms(NOW, -1), NOW));
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_DATE_IN_PAST');
        assert.equal((await service.preview('EXPORT', NOW, NOW)).effectiveFrom, NOW.toISOString());
        assert.equal(
            (await service.preview('EXPORT', null, NOW)).effectiveFrom,
            NOW.toISOString(),
            'no date is now',
        );
        assert.equal(
            (await service.preview('EXPORT', DATE, NOW)).effectiveFrom,
            DATE.toISOString(),
        );
    });

    test('reaches a subscription on a plan version that grants the feature, with its line', async () => {
        const { service } = withdrawing({
            subscriptions: [
                subscriptionOf('t1'),
                subscriptionOf('t2', {
                    planVersion: { id: 'pv-basic-1', planId: 'BASIC', version: 1 },
                }),
            ],
            planVersions: [
                planVersion('pv-pro-1'),
                planVersion('pv-basic-1', { planId: 'BASIC', features: ['REPORTS'] }),
            ],
        });
        const preview = await service.preview('EXPORT', DATE, NOW);
        assert.deepEqual(preview.feature, { key: 'EXPORT', label: 'Data export' });
        assert.deepEqual(preview.reached, [
            {
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                status: 'ACTIVE',
                lines: [
                    {
                        line: 'plan',
                        key: 'PRO',
                        label: 'Pro',
                        subscriptionBundleId: null,
                        billingCycle: 'MONTHLY',
                        priceNet: 49,
                    },
                ],
                specialTerms: false,
            },
        ]);
        assert.deepEqual(
            preview.skipped,
            [],
            'Basic does not grant it, so it is not a subscription the withdrawal concerns',
        );
    });

    test('reaches through an old key a replaces chain carries to the feature', async () => {
        const { service } = withdrawing({
            planVersions: [planVersion('pv-pro-1', { features: ['OLD_EXPORT'] })],
            replaces: { OLD_EXPORT: 'EXPORT' },
        });
        const preview = await service.preview('EXPORT', DATE, NOW);
        assert.deepEqual(
            preview.reached.map((row) => row.subscriptionId),
            ['sub-t1'],
        );
    });

    test('does not count a draft that grants the feature', async () => {
        const { service } = withdrawing({
            planVersions: [planVersion('pv-pro-1', { publishedAt: null })],
        });
        assert.deepEqual((await service.preview('EXPORT', DATE, NOW)).reached, []);
    });

    test('reaches each booking of an add-on version that grants it, in its rhythm and price', async () => {
        const { service } = withdrawing({
            subscriptions: [
                subscriptionOf('t1', {
                    plan: 'BASIC',
                    planVersion: { id: 'pv-basic-1', planId: 'BASIC', version: 1 },
                }),
                subscriptionOf('t2', {
                    plan: 'BASIC',
                    planVersion: { id: 'pv-basic-1', planId: 'BASIC', version: 1 },
                }),
            ],
            planVersions: [planVersion('pv-basic-1', { planId: 'BASIC', features: ['REPORTS'] })],
            addOnVersions: [
                addOnVersion('bv-export-1', {
                    pricingOverrides: [{ planId: 'BASIC', monthlyNet: '8.00' }],
                }),
            ],
            bookings: [bookingOf('t1'), bookingOf('t2', { billingCycle: 'YEARLY' })],
        });
        const preview = await service.preview('EXPORT', DATE, NOW);
        assert.deepEqual(
            preview.reached.map((row) => row.lines),
            [
                [
                    {
                        line: 'bundle',
                        key: 'EXPORT_PLUS',
                        label: 'Export plus',
                        subscriptionBundleId: 'sb-t1',
                        billingCycle: 'MONTHLY',
                        priceNet: 8,
                    },
                ],
                [
                    {
                        line: 'bundle',
                        key: 'EXPORT_PLUS',
                        label: 'Export plus',
                        subscriptionBundleId: 'sb-t2',
                        billingCycle: 'YEARLY',
                        priceNet: 100,
                    },
                ],
            ],
        );
    });

    test('leaves out a booking that ends by the date, and skips a subscription that does', async () => {
        const { service } = withdrawing({
            subscriptions: [
                subscriptionOf('t1'),
                subscriptionOf('t2', {
                    canceledAt: new Date('2026-05-01'),
                    canceledEffectiveAt: DATE,
                }),
                subscriptionOf('t3', {
                    canceledAt: new Date('2026-05-01'),
                    canceledEffectiveAt: ms(DATE, 1),
                }),
            ],
            bookings: [
                bookingOf('t1', { canceledAt: new Date('2026-05-01'), canceledEffectiveAt: DATE }),
            ],
        });
        const preview = await service.preview('EXPORT', DATE, NOW);
        assert.deepEqual(
            preview.reached.map((row) => [row.subscriptionId, row.lines.map((line) => line.line)]),
            [
                ['sub-t1', ['plan']],
                ['sub-t3', ['plan']],
            ],
            'the booking ending on the date is no line; a subscription ending a moment after is reached',
        );
        assert.deepEqual(preview.skipped, [
            { tenantId: 't2', subscriptionId: 'sub-t2', reason: 'ends-before' },
        ]);
    });

    test('reads the plan line from the contract in force, which is what is granted', async () => {
        const { service } = withdrawing({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            contracts: [
                contractOf('t1', {
                    lineItems: [planLine({ featuresSnapshot: ['REPORTS'] })],
                    features: ['REPORTS'],
                }),
                contractOf('t2', {
                    lineItems: [planLine({ priceNet: 45, titleSnapshot: 'Pro (2025)' })],
                    features: ['EXPORT', 'REPORTS'],
                }),
            ],
        });
        const preview = await service.preview('EXPORT', DATE, NOW);
        assert.deepEqual(
            preview.reached.map((row) => [row.subscriptionId, row.lines]),
            [
                [
                    'sub-t2',
                    [
                        {
                            line: 'plan',
                            key: 'PRO',
                            label: 'Pro (2025)',
                            subscriptionBundleId: null,
                            billingCycle: 'MONTHLY',
                            priceNet: 45,
                        },
                    ],
                ],
            ],
            "a contract frozen without the feature does not hold it, whatever the version's row says",
        );
    });

    test('reaches special terms a contract in force records where no line grants the feature', async () => {
        const { service } = withdrawing({
            subscriptions: [
                subscriptionOf('t1', {
                    planVersion: { id: 'pv-basic-1', planId: 'BASIC', version: 1 },
                }),
            ],
            planVersions: [planVersion('pv-basic-1', { planId: 'BASIC', features: ['REPORTS'] })],
            contracts: [
                contractOf('t1', {
                    lineItems: [planLine({ sourceKey: 'BASIC', featuresSnapshot: ['REPORTS'] })],
                    features: ['REPORTS', 'EXPORT'],
                }),
            ],
        });
        const [row] = (await service.preview('EXPORT', DATE, NOW)).reached;
        assert.deepEqual(row, {
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            status: 'ACTIVE',
            lines: [],
            specialTerms: true,
        });
    });

    test('names each plan and add-on in a rhythm it reaches, with how many and the lowest price', async () => {
        const { service } = withdrawing({
            subscriptions: [
                subscriptionOf('t1'),
                subscriptionOf('t2', {
                    planVersion: { id: 'pv-pro-2', planId: 'PRO', version: 2 },
                }),
                subscriptionOf('t3', { billingCycle: 'YEARLY' }),
            ],
            planVersions: [
                planVersion('pv-pro-1'),
                planVersion('pv-pro-2', { monthlyNet: '39.00' }),
            ],
            bookings: [bookingOf('t1')],
        });
        assert.deepEqual((await service.preview('EXPORT', DATE, NOW)).targets, [
            {
                kind: 'bundle',
                key: 'EXPORT_PLUS',
                label: 'Export plus',
                billingCycle: 'MONTHLY',
                lines: 1,
                lowestPriceNet: 10,
            },
            {
                kind: 'plan',
                key: 'PRO',
                label: 'Pro',
                billingCycle: 'MONTHLY',
                lines: 2,
                lowestPriceNet: 39,
            },
            {
                kind: 'plan',
                key: 'PRO',
                label: 'Pro',
                billingCycle: 'YEARLY',
                lines: 1,
                lowestPriceNet: 490,
            },
        ]);
    });

    test('is blocked while a withdrawal of the feature is not lifted, or lifted only after the date', async () => {
        const blockedBy = async (existing, date = DATE) =>
            codesOf(
                await withdrawing({ withdrawals: withdrawalStore(existing) }).service.preview(
                    'EXPORT',
                    date,
                    NOW,
                ),
            );
        assert.deepEqual(await blockedBy([withdrawalRecord()]), ['FEATURE_WITHDRAWAL_OPEN']);
        assert.deepEqual(await blockedBy([withdrawalRecord({ liftedFrom: ms(DATE, 1) })]), [
            'FEATURE_WITHDRAWAL_OVERLAPS',
        ]);
        assert.deepEqual(
            await blockedBy([withdrawalRecord({ liftedFrom: DATE })]),
            [],
            'lifted on the date',
        );
        assert.deepEqual(
            await blockedBy([
                withdrawalRecord({
                    effectiveFrom: new Date('2026-09-01'),
                    liftedFrom: new Date('2026-08-01'),
                }),
            ]),
            [],
            'one lifted before its own date never takes the feature away',
        );
        assert.deepEqual(await blockedBy([withdrawalRecord({ featureKey: 'REPORTS' })]), []);
        const overlap = (
            await withdrawing({
                withdrawals: withdrawalStore([
                    withdrawalRecord({ liftedFrom: new Date('2026-08-01') }),
                ]),
            }).service.preview('EXPORT', DATE, NOW)
        ).blockers[0];
        assert.deepEqual(overlap.params, { featureKey: 'EXPORT', date: '2026-08-01' });
    });
});

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('where withdrawing a feature is offered', () => {
    test('only where everybody a withdrawal reaches can be found', () => {
        assert.equal(withdrawing().service.available, true);
        assert.equal(
            withdrawing({ withBookings: false }).service.available,
            true,
            'nothing books add-ons',
        );
        assert.equal(
            withdrawing({ usage: { listBoundToVersion: undefined } }).service.available,
            false,
        );
        assert.equal(withdrawing({ usage: { listByIds: undefined } }).service.available, false);
        assert.equal(
            withdrawing({ bookingStore: { listOfVersion: undefined } }).service.available,
            false,
        );
    });

    test('and is refused by the routes elsewhere, before anything is read', async () => {
        const { service } = withdrawing({ usage: { listByIds: undefined } });
        assert.equal(
            (await refusalOf(service.preview('EXPORT', DATE, NOW))).code,
            'FEATURE_WITHDRAWAL_UNAVAILABLE',
        );
        assert.equal(
            (await refusalOf(service.lift('fw-1', null, ACTOR, NOW))).code,
            'FEATURE_WITHDRAWAL_UNAVAILABLE',
        );
    });
});

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('announcing a withdrawal', () => {
    test('records it with a notice for each subscription in one transaction, then tells each', async () => {
        const harness = withdrawing({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            bookings: [bookingOf('t2')],
        });
        const { withdrawal, told, failed } = await harness.service.announce(
            await announcement(harness.service, {
                reductions: [
                    { kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 5 },
                    { kind: 'bundle', key: 'EXPORT_PLUS', billingCycle: 'MONTHLY', amountNet: 2.5 },
                ],
            }),
            ACTOR,
            NOW,
        );
        assert.equal(withdrawal.featureKey, 'EXPORT');
        assert.equal(
            withdrawal.effectiveFrom,
            DATE.toISOString(),
            'dated as the response carries it',
        );
        assert.equal(withdrawal.announcedBy, 'web:ops@example.com:admin');
        assert.deepEqual(harness.withdrawals.createdIn, [harness.tx]);
        assert.deepEqual(
            harness.notices.recordedIn,
            [harness.tx],
            'notices on the same transaction',
        );
        assert.deepEqual([told, failed], [2, 0]);
        assert.equal(harness.invalidations, 1, 'every cached grant is read again');
        const sent = harness.port.sent.find((notice) => notice.subscriptionId === 'sub-t2');
        assert.deepEqual(sent, {
            kind: 'feature-withdrawn',
            tenantId: 't2',
            subscriptionId: 'sub-t2',
            withdrawalId: withdrawal.id,
            featureKey: 'EXPORT',
            featureLabel: 'Data export',
            reason: 'The export service has been switched off.',
            effectiveFrom: DATE.toISOString(),
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
                    subscriptionBundleId: 'sb-t2',
                    billingCycle: 'MONTHLY',
                    reductionNet: 2.5,
                },
            ],
            specialTerms: false,
        });
        assert.deepEqual(
            harness.audited.map((entry) => [
                entry.action,
                entry.entityId,
                entry.changes.subscriptions,
            ]),
            [['FEATURE_WITHDRAW', withdrawal.id, 2]],
        );
    });

    test('writes the reductions into the contract of each subscription with a line reduced', async () => {
        const written = [];
        const harness = withdrawing({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2', { billingCycle: 'YEARLY' })],
            contractReductions: {
                recordReductions: async (tenantId, at) => {
                    written.push([tenantId, at.toISOString()]);
                    return 'written';
                },
            },
        });
        await harness.service.announce(await announcement(harness.service), ACTOR, NOW);
        assert.deepEqual(written, [['t1', NOW.toISOString()]], 'no reduction was named for yearly');
    });

    test('stands where writing a contract fails, which the journal does before it charges', async () => {
        const harness = withdrawing({
            contractReductions: {
                recordReductions: async () => {
                    throw new Error('database gone');
                },
            },
        });
        const { withdrawal, told } = await harness.service.announce(
            await announcement(harness.service),
            ACTOR,
            NOW,
        );
        assert.equal(withdrawal.featureKey, 'EXPORT');
        assert.equal(told, 1, 'and the subscriber is told');
    });

    test('tells a line no reduction was named for that none applies', async () => {
        const harness = withdrawing({
            subscriptions: [subscriptionOf('t1', { billingCycle: 'YEARLY' })],
        });
        await harness.service.announce(
            await announcement(harness.service, { reductions: [] }),
            ACTOR,
            NOW,
        );
        assert.equal(harness.port.sent[0].lines[0].reductionNet, null);
    });

    test('refuses what is blocked, and keeps nothing', async () => {
        const harness = withdrawing({ withdrawals: withdrawalStore([withdrawalRecord()]) });
        const refusal = await refusalOf(
            harness.service.announce(await announcement(harness.service), ACTOR, NOW),
        );
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_OPEN');
        assert.equal(harness.withdrawals.rows.length, 1);
        assert.equal(harness.notices.rows.size, 0);
    });

    test('refuses a reduction for nothing it reaches, one named twice, or one above the lowest price', async () => {
        const refusedWith = async (reductions) => {
            const harness = withdrawing();
            const refusal = await refusalOf(
                harness.service.announce(
                    await announcement(harness.service, { reductions }),
                    ACTOR,
                    NOW,
                ),
            );
            assert.equal(harness.withdrawals.rows.length, 0, 'nothing is kept');
            return [refusal.code, refusal.params];
        };
        const plan = (fields) => ({
            kind: 'plan',
            key: 'PRO',
            billingCycle: 'MONTHLY',
            amountNet: 5,
            ...fields,
        });
        assert.deepEqual(await refusedWith([plan({ billingCycle: 'YEARLY' })]), [
            'FEATURE_WITHDRAWAL_REDUCTION_NOT_REACHED',
            { kind: 'plan', key: 'PRO', billingCycle: 'YEARLY' },
        ]);
        assert.deepEqual(
            (await refusedWith([plan({ kind: 'bundle' })]))[0],
            'FEATURE_WITHDRAWAL_REDUCTION_NOT_REACHED',
        );
        assert.deepEqual(
            (await refusedWith([plan(), plan({ amountNet: 4 })]))[0],
            'FEATURE_WITHDRAWAL_REDUCTION_NAMED_TWICE',
        );
        assert.deepEqual(await refusedWith([plan({ amountNet: 49.01 })]), [
            'FEATURE_WITHDRAWAL_REDUCTION_EXCEEDS_PRICE',
            { key: 'PRO', billingCycle: 'MONTHLY', price: 49 },
        ]);
    });

    test('takes a reduction of the whole lowest price', async () => {
        const harness = withdrawing();
        const { withdrawal } = await harness.service.announce(
            await announcement(harness.service, {
                reductions: [{ kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 49 }],
            }),
            ACTOR,
            NOW,
        );
        assert.deepEqual(withdrawal.reductions, [
            { kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 49 },
        ]);
    });

    test('refuses when the subscriptions it reaches are not the ones shown', async () => {
        const harness = withdrawing({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
        });
        const refusal = await refusalOf(
            harness.service.announce(
                await announcement(harness.service, { subscriptionIds: ['sub-t1'] }),
                ACTOR,
                NOW,
            ),
        );
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_PREVIEW_CHANGED');
        assert.deepEqual(
            refusal.preview.reached.map((row) => row.subscriptionId),
            ['sub-t1', 'sub-t2'],
        );
        assert.equal(harness.withdrawals.rows.length, 0);
    });

    test('lands once where another announcement got there first, and keeps nothing of its own', async () => {
        const withdrawals = withdrawalStore();
        const harness = withdrawing({ withdrawals });
        const input = await announcement(harness.service);
        // Another operator's withdrawal landed between this one's read and its
        // write: the database answers this one's insert with no row.
        withdrawals.create = async () => null;
        const refusal = await refusalOf(harness.service.announce(input, ACTOR, NOW));
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_OPEN');
        assert.equal(harness.notices.rows.size, 0, 'no notice of the one that did not land');
        assert.deepEqual(harness.port.sent, [], 'and nobody told');
        assert.equal(harness.invalidations, 0);
    });

    test('leaves a notice it could not send for the next run', async () => {
        const harness = withdrawing({
            port: sendingPort(() => {
                throw new Error('mail server down');
            }),
        });
        const { told, failed } = await harness.service.announce(
            await announcement(harness.service),
            ACTOR,
            NOW,
        );
        assert.deepEqual([told, failed], [0, 1]);
        const retried = withdrawing({ notices: harness.notices, withdrawals: harness.withdrawals });
        assert.deepEqual(await retried.service.sendUndelivered(ms(NOW, 60 * 60_000)), {
            told: 1,
            failed: 0,
        });
        assert.equal(retried.port.sent[0].kind, 'feature-withdrawn');
    });
});

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('lifting a withdrawal', () => {
    async function announced(options = {}) {
        const harness = withdrawing(options);
        const { withdrawal } = await harness.service.announce(
            await announcement(harness.service),
            ACTOR,
            NOW,
        );
        harness.port.sent.length = 0;
        harness.audited.length = 0;
        // Assigned, not spread: a spread would copy the count as it stands now.
        return Object.assign(harness, { withdrawal });
    }

    test('records the date, tells every subscription it reached that still runs', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const harness = await announced({ subscriptions });
        // t2 ended at once meanwhile.
        subscriptions[1].subscription.canceledAt = NOW;
        subscriptions[1].subscription.canceledEffectiveAt = NOW;
        const later = ms(NOW, 60_000);

        const { withdrawal, told } = await harness.service.lift(
            harness.withdrawal.id,
            new Date('2026-08-01T00:00:00.000Z'),
            ACTOR,
            later,
        );

        assert.equal(withdrawal.liftedFrom, '2026-08-01T00:00:00.000Z');
        assert.equal(withdrawal.liftedAt, later.toISOString());
        assert.equal(withdrawal.liftedBy, 'web:ops@example.com:admin');
        assert.equal(told, 1);
        assert.deepEqual(harness.port.sent, [
            {
                kind: 'feature-withdrawal-lifted',
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                withdrawalId: harness.withdrawal.id,
                featureKey: 'EXPORT',
                featureLabel: 'Data export',
                liftedFrom: '2026-08-01T00:00:00.000Z',
            },
        ]);
        assert.deepEqual(
            harness.audited.map((entry) => entry.action),
            ['FEATURE_WITHDRAWAL_LIFT'],
        );
        assert.equal(harness.invalidations, 2);
    });

    test('from now where no date is given; never from a date already past', async () => {
        const harness = await announced();
        const refusal = await refusalOf(
            harness.service.lift(harness.withdrawal.id, ms(NOW, -1), ACTOR, NOW),
        );
        assert.equal(refusal.code, 'FEATURE_WITHDRAWAL_LIFT_IN_PAST');
        const { withdrawal } = await harness.service.lift(harness.withdrawal.id, null, ACTOR, NOW);
        assert.equal(withdrawal.liftedFrom, NOW.toISOString());
    });

    test('refuses an unknown withdrawal, and one lifted already, naming its date', async () => {
        const harness = await announced();
        assert.equal(
            (await refusalOf(harness.service.lift('fw-none', null, ACTOR, NOW))).code,
            'FEATURE_WITHDRAWAL_NOT_FOUND',
        );
        await harness.service.lift(harness.withdrawal.id, DATE, ACTOR, NOW);
        const again = await refusalOf(
            harness.service.lift(harness.withdrawal.id, null, ACTOR, NOW),
        );
        assert.deepEqual(
            [again.code, again.params],
            ['FEATURE_WITHDRAWAL_ALREADY_LIFTED', { date: '2026-07-01' }],
        );
    });

    test('lifted meanwhile by another operator, keeps what they recorded', async () => {
        const harness = await announced();
        const lift = harness.withdrawals.lift;
        harness.withdrawals.lift = async (id, data, tx) => {
            await lift.call(harness.withdrawals, id, { ...data, liftedFrom: DATE });
            return lift.call(harness.withdrawals, id, data, tx);
        };
        const refusal = await refusalOf(
            harness.service.lift(harness.withdrawal.id, null, ACTOR, NOW),
        );
        assert.deepEqual(
            [refusal.code, refusal.params],
            ['FEATURE_WITHDRAWAL_ALREADY_LIFTED', { date: '2026-07-01' }],
        );
        assert.equal(
            [...harness.notices.rows.values()].filter(
                (row) => row.kind === 'feature-withdrawal-lifted',
            ).length,
            0,
            'and tells nobody',
        );
    });
});

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('the list of withdrawals', () => {
    test('says how many it reached, how many were told, and how many ended at once', async () => {
        const notices = noticeRecord();
        const endedAt = ms(NOW, 60_000);
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const harness = withdrawing({
            subscriptions,
            notices,
            port: sendingPort((notice) =>
                notice.subscriptionId === 'sub-t1'
                    ? { recipients: ['admin@t1.example'], channel: 'email' }
                    : { recipients: [], channel: 'email' },
            ),
        });
        const { withdrawal } = await harness.service.announce(
            await announcement(harness.service),
            ACTOR,
            NOW,
        );
        // t1 ended at once after it was told; t2's attempt left its record and ended nothing.
        Object.assign(subscriptions[0].subscription, {
            canceledAt: endedAt,
            canceledEffectiveAt: endedAt,
        });
        await notices.record(
            [endedAtOnce('t1', withdrawal.id, endedAt), endedAtOnce('t2', withdrawal.id, endedAt)],
            endedAt,
        );
        const [listed] = await harness.service.list();
        assert.equal(listed.id, withdrawal.id);
        assert.equal(listed.featureLabel, 'Data export');
        assert.deepEqual(
            listed.progress,
            { reached: 2, told: 1, endedAtOnce: 1 },
            'the end t2 recorded did not happen, and is not counted',
        );
    });
});

/** The record an attempt to end the subscription of `tenantId` at `at` leaves, ended or not. */
function endedAtOnce(tenantId, withdrawalId, at, subscriptionBundleId = null) {
    return {
        tenantId,
        subscriptionId: `sub-${tenantId}`,
        kind: 'ended-at-once',
        subject: `${subscriptionBundleId ?? `sub-${tenantId}`}@${at.toISOString()}`,
        content: {
            kind: 'ended-at-once',
            tenantId,
            subscriptionId: `sub-${tenantId}`,
            subscriptionBundleId,
            withdrawalId,
            featureKey: 'EXPORT',
            featureLabel: 'Data export',
            endedAt: at.toISOString(),
        },
    };
}

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('an end at once, sent by the run', () => {
    test('is told where the subscription or the booking ended at its moment, and never where the end failed', async () => {
        const notices = noticeRecord();
        const port = sendingPort();
        const ended = ms(NOW, 60_000);
        const failed = ms(NOW, 30_000);
        const harness = withdrawing({
            subscriptions: [
                subscriptionOf('t1', { canceledAt: ended, canceledEffectiveAt: ended }),
                subscriptionOf('t2'),
            ],
            notices,
            port,
            bookingStore: {
                async findById(id) {
                    return id === 'sb-t1'
                        ? bookingOf('t1', { canceledAt: ended, canceledEffectiveAt: ended })
                        : bookingOf('t2');
                },
            },
        });
        await notices.record(
            [
                // An attempt that failed before the one that ended it.
                endedAtOnce('t1', 'fw-1', failed),
                endedAtOnce('t1', 'fw-1', ended),
                endedAtOnce('t1', 'fw-1', ended, 'sb-t1'),
                // A booking whose end failed, and nothing ended since.
                endedAtOnce('t2', 'fw-1', ended, 'sb-t2'),
            ],
            NOW,
        );

        const run = await harness.service.sendUndelivered(ms(NOW, 3_600_000));

        assert.deepEqual(
            port.sent.map((notice) => [notice.subscriptionBundleId, notice.endedAt]),
            [
                [null, ended.toISOString()],
                ['sb-t1', ended.toISOString()],
            ],
        );
        assert.deepEqual(run, { told: 2, failed: 0 });
        assert.equal(
            (await harness.service.sendUndelivered(ms(NOW, 7_200_000))).told,
            0,
            'and the failed ones are not tried again as if they were due',
        );
    });
});

// @requirement SC-CAT-017 — A withdrawn feature is marked wherever a plan or an add-on is shown with what it includes
describe('the features a catalogue marks as withdrawn', () => {
    test('are those withdrawn now or from a date ahead, until they are lifted', async () => {
        const { service } = withdrawing({
            withdrawals: withdrawalStore([
                withdrawalRecord({ id: 'open', featureKey: 'A' }),
                withdrawalRecord({ id: 'ahead', featureKey: 'B', effectiveFrom: DATE }),
                withdrawalRecord({ id: 'lifting', featureKey: 'C', liftedFrom: ms(NOW, 1) }),
                withdrawalRecord({ id: 'lifted', featureKey: 'D', liftedFrom: NOW }),
                withdrawalRecord({
                    id: 'never',
                    featureKey: 'E',
                    effectiveFrom: DATE,
                    liftedFrom: ms(NOW, 1),
                }),
            ]),
        });
        const marked = await service.withdrawnFeatures(NOW);
        assert.deepEqual(marked.map((feature) => feature.featureKey).sort(), ['A', 'B', 'C']);
        assert.deepEqual(
            marked.find((feature) => feature.featureKey === 'C'),
            {
                featureKey: 'C',
                reason: 'The export service has been switched off.',
                effectiveFrom: '2026-06-01T00:00:00.000Z',
                liftedFrom: ms(NOW, 1).toISOString(),
            },
        );
    });
});

// @requirement SC-CAT-017 — A withdrawn feature is marked wherever a plan or an add-on is shown with what it includes
describe('the public feature registry', () => {
    const REGISTRY = {
        EXPORT: { label: 'Data export', description: '', icon: 'download' },
        REPORTS: { label: 'Reports', description: '', icon: 'bar_chart' },
    };
    const registryOver = (withdrawals) =>
        new PublicCatalogController(
            givenPlanCatalogSource({
                schemaVersion: 1,
                app: { name: 'Demo' },
                currency: 'EUR',
                vatRate: 19,
                plans: [],
            }),
            REGISTRY,
            null,
            null,
            null,
            withdrawals,
        );

    test('marks a feature withdrawn now or ahead with why and from when', async () => {
        const registry = await registryOver({
            list: async () => [
                withdrawalRecord({ liftedFrom: new Date('2099-01-01T00:00:00.000Z') }),
            ],
        }).listFeatureRegistry();
        assert.deepEqual(registry.EXPORT, {
            ...REGISTRY.EXPORT,
            withdrawn: {
                reason: 'The export service has been switched off.',
                effectiveFrom: '2026-06-01T00:00:00.000Z',
                liftedFrom: '2099-01-01T00:00:00.000Z',
            },
        });
        assert.deepEqual(registry.REPORTS, REGISTRY.REPORTS, 'and leaves the rest as it is');
    });

    test('marks nothing once the withdrawal is lifted, or where none is kept', async () => {
        const lifted = await registryOver({
            list: async () => [
                withdrawalRecord({ liftedFrom: new Date('2026-06-02T00:00:00.000Z') }),
            ],
        }).listFeatureRegistry();
        assert.equal(lifted.EXPORT.withdrawn, undefined);
        assert.deepEqual(await registryOver(null).listFeatureRegistry(), REGISTRY);
    });

    test('fails rather than show a withdrawn feature as available', async () => {
        const failing = registryOver({
            list: async () => {
                throw new Error('database gone');
            },
        });
        await assert.rejects(failing.listFeatureRegistry(), /database gone/);
    });
});
