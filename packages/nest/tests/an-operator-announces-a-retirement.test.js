// An operator retires a plan version for the subscriptions on it: what the
// preview shows, what refuses the announcement, what the announcement writes
// and whom it tells — once, and again by the next run where telling failed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import {
    ConflictException,
    Logger,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';

import { VersionNoticeCron, VersionRetirementService } from '../dist/billing/index.js';
import { NOW, version } from './helpers/version-offers.js';
import { usageRecord } from './helpers/subscription-fixtures.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const DAY = 24 * 60 * 60 * 1000;
const ACTOR = { userId: 'op-1', email: 'operator@example.com', source: 'web', context: 'admin' };

/** Standard v1, whose sale ended on 30 September. */
const RETIRED = version({ validUntil: '2026-09-30T00:00:00.000Z' });
/** Standard v2, on sale. */
const REPLACEMENT = version({ id: 'pv-2', version: 2, monthlyNet: '59.00' });

/** The two versions as the subscriber compares them. */
const RETIRED_SIDE = {
    planKey: 'STANDARD',
    planVersionId: 'pv-1',
    version: 1,
    features: ['DASHBOARD', 'EXPORT'],
    quotas: { users: 5, vehicles: 100 },
    monthlyNet: 49,
    yearlyNet: 490,
    validUntil: '2026-09-30T00:00:00.000Z',
    endsAt: null,
};
const REPLACEMENT_SIDE = {
    ...RETIRED_SIDE,
    planVersionId: 'pv-2',
    version: 2,
    monthlyNet: 59,
    validUntil: null,
};
/** Dearer by ten a month: a price increase, which is what the subscribers are told. */
const PRICE_CHANGES = [
    { field: 'monthlyNet', oldValue: '49.00', newValue: '59.00', direction: 'REGRESSION' },
];

/** A monthly subscription of `tenantId` on version 1, its period ending on 1 November. */
function boundTo(tenantId, overrides = {}) {
    return {
        tenantId,
        subscription: usageRecord({
            id: `sub-${tenantId}`,
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
            planVersion: { id: RETIRED.id, planId: 'STANDARD', version: 1 },
            ...overrides,
        }),
    };
}

/** An announcement store kept in memory. */
function retirementStore() {
    const rows = [];
    return {
        rows,
        createdIn: [],
        async create(data, tx) {
            this.createdIn.push(tx);
            const row = { id: `ret-${rows.length + 1}`, ...data };
            rows.push(row);
            return row;
        },
        async list() {
            return [...rows].reverse();
        },
        async findById(id) {
            return rows.find((row) => row.id === id) ?? null;
        },
    };
}

/** A bypass port that records whether the work it is handed ran inside it. */
function recordingBypass() {
    let depth = 0;
    return {
        inside: () => depth > 0,
        async runWithBypass(work) {
            depth += 1;
            try {
                return await work();
            } finally {
                depth -= 1;
            }
        },
    };
}

/** The service over `bound`, with every part kept in memory. */
function retiring({
    bound = [boundTo('t1'), boundTo('t2')],
    rows = [RETIRED, REPLACEMENT],
    termsConfirmed = true,
    notices = noticeRecord(),
    port = sendingPort(),
    bypass = null,
} = {}) {
    const retirements = retirementStore();
    const audited = [];
    const tx = { transaction: 'tx-1' };
    const reads = [];
    const usage = {
        async listBoundToVersion(planVersionId) {
            reads.push(bypass?.inside() ?? null);
            return bound.filter(
                ({ subscription }) => subscription.planVersion?.id === planVersionId,
            );
        },
    };
    const plans = { findVersionById: async (id) => rows.find((row) => row.id === id) ?? null };
    const rolledBack = [];
    const transactions = {
        async run(work) {
            try {
                return await work(tx);
            } catch (error) {
                rolledBack.push(error);
                throw error;
            }
        },
    };
    const settings = { tenantBilling: { orderlyRetirement: { termsConfirmed } } };
    const audit = { log: async (entry) => audited.push(entry) };
    const service = new VersionRetirementService(
        plans,
        usage,
        notices,
        port,
        retirements,
        transactions,
        settings,
        bypass,
        audit,
    );
    return { service, notices, port, retirements, audited, tx, reads, rolledBack };
}

const codesOf = (preview) => preview.blockers.map((blocker) => blocker.code);
const idsOf = (rows) => rows.map((row) => row.subscriptionId);

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('expected a refusal');
}

