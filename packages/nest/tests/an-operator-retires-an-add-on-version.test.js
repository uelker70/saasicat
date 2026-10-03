// An operator retires an add-on version for the bookings on it: what the
// preview shows, what refuses the announcement, what the announcement writes
// and whom it tells, how far it has come, and what it lets a tenant do.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import {
    BundleVersionRetirementService,
    SubscriptionBundlesService,
    VersionNoticeCron,
    buildTenantSubscriptionBundlesController,
    bundleRetirementReach,
} from '../dist/billing/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';
import { usageRecord } from './helpers/subscription-fixtures.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const NOW = new Date('2026-10-15T09:00:00.000Z');
const ACTOR = { userId: 'op-1', email: 'operator@example.com', source: 'web', context: 'admin' };

/** An add-on version as the catalogue keeps it. */
function addOnVersion(id, fields = {}) {
    return {
        id,
        bundleId: 'b-reports',
        bundleKey: 'REPORTS',
        label: 'Reports',
        version: 1,
        baseVersionId: null,
        features: ['REPORTS'],
        quotas: { reports: 10 },
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        publishedChanges: [],
        changeNote: '',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...fields,
    };
}

/** Reports v1, whose sale ended on 30 September. */
const RETIRED = addOnVersion('bv-1', { validUntil: '2026-09-30T00:00:00.000Z' });
/** Reports v2, on sale since 1 October, dearer, and cheaper again beside Pro. */
const REPLACEMENT = addOnVersion('bv-2', {
    version: 2,
    monthlyNet: '12.90',
    yearlyNet: '129.00',
    validFrom: '2026-10-01T00:00:00.000Z',
    pricingOverrides: [{ planId: 'PRO', monthlyNet: '10.90', yearlyNet: '109.00' }],
});

/** The add-on catalogue over `versions`, each add-on live unless `deleted` names it. */
function catalogueOf(versions, { deleted = [] } = {}) {
    const bundles = new FakeBundleRepository();
    for (const bundleId of new Set(versions.map((version) => version.bundleId))) {
        const first = versions.find((version) => version.bundleId === bundleId);
        bundles.seedBundle({
            id: bundleId,
            bundleKey: first.bundleKey,
            label: first.label,
            description: null,
            icon: null,
            sortOrder: 0,
            i18n: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: deleted.includes(bundleId) ? '2026-09-01T00:00:00.000Z' : null,
        });
    }
    for (const version of versions) bundles.seedVersion(version);
    return bundles;
}

/** A yearly Standard subscription of `tenantId`, its year ending on 1 January. */
function subscriptionOf(tenantId, overrides = {}) {
    return {
        tenantId,
        subscription: usageRecord({
            id: `sub-${tenantId}`,
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
            currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            planVersion: { id: 'pv-standard-1', planId: 'STANDARD', version: 1 },
            ...overrides,
        }),
    };
}

/** A booking of `bundleVersionId` on the subscription of `tenantId`, monthly to 1 November unless said. */
function bookingOf(tenantId, overrides = {}) {
    return {
        id: `sb-${tenantId}`,
        subscriptionId: `sub-${tenantId}`,
        bundleVersionId: RETIRED.id,
        startedAt: new Date('2026-03-01T00:00:00.000Z'),
        minimumTermEndsAt: null,
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
        canceledAt: null,
        canceledEffectiveAt: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        ...overrides,
    };
}