describe('the preview of a retirement', () => {
    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('shows each running subscription on the version with its effective date', async () => {
        const { service } = retiring();

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(preview.retired, RETIRED_SIDE);
        assert.deepEqual(preview.replacement, REPLACEMENT_SIDE);
        assert.deepEqual(preview.changes, PRICE_CHANGES);
        assert.equal(preview.asOf, NOW.toISOString());
        assert.deepEqual(preview.blockers, []);
        assert.deepEqual(preview.reached[0], {
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            // 15 October + three months is 15 January; the next period end is 1 February.
            effectiveAt: '2027-02-01T00:00:00.000Z',
            lastDayToCancel: '2027-01-31',
            reachedRecently: false,
        });
        assert.deepEqual(idsOf(preview.reached), ['sub-t1', 'sub-t2']);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('lists the subscriptions it does not reach, with the reason', async () => {
        const { service } = retiring({
            bound: [
                boundTo('t1'),
                boundTo('t2', { status: 'CANCELED' }),
                boundTo('t3', {
                    canceledAt: new Date('2026-10-02T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
                }),
                boundTo('t4', {
                    pendingPlan: 'PRO',
                    pendingEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
                }),
            ],
        });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(idsOf(preview.reached), ['sub-t1']);
        assert.deepEqual(
            preview.skipped.map((row) => [row.subscriptionId, row.reason]),
            [
                ['sub-t2', 'ended'],
                ['sub-t3', 'cancelled-before'],
                ['sub-t4', 'changes-before'],
            ],
        );
        assert.deepEqual(preview.blockers, []);
    });

    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    test('may name a version of another plan as the replacement', async () => {
        const pro = version({ id: 'pv-pro', planId: 'PRO', monthlyNet: '99.00' });
        const { service } = retiring({ rows: [RETIRED, REPLACEMENT, pro] });

        const preview = await service.preview(RETIRED.id, pro.id, NOW);

        assert.deepEqual(preview.blockers, []);
        assert.equal(preview.replacement.planKey, 'PRO');
    });

    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    describe('reports what would refuse the announcement, all of it at once', () => {
        test('a version still on sale, on its last day too', async () => {
            const lastDay = version({ validUntil: '2026-10-15T00:00:00.000Z' });
            const { service } = retiring({ rows: [lastDay, REPLACEMENT] });

            const preview = await service.preview(lastDay.id, REPLACEMENT.id, NOW);

            assert.deepEqual(codesOf(preview), ['RETIREMENT_VERSION_ON_SALE']);
            assert.deepEqual(preview.blockers[0].params, { planKey: 'STANDARD', version: 1 });
        });

        test('but not one whose last day was yesterday', async () => {
            const yesterday = version({ validUntil: '2026-10-14T00:00:00.000Z' });
            const { service } = retiring({ rows: [yesterday, REPLACEMENT] });

            const preview = await service.preview(yesterday.id, REPLACEMENT.id, NOW);

            assert.deepEqual(codesOf(preview), []);
        });

        test('a version only scheduled for sale is not off sale either', async () => {
            const scheduled = version({ validFrom: '2026-11-01T00:00:00.000Z' });
            const { service } = retiring({ rows: [scheduled, REPLACEMENT] });

            const preview = await service.preview(scheduled.id, REPLACEMENT.id, NOW);

            assert.deepEqual(codesOf(preview), ['RETIREMENT_VERSION_ON_SALE']);
        });

        test('a replacement that is not on sale: a draft, or one whose sale has ended', async () => {
            const draft = version({ id: 'pv-3', version: 3, publishedAt: null });
            const ended = version({
                id: 'pv-4',
                version: 4,
                validUntil: '2026-10-01T00:00:00.000Z',
            });
            const { service } = retiring({ rows: [RETIRED, draft, ended] });

            for (const replacement of [draft, ended]) {
                const preview = await service.preview(RETIRED.id, replacement.id, NOW);
                assert.deepEqual(codesOf(preview), ['RETIREMENT_REPLACEMENT_NOT_ON_SALE']);
                assert.equal(preview.blockers[0].params.version, replacement.version);
            }
        });

        test('a replacement with no price in the rhythm a subscription is billed in', async () => {
            const monthlyOnly = version({ id: 'pv-2', version: 2, yearlyNet: null });
            const { service } = retiring({
                rows: [RETIRED, monthlyOnly],
                bound: [boundTo('t1'), boundTo('t2', { billingCycle: 'YEARLY' })],
            });

            const preview = await service.preview(RETIRED.id, monthlyOnly.id, NOW);

            assert.deepEqual(codesOf(preview), ['RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM']);
            assert.deepEqual(preview.blockers[0].params, {
                count: 1,
                planKey: 'STANDARD',
                version: 2,
            });
        });

        test('a replacement with no price in the rhythm a subscription will be billed in by then', async () => {
            const monthlyOnly = version({ id: 'pv-2', version: 2, yearlyNet: null });
            const { service } = retiring({
                rows: [RETIRED, monthlyOnly],
                bound: [
                    boundTo('t1', {
                        pendingPlan: 'STANDARD',
                        pendingBillingCycle: 'YEARLY',
                        pendingEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
                    }),
                ],
            });

            const preview = await service.preview(RETIRED.id, monthlyOnly.id, NOW);

            assert.equal(preview.reached[0].billingCycle, 'YEARLY');
            assert.deepEqual(codesOf(preview), ['RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM']);
        });

        test('but not one whose subscriptions are all billed in a rhythm it is sold in', async () => {
            const monthlyOnly = version({ id: 'pv-2', version: 2, yearlyNet: null });
            const { service } = retiring({ rows: [RETIRED, monthlyOnly] });

            const preview = await service.preview(RETIRED.id, monthlyOnly.id, NOW);

            assert.deepEqual(codesOf(preview), []);
        });

        test('nobody on the version to tell', async () => {
            const { service } = retiring({ bound: [boundTo('t1', { status: 'CANCELED' })] });

            const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

            assert.deepEqual(codesOf(preview), ['RETIREMENT_NOTHING_AFFECTED']);
        });

        test('several at once', async () => {
            const onSale = version({ validUntil: '2026-12-31T00:00:00.000Z' });
            const { service } = retiring({ rows: [onSale, REPLACEMENT], bound: [] });

            const preview = await service.preview(onSale.id, REPLACEMENT.id, NOW);

            assert.deepEqual(codesOf(preview), [
                'RETIREMENT_VERSION_ON_SALE',
                'RETIREMENT_NOTHING_AFFECTED',
            ]);
        });
    });

    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    test('is refused where the terms are not confirmed, before anything is read', async () => {
        const { service, reads } = retiring({ termsConfirmed: false });

        const error = await rejection(service.preview(RETIRED.id, REPLACEMENT.id, NOW));

        assert.ok(error instanceof UnprocessableEntityException);
        assert.equal(error.getResponse().code, 'RETIREMENT_TERMS_NOT_CONFIRMED');
        assert.deepEqual(reads, []);
    });

    test('refuses a version named as its own replacement', async () => {
        const { service } = retiring();

        const error = await rejection(service.preview(RETIRED.id, RETIRED.id, NOW));

        assert.ok(error instanceof UnprocessableEntityException);
        assert.equal(error.getResponse().code, 'RETIREMENT_REPLACEMENT_IS_RETIRED');
    });

    test('refuses a version that does not exist', async () => {
        const { service } = retiring();

        const error = await rejection(service.preview('pv-missing', REPLACEMENT.id, NOW));

        assert.ok(error instanceof NotFoundException);
        assert.equal(error.getResponse().params.versionId, 'pv-missing');
    });

    test('reads every tenant inside the bypass', async () => {
        const bypass = recordingBypass();
        const { service, reads } = retiring({ bypass });

        await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(reads, [true]);
    });
});

// @requirement SC-SUB-028 — A subscription is reached by a retirement at most once in twelve months
describe('a subscription is reached at most once in twelve months', () => {
    /** A retirement notice recorded for `sub-t1` at `at`. */
    async function reachedAt(notices, at) {
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'version-retired',
                    subject: 'ret-earlier',
                    content: { kind: 'version-retired' },
                },
            ],
            at,
        );
    }

    test('one reached eleven months ago holds the announcement back, counted', async () => {
        const notices = noticeRecord();
        await reachedAt(notices, new Date('2025-11-15T09:00:00.000Z'));
        const { service } = retiring({ notices });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['RETIREMENT_WITHIN_TWELVE_MONTHS']);
        assert.deepEqual(preview.blockers[0].params, { count: 1 });
        assert.deepEqual(
            preview.reached.map((row) => [row.subscriptionId, row.reachedRecently]),
            [
                ['sub-t1', true],
                ['sub-t2', false],
            ],
        );
    });

    test('one reached exactly twelve months ago still does', async () => {
        const notices = noticeRecord();
        await reachedAt(notices, new Date('2025-10-15T09:00:00.000Z'));
        const { service } = retiring({ notices });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['RETIREMENT_WITHIN_TWELVE_MONTHS']);
    });

    test('one reached a moment longer ago does not', async () => {
        const notices = noticeRecord();
        await reachedAt(notices, new Date('2025-10-15T08:59:59.999Z'));
        const { service } = retiring({ notices });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), []);
    });

    test('a notice of another kind does not count', async () => {
        const notices = noticeRecord();
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'version-offered',
                    subject: 'pv-2',
                    content: { kind: 'version-offered' },
                },
            ],
            new Date(NOW.getTime() - DAY),
        );
        const { service } = retiring({ notices });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), []);
    });
});