/** An announcement store kept in memory. */
function announcementStore() {
    const rows = [];
    return {
        rows,
        createdIn: [],
        async create(data, tx) {
            this.createdIn.push(tx);
            const row = { id: `bundle-retirement-${rows.length + 1}`, ...data };
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

/** The service over `subscriptions` and `bookings`, with every part kept in memory. */
function retiring({
    subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')],
    bookings = [bookingOf('t1'), bookingOf('t2')],
    versions = [RETIRED, REPLACEMENT],
    deleted = [],
    termsConfirmed = true,
    notices = noticeRecord(),
    port = sendingPort(),
} = {}) {
    const retirements = announcementStore();
    const audited = [];
    const rolledBack = [];
    const tx = { transaction: 'tx-1' };
    const bookingRepository = {
        rows: bookings,
        async listOfVersion(bundleVersionId) {
            return bookings.filter((row) => row.bundleVersionId === bundleVersionId);
        },
        async findById(id) {
            return bookings.find((row) => row.id === id) ?? null;
        },
    };
    const usage = {
        async listByIds(ids) {
            return subscriptions.filter(({ subscription }) => ids.includes(subscription.id));
        },
    };
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
    const service = new BundleVersionRetirementService(
        catalogueOf(versions, { deleted }),
        bookingRepository,
        usage,
        notices,
        port,
        retirements,
        transactions,
        { tenantBilling: { orderlyRetirement: { termsConfirmed } } },
        null,
        { log: async (entry) => audited.push(entry) },
    );
    return { service, notices, port, retirements, audited, tx, rolledBack };
}

const codesOf = (preview) => preview.blockers.map((blocker) => blocker.code);
const bookingIdsOf = (rows) => rows.map((row) => row.subscriptionBundleId);

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('expected a refusal');
}

describe('an installation that retires add-on versions', () => {
    /** The service over the given booking repository and subscription port. */
    const over = (bookings, usage, termsConfirmed = true) =>
        new BundleVersionRetirementService(
            catalogueOf([RETIRED, REPLACEMENT]),
            bookings,
            usage,
            noticeRecord(),
            sendingPort(),
            announcementStore(),
            { run: async (work) => work({}) },
            { tenantBilling: { orderlyRetirement: { termsConfirmed } } },
            null,
            null,
        );
    const listing = { listOfVersion: async () => [], findById: async () => null };
    const reading = { listByIds: async () => [] };

    test('does not start without a way to list the bookings of a version, naming it', () => {
        assert.throws(() => over({ findById: async () => null }, reading).onModuleInit(), {
            message: /listOfVersion/,
        });
    });

    test('nor without a way to read subscriptions by id, naming it', () => {
        assert.throws(() => over(listing, {}).onModuleInit(), { message: /listByIds/ });
    });

    test('starts with both, and without either while the terms are not confirmed', () => {
        over(listing, reading).onModuleInit();
        over({}, {}, false).onModuleInit();
    });
});

// @requirement SC-BUN-038 — An add-on version is retired only off sale, onto a version of the same add-on on sale
describe('what an add-on version may be retired onto', () => {
    test('one off sale, onto a version of the same add-on on sale, is not refused', async () => {
        const { service } = retiring();

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(preview.blockers, []);
        assert.equal(preview.retired.bundleVersionId, RETIRED.id);
        assert.equal(preview.replacement.bundleVersionId, REPLACEMENT.id);
    });

    test('a version still on sale, a replacement not on sale and one of another add-on are all named at once', async () => {
        const onSale = addOnVersion('bv-1');
        const notYet = addOnVersion('bv-3', {
            bundleId: 'b-exports',
            bundleKey: 'EXPORTS',
            version: 1,
            validFrom: '2026-12-01T00:00:00.000Z',
        });
        const { service } = retiring({ versions: [onSale, notYet] });

        const preview = await service.preview(onSale.id, notYet.id, NOW);

        assert.deepEqual(codesOf(preview), [
            'BUNDLE_RETIREMENT_VERSION_ON_SALE',
            'BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE',
            'BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE',
        ]);
        assert.deepEqual(preview.blockers[2].params, {
            bundleKey: 'REPORTS',
            replacementBundleKey: 'EXPORTS',
        });
    });

    test('a replacement whose add-on was deleted is not on sale', async () => {
        const { service } = retiring({ deleted: ['b-reports'] });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.ok(codesOf(preview).includes('BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE'));
    });

    test('is refused outright where the operator has not confirmed the terms', async () => {
        const { service } = retiring({ termsConfirmed: false });

        const error = await rejection(service.preview(RETIRED.id, REPLACEMENT.id, NOW));

        assert.ok(error instanceof UnprocessableEntityException);
        assert.equal(error.getResponse().code, 'RETIREMENT_TERMS_NOT_CONFIRMED');
    });

    test('a version is not its own replacement', async () => {
        const { service } = retiring();

        const error = await rejection(service.preview(RETIRED.id, RETIRED.id, NOW));

        assert.equal(error.getResponse().code, 'RETIREMENT_REPLACEMENT_IS_RETIRED');
    });

    test('nothing to tell where no booking runs on the version', async () => {
        const { service } = retiring({ bookings: [] });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['BUNDLE_RETIREMENT_NOTHING_AFFECTED']);
    });
});

// @requirement SC-BUN-040 — An add-on retirement's date is an end of the booking's own period, three months on
describe('the date an add-on retirement reaches a booking on', () => {
    const subscription = subscriptionOf('t1').subscription;
    const reach = (booking, sub = subscription) => bundleRetirementReach(booking, sub, NOW);
    const day = (result) => result.effectiveAt.toISOString().slice(0, 10);

    test('is the first end of its own monthly period three calendar months after the notice', () => {
        // Told on 15 October: the earliest is 15 January, and a monthly booking
        // beside the yearly plan ends its months on the plan's day, the 1st.
        const result = reach(bookingOf('t1'));
        assert.equal(day(result), '2027-02-01');
        assert.equal(result.lastDayToCancel, '2027-01-31');
        assert.equal(result.billingCycle, 'MONTHLY');
    });

    test('and of its own yearly period for a yearly booking', () => {
        const result = reach(
            bookingOf('t1', {
                billingCycle: 'YEARLY',
                currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            }),
        );
        assert.equal(day(result), '2028-01-01');
    });

    test('a booking billed with the plan ends with the plan’s terms', () => {
        const result = reach(bookingOf('t1', { billingCycle: null, currentPeriodEnd: null }));
        assert.equal(day(result), '2028-01-01');
        assert.equal(result.billingCycle, 'YEARLY');
    });

    test('a booking cancelled to end by the date is not reached, one ending a day later is', () => {
        const endingOn = (iso) =>
            reach(
                bookingOf('t1', {
                    canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date(iso),
                }),
            );
        assert.deepEqual(endingOn('2027-02-01T00:00:00.000Z'), {
            reached: false,
            reason: 'cancelled-before',
        });
        assert.equal(endingOn('2027-02-02T00:00:00.000Z').reached, true);
    });

    test('a booking whose subscription ends by the date is not reached', () => {
        const ending = {
            ...subscription,
            canceledAt: new Date('2026-10-10T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        };
        assert.deepEqual(reach(bookingOf('t1'), ending), {
            reached: false,
            reason: 'cancelled-before',
        });
        assert.deepEqual(reach(bookingOf('t1'), { ...subscription, status: 'CANCELED' }), {
            reached: false,
            reason: 'ended',
        });
    });

    test('names the plan the add-on runs beside at the date, a change landing by then included', () => {
        const moving = {
            ...subscription,
            pendingPlan: 'PRO',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        };
        assert.deepEqual(reach(bookingOf('t1'), moving).plan, {
            planKey: 'PRO',
            billingCycle: 'YEARLY',
        });
        assert.deepEqual(reach(bookingOf('t1')).plan, {
            planKey: 'STANDARD',
            billingCycle: 'YEARLY',
        });
    });

    test('the preview lists whom it reaches and whom not, and why', async () => {
        const { service } = retiring({
            bookings: [
                bookingOf('t1'),
                bookingOf('t2', {
                    canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
                }),
            ],
        });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(bookingIdsOf(preview.reached), ['sb-t1']);
        assert.deepEqual(preview.skipped, [
            {
                tenantId: 't2',
                subscriptionId: 'sub-t2',
                subscriptionBundleId: 'sb-t2',
                reason: 'cancelled-before',
            },
        ]);
        assert.deepEqual(
            {
                planKey: preview.reached[0].planKey,
                planCycle: preview.reached[0].planCycle,
                billingCycle: preview.reached[0].billingCycle,
                effectiveAt: preview.reached[0].effectiveAt,
                lastDayToCancel: preview.reached[0].lastDayToCancel,
            },
            {
                planKey: 'STANDARD',
                planCycle: 'YEARLY',
                billingCycle: 'MONTHLY',
                effectiveAt: '2027-02-01T00:00:00.000Z',
                lastDayToCancel: '2027-01-31',
            },
        );
    });
});

// @requirement SC-BUN-044 — An add-on retirement's replacement has to fit each booking's plan at its date
describe('a replacement and the plans its bookings run beside', () => {
    test('is refused where it cannot run beside the plan a booking runs beside at the date, counted', async () => {
        const proOnly = { ...REPLACEMENT, compatibility: { planIds: ['PRO'] } };
        const { service } = retiring({ versions: [RETIRED, proOnly] });

        const preview = await service.preview(RETIRED.id, proOnly.id, NOW);

        assert.deepEqual(codesOf(preview), ['BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN']);
        assert.deepEqual(preview.blockers[0].params, {
            count: 2,
            bundleKey: 'REPORTS',
            version: 2,
        });
    });

    test('asks about the plan a change moves the subscription to before the date', async () => {
        const proOnly = { ...REPLACEMENT, compatibility: { planIds: ['PRO'] } };
        const { service } = retiring({
            versions: [RETIRED, proOnly],
            subscriptions: [
                subscriptionOf('t1', {
                    pendingPlan: 'PRO',
                    pendingBillingCycle: 'YEARLY',
                    pendingEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
                }),
                subscriptionOf('t2'),
            ],
        });

        const preview = await service.preview(RETIRED.id, proOnly.id, NOW);

        assert.equal(preview.blockers[0].params.count, 1);
    });

    test('and about the price there, in the booking’s rhythm', async () => {
        const proPriced = {
            ...REPLACEMENT,
            monthlyNet: null,
            yearlyNet: null,
            pricingOverrides: [{ planId: 'PRO', monthlyNet: '10.90', yearlyNet: '109.00' }],
        };
        const { service } = retiring({ versions: [RETIRED, proPriced] });

        const preview = await service.preview(RETIRED.id, proPriced.id, NOW);

        assert.deepEqual(codesOf(preview), ['BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN']);
    });
});

// @requirement SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown
describe('an announcement and the bookings the operator was shown', () => {
    test('is refused, with the preview as it stands, where they changed meanwhile', async () => {
        const { service, retirements, notices } = retiring();

        const error = await rejection(
            service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1'], ACTOR, NOW),
        );

        assert.ok(error instanceof ConflictException);
        assert.equal(error.getResponse().code, 'RETIREMENT_PREVIEW_CHANGED');
        assert.deepEqual(bookingIdsOf(error.getResponse().preview.reached), ['sb-t1', 'sb-t2']);
        assert.deepEqual(retirements.rows, []);
        assert.equal(notices.rows.size, 0);
    });

    test('is refused with every blocker where the preview has any', async () => {
        const { service, retirements } = retiring({ termsConfirmed: true, bookings: [] });

        const error = await rejection(service.announce(RETIRED.id, REPLACEMENT.id, [], ACTOR, NOW));

        assert.equal(error.getResponse().code, 'BUNDLE_RETIREMENT_NOTHING_AFFECTED');
        assert.deepEqual(retirements.rows, []);
    });
});

// @requirement SC-BUN-042 — Every booking an add-on retirement reaches is told, and what it was told is kept
describe('the announcement of an add-on retirement', () => {
    test('keeps the announcement and one notice per booking in one transaction, and tells each', async () => {
        const { service, retirements, notices, port, tx } = retiring();

        const result = await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sb-t2', 'sb-t1'],
            ACTOR,
            NOW,
        );

        assert.deepEqual({ told: result.told, failed: result.failed }, { told: 2, failed: 0 });
        assert.deepEqual(retirements.createdIn, [tx]);
        assert.deepEqual(notices.recordedIn, [tx]);
        assert.deepEqual(result.retirement.retired, {
            bundleVersionId: 'bv-1',
            bundleKey: 'REPORTS',
            version: 1,
        });
        assert.equal(result.retirement.announcedBy.includes('operator@example.com'), true);
        const rows = [...notices.rows.values()];
        assert.deepEqual(
            rows.map((row) => [row.subscriptionId, row.kind, row.subject]),
            [
                ['sub-t1', 'bundle-version-retired', 'bv-1'],
                ['sub-t2', 'bundle-version-retired', 'bv-1'],
            ],
        );
        assert.deepEqual(
            port.sent.map((notice) => notice.subscriptionBundleId),
            ['sb-t1', 'sb-t2'],
        );
    });

    test('tells each booking the prices beside its own plan, and what changes at them', async () => {
        const { service, port } = retiring({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2', { plan: 'PRO' })],
        });

        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);

        const [standard, pro] = port.sent;
        assert.equal(standard.planKey, 'STANDARD');
        assert.equal(standard.replacement.monthlyNet, 12.9);
        assert.equal(pro.planKey, 'PRO');
        assert.equal(pro.replacement.monthlyNet, 10.9, 'the override for Pro');
        assert.deepEqual(
            pro.changes.find((change) => change.field === 'monthlyNet'),
            { field: 'monthlyNet', oldValue: '9.90', newValue: '10.90', direction: 'REGRESSION' },
        );
        assert.equal(standard.lastDayToCancel, '2027-01-31');
        assert.equal(standard.billingCycle, 'MONTHLY');
    });

    test('is written to the audit log as an operator action', async () => {
        const { service, audited } = retiring();

        const result = await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sb-t1', 'sb-t2'],
            ACTOR,
            NOW,
        );

        assert.deepEqual(audited, [
            {
                actor: ACTOR,
                entity: 'BundleVersion',
                entityId: 'bv-1',
                action: 'BUNDLE_VERSION_RETIRE',
                changes: {
                    retirementId: result.retirement.id,
                    replacementBundleVersionId: 'bv-2',
                    bookings: 2,
                },
            },
        ]);
    });

    test('is refused, and keeps nothing, where another announcement of the version got there first', async () => {
        const notices = noticeRecord();
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'bundle-version-retired',
                    subject: 'bv-1',
                    content: { kind: 'bundle-version-retired' },
                },
            ],
            NOW,
        );
        // The record is there, but the reach was read before it: a run beside
        // this one recorded it after the preview.
        const real = notices.listOfKindSince.bind(notices);
        let reads = 0;
        notices.listOfKindSince = async (kind, since) => {
            reads += 1;
            return reads <= 3 ? [] : real(kind, since);
        };
        const { service, rolledBack } = retiring({ notices });

        const error = await rejection(
            service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW),
        );

        assert.equal(error.getResponse().code, 'RETIREMENT_WITHIN_TWELVE_MONTHS');
        assert.equal(rolledBack.length, 1);
    });
});

// @requirement SC-BUN-041 — Retirements of plan and add-on reach a subscription at most once in twelve months
describe('twelve months between two retirements of one subscription', () => {
    /** A notice of `kind` recorded for the subscription of t1 at `at`. */
    async function toldOf(kind, at) {
        const notices = noticeRecord();
        await notices.record(
            [{ tenantId: 't1', subscriptionId: 'sub-t1', kind, subject: 'other', content: {} }],
            at,
        );
        return notices;
    }
    const monthsBefore = (months, ms = 0) => {
        const at = new Date(NOW);
        at.setUTCMonth(at.getUTCMonth() - months);
        return new Date(at.getTime() - ms);
    };

    test('a plan retirement eleven months ago holds an add-on retirement back, counted', async () => {
        const { service } = retiring({
            notices: await toldOf('version-retired', monthsBefore(11)),
        });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['RETIREMENT_WITHIN_TWELVE_MONTHS']);
        assert.deepEqual(preview.blockers[0].params, { count: 1 });
    });

    test('so does an add-on retirement, exactly twelve months ago too', async () => {
        const { service } = retiring({
            notices: await toldOf('bundle-version-retired', monthsBefore(12)),
        });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['RETIREMENT_WITHIN_TWELVE_MONTHS']);
    });

    test('but not one a moment longer ago, nor a notice of another kind', async () => {
        for (const notices of [
            await toldOf('bundle-version-retired', monthsBefore(12, 1)),
            await toldOf('version-offered', monthsBefore(1)),
        ]) {
            const { service } = retiring({ notices });
            assert.deepEqual(codesOf(await service.preview(RETIRED.id, REPLACEMENT.id, NOW)), []);
        }
    });

    /** `notices`, every one of them delivered to somebody at `at`. */
    function deliveredAt(notices, at) {
        for (const row of notices.rows.values()) {
            Object.assign(row, {
                deliveredAt: at,
                delivery: { recipients: ['admin@example.com'], channel: 'email' },
            });
        }
        return notices;
    }

    test('a retirement that reached somebody counts from then, though recorded long before', async () => {
        const { service } = retiring({
            notices: deliveredAt(
                await toldOf('version-retired', monthsBefore(13)),
                monthsBefore(1),
            ),
        });

        const preview = await service.preview(RETIRED.id, REPLACEMENT.id, NOW);

        assert.deepEqual(codesOf(preview), ['RETIREMENT_WITHIN_TWELVE_MONTHS']);
    });

    test('and not once it reached somebody a moment over twelve months ago', async () => {
        const { service } = retiring({
            notices: deliveredAt(
                await toldOf('bundle-version-retired', monthsBefore(14)),
                monthsBefore(12, 1),
            ),
        });

        assert.deepEqual(codesOf(await service.preview(RETIRED.id, REPLACEMENT.id, NOW)), []);
    });
});