describe('announcing a retirement', () => {
    const shown = ['sub-t1', 'sub-t2'];

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('keeps the announcement, records a notice per subscription and tells each', async () => {
        const { service, retirements, notices, port, audited } = retiring();

        const result = await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.equal(result.told, 2);
        assert.equal(result.failed, 0);
        assert.deepEqual(retirements.rows, [
            {
                id: 'ret-1',
                retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                announcedAt: NOW,
                announcedBy: 'web:operator@example.com:admin',
            },
        ]);
        assert.deepEqual(port.sent[0], {
            kind: 'version-retired',
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            retirementId: 'ret-1',
            retired: RETIRED_SIDE,
            replacement: REPLACEMENT_SIDE,
            changes: PRICE_CHANGES,
            billingCycle: 'MONTHLY',
            effectiveAt: '2027-02-01T00:00:00.000Z',
            lastDayToCancel: '2027-01-31',
        });
        assert.deepEqual(idsOf(port.sent), shown);
        const [kept] = await notices.listForSubscription('sub-t2');
        assert.equal(kept.subject, 'pv-1', 'kept once per subscription and retired version');
        assert.ok(kept.deliveredAt, 'recorded as sent');
        assert.deepEqual(kept.content, port.sent[1], 'recorded as it was told, prices included');
        assert.deepEqual(audited, [
            {
                actor: ACTOR,
                entity: 'PlanVersion',
                entityId: 'pv-1',
                action: 'PLAN_VERSION_RETIRE',
                changes: {
                    retirementId: 'ret-1',
                    replacementPlanVersionId: 'pv-2',
                    subscriptions: 2,
                },
            },
        ]);
    });

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('writes the announcement and its notices in one transaction', async () => {
        const { service, retirements, notices, tx } = retiring();

        await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.deepEqual(retirements.createdIn, [tx]);
        assert.deepEqual(notices.recordedIn, [tx]);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('accepts the subscriptions shown in any order', async () => {
        const { service } = retiring();

        const result = await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sub-t2', 'sub-t1'],
            ACTOR,
            NOW,
        );

        assert.equal(result.told, 2);
    });

    for (const [name, ids] of [
        ['one more than it reaches', ['sub-t1', 'sub-t2', 'sub-t3']],
        ['one fewer', ['sub-t1']],
        ['the same number, one of them another', ['sub-t1', 'sub-t3']],
        ['a repeated one in place of a missing one', ['sub-t1', 'sub-t1']],
    ]) {
        // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
        test(`refuses when the subscriptions shown are ${name}, and writes nothing`, async () => {
            const { service, retirements, notices, port } = retiring();

            const error = await rejection(
                service.announce(RETIRED.id, REPLACEMENT.id, ids, ACTOR, NOW),
            );

            assert.ok(error instanceof ConflictException);
            const body = error.getResponse();
            assert.equal(body.code, 'RETIREMENT_PREVIEW_CHANGED');
            assert.deepEqual(idsOf(body.preview.reached), shown, 'with the preview as it stands');
            assert.equal(retirements.rows.length, 0);
            assert.equal(notices.rows.size, 0);
            assert.equal(port.sent.length, 0);
        });
    }

    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    test('refuses what the preview reports, with every blocker, and writes nothing', async () => {
        const onSale = version({ validUntil: '2026-12-31T00:00:00.000Z' });
        const draft = version({ id: 'pv-3', version: 3, publishedAt: null });
        const { service, retirements, notices } = retiring({ rows: [onSale, draft] });

        const error = await rejection(service.announce(onSale.id, draft.id, shown, ACTOR, NOW));

        assert.ok(error instanceof UnprocessableEntityException);
        const body = error.getResponse();
        assert.equal(body.code, 'RETIREMENT_VERSION_ON_SALE');
        assert.deepEqual(
            body.blockers.map((blocker) => blocker.code),
            ['RETIREMENT_VERSION_ON_SALE', 'RETIREMENT_REPLACEMENT_NOT_ON_SALE'],
        );
        assert.equal(retirements.rows.length, 0);
        assert.equal(notices.rows.size, 0);
    });

    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    test('refuses where the terms are not confirmed, and writes nothing', async () => {
        const { service, retirements, notices, port } = retiring({ termsConfirmed: false });

        const error = await rejection(
            service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW),
        );

        assert.equal(error.getResponse().code, 'RETIREMENT_TERMS_NOT_CONFIRMED');
        assert.equal(retirements.rows.length, 0);
        assert.equal(notices.rows.size, 0);
        assert.deepEqual(port.sent, []);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('a second announcement of the version leaves the subscriptions it told alone', async () => {
        const v3 = version({ id: 'pv-3', version: 3, monthlyNet: '69.00' });
        const { service, port, notices } = retiring({ rows: [RETIRED, REPLACEMENT, v3] });
        await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        const preview = await service.preview(RETIRED.id, v3.id, new Date(NOW.getTime() + DAY));

        assert.deepEqual(
            preview.skipped.map((row) => [row.subscriptionId, row.reason]),
            [
                ['sub-t1', 'already-told'],
                ['sub-t2', 'already-told'],
            ],
        );
        assert.deepEqual(codesOf(preview), ['RETIREMENT_NOTHING_AFFECTED']);
        const error = await rejection(
            service.announce(RETIRED.id, v3.id, [], ACTOR, new Date(NOW.getTime() + DAY)),
        );
        assert.equal(error.getResponse().code, 'RETIREMENT_NOTHING_AFFECTED');
        assert.equal(port.sent.length, 2, 'told once, by the first');
        assert.equal(notices.rows.size, 2);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('one told of it more than a year ago is still left alone', async () => {
        const notices = noticeRecord();
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'version-retired',
                    subject: RETIRED.id,
                    content: { kind: 'version-retired' },
                },
            ],
            new Date('2025-01-01T00:00:00.000Z'),
        );
        const { service } = retiring({ notices });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(idsOf(preview.reached), ['sub-t2']);
        assert.deepEqual(preview.skipped, [
            { tenantId: 't1', subscriptionId: 'sub-t1', reason: 'already-told' },
        ]);
        assert.deepEqual(codesOf(preview), []);
    });

    test('a second announcement of the version, run beside the first, is undone and tells nobody', async () => {
        const notices = noticeRecord();
        const first = retiring({ notices });
        await first.service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);
        // The second read the notices before the first had written any, so its
        // twelve-month check found nothing.
        const second = retiring({ notices });
        notices.listOfKindSince = async () => [];

        const error = await rejection(
            second.service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW),
        );

        assert.ok(error instanceof ConflictException);
        assert.equal(error.getResponse().code, 'RETIREMENT_WITHIN_TWELVE_MONTHS');
        assert.deepEqual(error.getResponse().params, { count: 2 });
        assert.deepEqual(second.rolledBack, [error], 'refused inside its transaction');
        assert.deepEqual(second.port.sent, []);
        assert.deepEqual(second.audited, []);
        assert.equal(notices.rows.size, 2, 'the first announcement’s notices, and no others');
    });

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('a notice that cannot be taken on is left for the next run, and the others are told', async () => {
        const notices = noticeRecord();
        const claim = notices.claim;
        notices.claim = async (key, ...rest) => {
            if (key.subscriptionId === 'sub-t1') throw new Error('connection reset');
            return claim(key, ...rest);
        };
        const { service } = retiring({ notices });

        const result = await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.deepEqual([result.told, result.failed], [1, 1]);
        notices.claim = claim;
        assert.deepEqual(await service.sendUndelivered(new Date(NOW.getTime() + 60_000)), {
            told: 1,
            failed: 0,
        });
    });

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('a notice whose sending and letting go both fail is counted as failed, not thrown', async () => {
        const notices = noticeRecord();
        notices.release = async () => Promise.reject(new Error('database blip'));
        const port = sendingPort(() => {
            throw new Error('mail relay down');
        });
        const { service, retirements } = retiring({ notices, port });

        const result = await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.deepEqual([result.told, result.failed], [0, 2]);
        assert.equal(retirements.rows.length, 1);
    });

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('an audit entry that cannot be written does not make the announcement read as failed', async () => {
        const { service, retirements, port } = retiring();
        service.audit = { log: async () => Promise.reject(new Error('audit down')) };

        const result = await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.equal(result.told, 2);
        assert.equal(retirements.rows.length, 1);
        assert.equal(port.sent.length, 2);
    });

    test('runs inside the bypass, from the first read to the last notice', async () => {
        const bypass = recordingBypass();
        const insideAtSend = [];
        const port = sendingPort((notice) => {
            insideAtSend.push(bypass.inside());
            return { recipients: [`${notice.tenantId}@example.com`], channel: 'email' };
        });
        const { service, reads } = retiring({ bypass, port });

        await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);

        assert.deepEqual(reads, [true]);
        assert.deepEqual(insideAtSend, [true, true]);
    });

    // @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
    test('a notice the application cannot send now stays recorded and goes out with the next run', async () => {
        let failing = true;
        const port = sendingPort(() => {
            if (failing) throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, notices } = retiring({ port });

        const result = await service.announce(RETIRED.id, REPLACEMENT.id, shown, ACTOR, NOW);
        assert.deepEqual([result.told, result.failed], [0, 2]);
        const [held] = await notices.listForSubscription('sub-t1');
        assert.equal(held.deliveredAt, null, 'recorded, not sent');

        failing = false;
        assert.deepEqual(await service.sendUndelivered(new Date(NOW.getTime() + 60_000)), {
            told: 2,
            failed: 0,
        });
        assert.deepEqual(await service.sendUndelivered(new Date(NOW.getTime() + 120_000)), {
            told: 0,
            failed: 0,
        });
        assert.equal(port.sent.length, 4, 'two attempts that failed, two that went out');
    });
});