// @requirement SC-BUN-043 — An add-on retirement waits for its notice to reach the subscriber
describe('a notice that has reached nobody yet', () => {
    test('sets no date: the booking is not pending, and the next run tells it from then', async () => {
        let up = false;
        const port = sendingPort(() => {
            if (!up) throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service } = retiring({ port });
        const result = await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sb-t1', 'sb-t2'],
            ACTOR,
            NOW,
        );
        assert.deepEqual({ told: result.told, failed: result.failed }, { told: 0, failed: 2 });
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', NOW), null);

        up = true;
        // A month later: the date counts from now, three months on.
        const later = new Date('2026-11-15T09:00:00.000Z');
        const run = await service.sendUndelivered(later);

        assert.deepEqual(run, { told: 2, failed: 0 });
        const pending = await service.pendingForBooking('sub-t1', 'sb-t1', later);
        assert.equal(pending?.effectiveAt, '2027-03-01T00:00:00.000Z');
        assert.equal(pending?.lastDayToCancel, '2027-02-28');
    });

    test('is not told once the booking no longer runs to the date', async () => {
        const port = sendingPort(() => {
            throw new Error('mail server down');
        });
        const bookings = [bookingOf('t1')];
        const { service, notices } = retiring({
            port,
            bookings,
            subscriptions: [subscriptionOf('t1')],
        });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1'], ACTOR, NOW);
        bookings[0] = {
            ...bookings[0],
            canceledAt: new Date('2026-10-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
        };

        const run = await service.sendUndelivered(new Date('2026-10-21T00:00:00.000Z'));

        assert.deepEqual(run, { told: 0, failed: 0 });
        assert.equal([...notices.rows.values()][0].deliveredAt, null);
    });
});

// @requirement SC-BUN-045 — A retirement lets a booking be cancelled without its minimum term until it takes effect
describe('cancelling a booking a retirement was told of', () => {
    const committed = bookingOf('t1', { minimumTermEndsAt: new Date('2027-06-01T00:00:00.000Z') });

    /** The booking service over one committed booking. */
    function cancelling() {
        const writes = [];
        const service = new SubscriptionBundlesService(
            {
                findById: async () => committed,
                cancel: async (id, patch) => {
                    writes.push(patch);
                    return { ...committed, ...patch };
                },
            },
            catalogueOf([RETIRED, REPLACEMENT]),
            { defaultMinimumTermMonths: 0 },
        );
        const cancel = (minimumTermLapses) =>
            service.cancelBundleFromSubscription({
                subscriptionId: 'sub-t1',
                subscriptionBundleId: 'sb-t1',
                canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                parentEndsAt: null,
                minimumTermLapses,
            });
        return { cancel, writes };
    }

    test('lands at the end of the period running, without the minimum term', async () => {
        const { cancel } = cancelling();
        const result = await cancel(true);
        assert.equal(result.canceledEffectiveAt.toISOString(), '2026-11-01T00:00:00.000Z');
    });

    test('and with it where no retirement is pending', async () => {
        const { cancel } = cancelling();
        const result = await cancel(false);
        assert.equal(result.canceledEffectiveAt.toISOString(), '2027-06-01T00:00:00.000Z');
    });

    test('is pending until the date, and no longer from it', async () => {
        const { service } = retiring();
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
        const date = new Date('2027-02-01T00:00:00.000Z');

        assert.ok(await service.pendingForBooking('sub-t1', 'sb-t1', new Date(date.getTime() - 1)));
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', date), null);
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t2', NOW), null);
    });
});

// @requirement SC-BUN-047 — The operator sees how far each add-on retirement has come
describe('how far an add-on retirement has come', () => {
    test('counts its bookings waiting, not told, ended by their date and overdue', async () => {
        const failing = sendingPort((notice) => {
            if (notice.subscriptionBundleId === 'sb-t3') throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const bookings = [bookingOf('t1'), bookingOf('t2'), bookingOf('t3')];
        const { service } = retiring({
            port: failing,
            bookings,
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2'), subscriptionOf('t3')],
        });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2', 'sb-t3'], ACTOR, NOW);
        // t2 cancels before the date, without its term.
        bookings[1] = {
            ...bookings[1],
            canceledAt: new Date('2026-12-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        };

        const [before] = await service.list(NOW);
        const [after] = await service.list(new Date('2027-02-02T00:00:00.000Z'));

        assert.deepEqual(before.progress, {
            moved: 0,
            waiting: 1,
            overdue: 0,
            ended: 1,
            notTold: 1,
            reminded: 0,
        });
        assert.equal(after.progress.overdue, 1, 'past its date and not moved');
    });
});

// @requirement SC-BUN-048 — A booking a retirement did not reach is not reinstated on the retired version
describe('reinstating a booking of a version being retired', () => {
    /** An announcement that reached t1 and skipped t2, cancelled to end before its date. */
    async function announcedWithT2Cancelled() {
        const bookings = [
            bookingOf('t1'),
            bookingOf('t2', {
                canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
            }),
        ];
        const retirement = retiring({ bookings });
        retirement.bookings = bookings;
        await retirement.service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1'], ACTOR, NOW);
        return retirement;
    }

    test('is refused where the announcement did not reach it, naming the replacement', async () => {
        const { service } = await announcedWithT2Cancelled();

        const refusal = await service.refusalToReinstate('sub-t2', 'sb-t2');

        assert.deepEqual(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
        assert.deepEqual(refusal?.params, {
            bundleKey: 'REPORTS',
            version: 1,
            replacementVersion: 2,
        });
    });

    test('is not refused where its notice still waits, and the next run tells it', async () => {
        let answer = { recipients: [], channel: 'email' };
        const bookings = [bookingOf('t1'), bookingOf('t2')];
        const { service } = retiring({ bookings, port: sendingPort(() => answer) });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
        const later = new Date('2026-10-20T00:00:00.000Z');
        // Cancelled to end before its date while the notice reaches nobody:
        // the run passes it over, and nobody was told.
        bookings[0] = {
            ...bookings[0],
            canceledAt: new Date('2026-10-16T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
        };
        await service.sendUndelivered(later);
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', later), null);

        assert.equal(await service.refusalToReinstate('sub-t1', 'sb-t1'), null);
        bookings[0] = { ...bookings[0], canceledAt: null, canceledEffectiveAt: null };
        answer = { recipients: ['admin@example.com'], channel: 'email' };
        await service.sendUndelivered(later);

        const told = await service.pendingForBooking('sub-t1', 'sb-t1', later);
        assert.ok(told, 'reinstated, it is told by the next run and moves at its date');
        assert.ok(new Date(told.effectiveAt) > later);
    });

    test('is not refused where it was reached, nor on a version nobody retired', async () => {
        const { service } = await announcedWithT2Cancelled();
        const untouched = retiring();

        assert.equal(await service.refusalToReinstate('sub-t1', 'sb-t1'), null);
        assert.equal(await untouched.service.refusalToReinstate('sub-t2', 'sb-t2'), null);
    });
});

/** The tenant's add-on route over one subscription and `bundleRetirements`. */
function routeOver(bundleRetirements) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const calls = [];
    const service = {
        listForSubscription: async () => [
            { ...bookingOf('t1'), bundleKey: 'REPORTS', label: 'Reports', priceNet: 9.9 },
            {
                ...bookingOf('t1', { id: 'sb-other', bundleVersionId: 'bv-other' }),
                bundleKey: 'OTHER',
                label: 'Other',
                priceNet: 1,
            },
        ],
        cancelBundleFromSubscription: async (input) => (calls.push(['cancel', input]), {}),
        reactivateBundle: async (input) => (calls.push(['reactivate', input]), {}),
    };
    const ctrl = new Ctrl(
        service,
        { previewCancel: async (_ctx, input) => (calls.push(['previewCancel', input]), {}) },
        { findForTenant: async () => subscriptionOf('t1').subscription },
        () => 't1',
        null,
        null,
        { of: async () => [] },
        bundleRetirements,
    );
    return { ctrl, calls };
}

const REQ = { user: { tenantId: 't1' } };

describe('the tenant’s add-on route and a retirement told', () => {
    const told = { ...{ subscriptionBundleId: 'sb-t1', retired: { bundleVersionId: 'bv-1' } } };

    // @requirement SC-BUN-046 — A tenant sees the retirement of an add-on's version beside the add-on
    test('lists each booking with the retirement of the version it is on', async () => {
        const { ctrl } = routeOver({ toldForSubscription: async () => [told] });

        const listed = await ctrl.list(REQ);

        assert.deepEqual(
            listed.map((view) => [view.id, view.retirement]),
            [
                ['sb-t1', told],
                ['sb-other', null],
            ],
        );
    });

    // @requirement SC-BUN-045 — A retirement lets a booking be cancelled without its minimum term until it takes effect
    test('cancels without the minimum term while one is pending, asked by the server’s clock', async () => {
        const asked = [];
        const { ctrl, calls } = routeOver({
            pendingForBooking: async (subscriptionId, bookingId, at) => {
                asked.push(at);
                return bookingId === 'sb-t1' ? told : null;
            },
        });
        const before = Date.now();

        // A date the caller sends long before the date does not reach the check.
        await ctrl.cancel(REQ, 'sb-t1', { canceledAt: '2026-01-01T00:00:00.000Z' });
        await ctrl.cancel(REQ, 'sb-other', {});
        await ctrl.preview(REQ, { subscriptionBundleId: 'sb-t1' });

        const cancels = calls.filter(([what]) => what === 'cancel').map(([, input]) => input);
        assert.deepEqual(
            cancels.map((input) => input.minimumTermLapses),
            [true, false],
        );
        assert.equal(calls.find(([what]) => what === 'previewCancel')[1].minimumTermLapses, true);
        assert.ok(
            asked.every((at) => at.getTime() >= before),
            'asked about now, not the date sent',
        );
    });

    // @requirement SC-BUN-048 — A booking a retirement did not reach is not reinstated on the retired version
    test('refuses to reinstate what the retirement service refuses, and writes nothing', async () => {
        const refusal = { code: 'BUNDLE_RETIREMENT_REINSTATE_REFUSED', message: 'no', params: {} };
        const { ctrl, calls } = routeOver({ refusalToReinstate: async () => refusal });

        const error = await rejection(ctrl.reactivate(REQ, 'sb-t1'));

        assert.equal(error.getResponse().code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
        assert.deepEqual(calls, []);
    });

    test('without add-on retirements wired, lists, cancels and reinstates as before', async () => {
        const { ctrl, calls } = routeOver(null);

        const listed = await ctrl.list(REQ);
        await ctrl.cancel(REQ, 'sb-t1', {});
        await ctrl.reactivate(REQ, 'sb-t1');

        assert.deepEqual(
            listed.map((view) => view.retirement),
            [null, null],
        );
        assert.equal(calls[0][1].minimumTermLapses, false);
        assert.equal(calls[1][0], 'reactivate');
    });
});

// @requirement SC-BUN-043 — An add-on retirement waits for its notice to reach the subscriber
describe('the quarter-hour run', () => {
    test('sends the add-on retirement notices an announcement could not, after the plan’s', async () => {
        const calls = [];
        const cron = new VersionNoticeCron(
            { sendDue: async () => (calls.push('offers'), { told: 0, failed: 0 }) },
            null,
            {
                sendUndelivered: async () => (
                    calls.push('plan retirements'),
                    { told: 0, failed: 0 }
                ),
            },
            null,
            null,
            {
                sendUndelivered: async () => (
                    calls.push('add-on retirements'),
                    { told: 1, failed: 0 }
                ),
            },
        );

        await cron.sendDueNotices();

        assert.deepEqual(calls, ['offers', 'plan retirements', 'add-on retirements']);
    });
});