// @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
describe('the run that sends what an announcement could not', () => {
    /** An announcement at NOW whose notices the application could not send; `sends` turns it on. */
    async function unsent({ bound } = {}) {
        let sending = false;
        const port = sendingPort((notice) => {
            if (!sending) throw new Error('mail server down');
            return { recipients: [`${notice.tenantId}@example.com`], channel: 'email' };
        });
        const retired = retiring({ port, ...(bound ? { bound } : {}) });
        await retired.service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sub-t1', 'sub-t2'],
            ACTOR,
            NOW,
        );
        port.sent.length = 0;
        return { ...retired, sends: () => (sending = true) };
    }

    test('sends only retirement notices, and leaves one another run holds', async () => {
        const { service, notices, port, sends } = await unsent();
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-b',
                    kind: 'version-offered',
                    subject: 'pv-2',
                    content: { kind: 'version-offered' },
                },
            ],
            NOW,
        );
        // Another run took t2's a minute ago; its claim holds for a quarter of an hour.
        const [t2] = await notices.listForSubscription('sub-t2');
        const taken = new Date(NOW.getTime() + 60_000);
        await notices.claim(
            {
                tenantId: 't2',
                subscriptionId: 'sub-t2',
                kind: 'version-retired',
                subject: t2.subject,
            },
            t2.content,
            taken,
            new Date(taken.getTime() - 15 * 60_000),
        );
        sends();

        assert.deepEqual(await service.sendUndelivered(new Date(taken.getTime() + 60_000)), {
            told: 1,
            failed: 0,
        });
        assert.deepEqual(idsOf(port.sent), ['sub-t1']);
    });

    // @requirement SC-SUB-035 — A retirement's date is a term end at least three months after its notice arrived
    test('a notice sent late names the date counted from its sending, and the day before it', async () => {
        const { service, notices, port, sends } = await unsent();
        sends();
        // Two months late: three calendar months from now end on 15 March, and
        // the first term end after it is 1 April — not 1 February.
        const late = new Date('2026-12-15T09:00:00.000Z');

        await service.sendUndelivered(late);

        assert.deepEqual(
            port.sent.map((notice) => [
                notice.subscriptionId,
                notice.effectiveAt,
                notice.lastDayToCancel,
            ]),
            [
                ['sub-t1', '2027-04-01T00:00:00.000Z', '2027-03-31'],
                ['sub-t2', '2027-04-01T00:00:00.000Z', '2027-03-31'],
            ],
        );
        const [kept] = await notices.listForSubscription('sub-t1');
        assert.deepEqual(kept.content, port.sent[0], 'recorded as it was told, with the new date');
    });

    // @requirement SC-SUB-035 — A retirement's date is a term end at least three months after its notice arrived
    test('a notice sent a minute late keeps the date it was announced with', async () => {
        const { service, port, sends } = await unsent();
        sends();

        await service.sendUndelivered(new Date(NOW.getTime() + 60_000));

        assert.deepEqual(
            port.sent.map((notice) => notice.effectiveAt),
            ['2027-02-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'],
        );
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('a notice the application tells nobody of is tried again until somebody is told', async () => {
        let recipients = [];
        const port = sendingPort(() => ({ recipients, channel: 'email' }));
        const { service, notices } = retiring({ port });

        const announced = await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sub-t1', 'sub-t2'],
            ACTOR,
            NOW,
        );
        // The record hands out its rows themselves, so the moment is read now.
        const [{ deliveredAt: deliveredToNobody }] = await notices.listForSubscription('sub-t1');
        recipients = ['admin@example.com'];
        const run = await service.sendUndelivered(new Date(NOW.getTime() + 60_000));

        assert.deepEqual([announced.told, announced.failed], [0, 2], 'not told, to try again');
        assert.equal(deliveredToNobody, null, 'nobody is not a delivery');
        assert.deepEqual(run, { told: 2, failed: 0 });
        const [kept] = await notices.listForSubscription('sub-t1');
        assert.deepEqual(kept.delivery, { recipients: ['admin@example.com'], channel: 'email' });
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('says once a day, not on every run, that a notice still reaches nobody', async () => {
        const port = sendingPort(() => ({ recipients: [], channel: 'email' }));
        const { service } = retiring({ port });
        const warned = [];
        const original = Logger.prototype.warn;
        Logger.prototype.warn = function (message) {
            warned.push(String(message));
        };
        try {
            await service.announce(RETIRED.id, REPLACEMENT.id, ['sub-t1', 'sub-t2'], ACTOR, NOW);
            await service.sendUndelivered(new Date(NOW.getTime() + 60_000));
            await service.sendUndelivered(new Date(NOW.getTime() + 120_000));
        } finally {
            Logger.prototype.warn = original;
        }

        assert.equal(port.sent.length, 6, 'tried by the announcement and by both runs');
        assert.equal(
            warned.filter((line) => line.includes('tried again until somebody is told')).length,
            2,
            'once for each notice',
        );
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('tells nobody who has left the version, and still tells the others', async () => {
        const bound = [boundTo('t1'), boundTo('t2')];
        const { service, notices, port, sends } = await unsent({ bound });
        // t1 took the newer version before its notice could go out.
        bound[0].subscription.planVersion = { id: 'pv-2', planId: 'STANDARD', version: 2 };
        sends();

        const run = await service.sendUndelivered(new Date(NOW.getTime() + 60_000));

        assert.deepEqual(run, { told: 1, failed: 0 });
        assert.deepEqual(idsOf(port.sent), ['sub-t2']);
        const [kept] = await notices.listForSubscription('sub-t1');
        assert.equal(kept.deliveredAt, null, "t1's notice stays on record, unsent");
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('tells nobody whom the retirement no longer reaches, and still tells the others', async () => {
        const bound = [boundTo('t1'), boundTo('t2')];
        const { service, notices, port, sends } = await unsent({ bound });
        // t2 is cancelled for a day before any date a notice could name now.
        Object.assign(bound[1].subscription, {
            canceledAt: new Date('2026-11-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2026-12-01T00:00:00.000Z'),
        });
        sends();

        const run = await service.sendUndelivered(new Date(NOW.getTime() + 60_000));

        assert.deepEqual(run, { told: 1, failed: 0 });
        assert.deepEqual(idsOf(port.sent), ['sub-t1']);
        const [kept] = await notices.listForSubscription('sub-t2');
        assert.equal(kept.deliveredAt, null, "t2's notice stays on record, unsent");
    });

    test('runs inside the bypass', async () => {
        const bypass = recordingBypass();
        const notices = noticeRecord();
        const inside = [];
        const original = notices.listUndelivered;
        notices.listUndelivered = async (...args) => {
            inside.push(bypass.inside());
            return original(...args);
        };
        const { service } = retiring({ notices, bypass });

        await service.sendUndelivered(NOW);

        assert.deepEqual(inside, [true]);
    });
});

// @requirement SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept
describe('the run every quarter of an hour', () => {
    function recording() {
        const calls = [];
        return {
            calls,
            offers: {
                sendDue: async (now) => (calls.push(['offers', now]), { told: 0, failed: 0 }),
            },
            retirements: {
                sendUndelivered: async (now) => (
                    calls.push(['retirements', now]),
                    { told: 1, failed: 0 }
                ),
            },
        };
    }

    test('sends what an announcement could not, after the offers, at the same moment', async () => {
        const { calls, offers, retirements } = recording();

        await new VersionNoticeCron(offers, null, retirements).sendDueNotices();

        assert.deepEqual(
            calls.map(([what]) => what),
            ['offers', 'retirements'],
        );
        assert.equal(calls[0][1], calls[1][1]);
    });

    test('sends neither while the application is locked for maintenance', async () => {
        const { calls, offers, retirements } = recording();

        await new VersionNoticeCron(
            offers,
            { isLocked: async () => true },
            retirements,
        ).sendDueNotices();

        assert.deepEqual(calls, []);
    });
});

// @requirement SC-CANC-023 — A retirement lets a subscription cancel without notice until it takes effect
describe('the retirement that reaches a subscription', () => {
    const onRetired = { id: 'sub-t1', planVersion: { id: 'pv-1' } };

    test('is what the subscriber was told, until it takes effect', async () => {
        const { service, port } = retiring();
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sub-t1', 'sub-t2'], ACTOR, NOW);
        const effectiveAt = new Date('2027-02-01T00:00:00.000Z');

        assert.deepEqual(await service.pendingFor(onRetired, NOW), port.sent[0]);
        assert.deepEqual(
            await service.pendingFor(onRetired, new Date(effectiveAt.getTime() - 1)),
            port.sent[0],
        );
        assert.equal(await service.pendingFor(onRetired, effectiveAt), null);
    });

    test('is none once the subscription has left the retired version', async () => {
        const { service } = retiring();
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sub-t1', 'sub-t2'], ACTOR, NOW);

        assert.equal(
            await service.pendingFor({ id: 'sub-t1', planVersion: { id: 'pv-2' } }, NOW),
            null,
        );
        assert.equal(await service.pendingFor({ id: 'sub-t1', planVersion: null }, NOW), null);
    });

    // @requirement SC-SUB-036 — A retirement waits for its notice to reach the subscriber
    test('is none while its notice has reached nobody, and the notice once it has', async () => {
        let sending = false;
        const port = sendingPort(() => {
            if (!sending) throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service } = retiring({ port });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sub-t1', 'sub-t2'], ACTOR, NOW);
        const before = await service.pendingFor(onRetired, NOW);
        sending = true;
        await service.sendUndelivered(new Date(NOW.getTime() + 60_000));

        assert.equal(before, null);
        assert.deepEqual(
            await service.pendingFor(onRetired, NOW),
            port.sent.find((notice) => notice.subscriptionId === 'sub-t1'),
        );
    });

    test('is none for a subscription told only of an offer', async () => {
        const notices = noticeRecord();
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'version-offered',
                    subject: 'pv-2',
                    content: { kind: 'version-offered' },
                },
            ],
            NOW,
        );
        const { service } = retiring({ notices });

        assert.equal(await service.pendingFor(onRetired, NOW), null);
    });
});

describe('an installation that cannot find whom a retirement reaches', () => {
    const blindWith = (termsConfirmed) =>
        new VersionRetirementService(
            { findVersionById: async () => null },
            {},
            noticeRecord(),
            sendingPort(),
            retirementStore(),
            { run: async (work) => work() },
            { tenantBilling: { orderlyRetirement: { termsConfirmed } } },
        );

    test('is refused at start once its terms allow retiring', () => {
        assert.doesNotThrow(() => retiring().service.onModuleInit());
        assert.throws(() => blindWith(true).onModuleInit(), /listBoundToVersion/);
    });

    test('starts while they do not, since it never retires', () => {
        assert.doesNotThrow(() => blindWith(false).onModuleInit());
    });
});
