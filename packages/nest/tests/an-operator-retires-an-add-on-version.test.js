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
import {
    ACTOR,
    NOW,
    REPLACEMENT,
    RETIRED,
    addOnVersion,
    announcementStore,
    bookingIdsOf,
    bookingOf,
    catalogueOf,
    codesOf,
    rejection,
    retiring,
    subscriptionOf,
    toldOfAPlanRetirementOntoPro,
} from './helpers/add-on-retirement-fixtures.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

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
    const listing = {
        listOfVersion: async () => [],
        moveToVersion: async () => null,
        findById: async () => null,
    };
    const reading = { listByIds: async () => [] };

    test('does not start without a way to list the bookings of a version, naming it', () => {
        assert.throws(() => over({ findById: async () => null }, reading).onModuleInit(), {
            message: /listOfVersion/,
        });
    });

    test('nor without a way to read subscriptions by id, naming it', () => {
        assert.throws(() => over(listing, {}).onModuleInit(), { message: /listByIds/ });
    });

    test('nor without a way to move a booking onto another version, naming it', () => {
        const { moveToVersion: _moves, ...withoutMoving } = listing;
        assert.throws(() => over(withoutMoving, reading).onModuleInit(), {
            message: /moveToVersion/,
        });
    });

    test('starts with all three, and without any while the terms are not confirmed', () => {
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
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2'), subscriptionOf('t3')],
            bookings: [
                bookingOf('t1'),
                bookingOf('t2', {
                    canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
                }),
                // Ended a year ago on a subscription that still runs.
                bookingOf('t3', {
                    canceledAt: new Date('2025-09-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2025-10-01T00:00:00.000Z'),
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
            {
                tenantId: 't3',
                subscriptionId: 'sub-t3',
                subscriptionBundleId: 'sb-t3',
                reason: 'ended',
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

// @requirement SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date
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

    test('asks about the plan a retirement it was told of moves the subscription to by the date', async () => {
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const { service } = retiring({
            versions: [RETIRED, standardOnly],
            notices: await toldOfAPlanRetirementOntoPro(),
        });

        const preview = await service.preview(RETIRED.id, standardOnly.id, NOW);

        assert.deepEqual(codesOf(preview), ['BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN']);
        assert.equal(preview.blockers[0].params.count, 1);
        assert.deepEqual(
            preview.reached.map((row) => row.planKey),
            ['PRO', 'STANDARD'],
        );
    });

    test('and about a plan a change moves the subscription to after the date', async () => {
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const movingOn = (pendingEffectiveAt) =>
            retiring({
                versions: [RETIRED, standardOnly],
                subscriptions: [
                    subscriptionOf('t1', {
                        pendingPlan: 'PRO',
                        pendingBillingCycle: 'YEARLY',
                        pendingEffectiveAt,
                    }),
                    subscriptionOf('t2'),
                ],
            }).service.preview(RETIRED.id, standardOnly.id, NOW);

        // The booking's date is 1 February 2027: a change landing on it, and
        // one landing a month later, both meet the version it continues on.
        const onTheDate = await movingOn(new Date('2027-02-01T00:00:00.000Z'));
        const after = await movingOn(new Date('2027-03-01T00:00:00.000Z'));

        assert.equal(onTheDate.blockers[0]?.params.count, 1);
        assert.deepEqual(
            onTheDate.reached.map((row) => row.planKey),
            ['PRO', 'STANDARD'],
        );
        assert.equal(after.blockers[0]?.params.count, 1);
        assert.deepEqual(
            after.reached.map((row) => row.planKey),
            ['STANDARD', 'STANDARD'],
        );
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

    test('and beside the plan a retirement it was told of moves it to by the date', async () => {
        const { service, port } = retiring({ notices: await toldOfAPlanRetirementOntoPro() });

        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);

        const [movingToPro, staying] = port.sent;
        assert.equal(movingToPro.planKey, 'PRO');
        assert.equal(movingToPro.replacement.monthlyNet, 10.9, 'the override for Pro');
        assert.equal(staying.planKey, 'STANDARD');
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
        // this one recorded it after the preview. The preview reads four times
        // — the plan retirements told, the twelve months of either kind, and
        // this version's notices — and sees none of it.
        const real = notices.listOfKindSince.bind(notices);
        let reads = 0;
        notices.listOfKindSince = async (kind, since) => {
            reads += 1;
            return reads <= 4 ? [] : real(kind, since);
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

    /** A notice of `kind` recorded for the subscription of t1 at `at`, told then unless `told` is false. */
    async function toldOf(kind, at, { told = true } = {}) {
        const notices = noticeRecord();
        await notices.record(
            [{ tenantId: 't1', subscriptionId: 'sub-t1', kind, subject: 'other', content: {} }],
            at,
        );
        return told ? deliveredAt(notices, at) : notices;
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

    test('a notice still waiting for somebody to tell holds nothing back', async () => {
        const { service } = retiring({
            notices: await toldOf('version-retired', monthsBefore(1), { told: false }),
        });

        assert.deepEqual(codesOf(await service.preview(RETIRED.id, REPLACEMENT.id, NOW)), []);
    });

    test('a waiting notice goes out only twelve months after the subscription was told of another', async () => {
        let answer = { recipients: [], channel: 'email' };
        const notices = noticeRecord();
        const { service } = retiring({ notices, port: sendingPort(() => answer) });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
        // Meanwhile sub-t1 is told of the retirement of its plan version.
        await notices.record(
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    kind: 'version-retired',
                    subject: 'pv-other',
                    content: {},
                },
            ],
            NOW,
        );
        Object.assign(
            [...notices.rows.values()].find((row) => row.subject === 'pv-other'),
            { deliveredAt: NOW, delivery: { recipients: ['admin@example.com'], channel: 'email' } },
        );
        answer = { recipients: ['admin@example.com'], channel: 'email' };

        await service.sendUndelivered(new Date('2026-10-20T09:00:00.000Z'));
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', NOW), null);
        assert.ok(await service.pendingForBooking('sub-t2', 'sb-t2', NOW));

        const yearOn = new Date('2027-10-16T09:00:00.000Z');
        await service.sendUndelivered(yearOn);
        assert.ok(await service.pendingForBooking('sub-t1', 'sb-t1', yearOn));
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

// @requirement SC-BUN-053 — The operator sees how far an add-on retirement has come, and what is still to move
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
            notToldReasons: { doesNotFit: 0, twelveMonths: 0, noLongerReached: 0, nobodyYet: 1 },
            reminded: 0,
        });
        assert.equal(after.progress.overdue, 1, 'past its date and not moved');
    });

    test('counts a booking that ended past its date before anything moved it as ended', async () => {
        const failing = sendingPort((notice) => {
            if (notice.subscriptionBundleId === 'sb-t2') throw new Error('mail server down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const tenants = ['t1', 't2', 't3', 't4'];
        const bookings = tenants.map((tenantId) => bookingOf(tenantId));
        const subscriptions = tenants.map((tenantId) => subscriptionOf(tenantId));
        const { service } = retiring({ port: failing, bookings, subscriptions });
        await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            bookings.map((booking) => booking.id),
            ACTOR,
            NOW,
        );
        // Nothing moves them, and all end on 1 March, a month after the date:
        // t1's booking, told; t2's, never told; t3's subscription. t4 runs on.
        const cancelled = {
            canceledAt: new Date('2027-02-10T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-03-01T00:00:00.000Z'),
        };
        for (const index of [0, 1]) bookings[index] = { ...bookings[index], ...cancelled };
        subscriptions[2] = subscriptionOf('t3', cancelled);
        const counted = ({ progress }) => [progress.overdue, progress.notTold, progress.ended];

        const [running] = await service.list(new Date('2027-02-15T00:00:00.000Z'));
        const [ended] = await service.list(new Date('2027-03-02T00:00:00.000Z'));

        assert.deepEqual(counted(running), [3, 1, 0]);
        assert.deepEqual(counted(ended), [1, 0, 3]);
    });

    // @requirement SC-BUN-052 — The operator sees why an add-on retirement's notice still waits
    test('says why each notice not told yet waits, as the run that sends them would', async () => {
        // v2 here runs beside Standard only. None is told: t1 has nothing
        // holding it back; t2's subscription now ends before the date a notice
        // sent on 1 December would set; t3 was told of a plan retirement on
        // 1 November; t4 sets a move to Pro before its date, and was told of
        // one on 1 November too, counted by the first that holds it.
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const subscriptions = ['t1', 't2', 't3', 't4'].map((tenantId) => subscriptionOf(tenantId));
        const { service, notices } = retiring({
            subscriptions,
            bookings: ['t1', 't2', 't3', 't4'].map((tenantId) => bookingOf(tenantId)),
            versions: [RETIRED, standardOnly],
            port: sendingPort({ recipients: [], channel: 'email' }),
        });
        await service.announce(
            RETIRED.id,
            REPLACEMENT.id,
            ['sb-t1', 'sb-t2', 'sb-t3', 'sb-t4'],
            ACTOR,
            NOW,
        );
        subscriptions[1] = subscriptionOf('t2', {
            canceledAt: new Date('2026-11-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-02-15T00:00:00.000Z'),
        });
        await notices.record(
            ['t3', 't4'].map((tenantId) => ({
                tenantId,
                subscriptionId: `sub-${tenantId}`,
                kind: 'version-retired',
                subject: 'pv-other',
                content: {},
            })),
            new Date('2026-11-01T00:00:00.000Z'),
        );
        for (const row of notices.rows.values()) {
            if (row.kind !== 'version-retired') continue;
            Object.assign(row, {
                deliveredAt: new Date('2026-11-01T00:00:00.000Z'),
                delivery: { recipients: ['admin@example.com'], channel: 'email' },
            });
        }
        subscriptions[3] = subscriptionOf('t4', {
            pendingPlan: 'PRO',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        });

        const [retirement] = await service.list(new Date('2026-12-01T00:00:00.000Z'));

        assert.equal(retirement.progress.notTold, 4);
        assert.deepEqual(retirement.progress.notToldReasons, {
            doesNotFit: 1,
            twelveMonths: 1,
            noLongerReached: 1,
            nobodyYet: 1,
        });
    });
});

// @requirement SC-BUN-043 — An add-on retirement waits for its notice to reach the subscriber
// @requirement SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date
describe('a notice that waited, and the plan the add-on runs beside by then', () => {
    test('is not sent while the replacement could not run beside it, and is once it can', async () => {
        let answer = { recipients: [], channel: 'email' };
        // v2 here is sold beside Standard only.
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const { service } = retiring({
            subscriptions,
            versions: [RETIRED, standardOnly],
            port: sendingPort(() => answer),
        });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
        // While the notice waits, t1 sets a move to Pro before the date.
        subscriptions[0] = subscriptionOf('t1', {
            pendingPlan: 'PRO',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        });
        answer = { recipients: ['admin@example.com'], channel: 'email' };
        const later = new Date('2026-10-20T09:00:00.000Z');

        await service.sendUndelivered(later);
        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', later), null);
        assert.ok(await service.pendingForBooking('sub-t2', 'sb-t2', later));

        subscriptions[0] = subscriptionOf('t1');
        await service.sendUndelivered(later);
        assert.ok(await service.pendingForBooking('sub-t1', 'sb-t1', later));
    });

    test('is not sent either while a change set meanwhile moves it after the date', async () => {
        let answer = { recipients: [], channel: 'email' };
        const standardOnly = { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } };
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const { service } = retiring({
            subscriptions,
            versions: [RETIRED, standardOnly],
            port: sendingPort(() => answer),
        });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
        // The date is 1 February 2027; the move to Pro lands a month after it.
        subscriptions[0] = subscriptionOf('t1', {
            pendingPlan: 'PRO',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2027-03-01T00:00:00.000Z'),
        });
        answer = { recipients: ['admin@example.com'], channel: 'email' };
        const later = new Date('2026-10-20T09:00:00.000Z');

        await service.sendUndelivered(later);

        assert.equal(await service.pendingForBooking('sub-t1', 'sb-t1', later), null);
        assert.ok(await service.pendingForBooking('sub-t2', 'sb-t2', later));
    });
});

// @requirement SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date
describe('the replacements a plan change asks about', () => {
    test('are the bookings told of a retirement, each with the version it continues on', async () => {
        const { service } = retiring();
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);

        assert.deepEqual(await service.addOnsAhead('sub-t1'), [
            {
                subscriptionBundleId: 'sb-t1',
                retiredBundleVersionId: 'bv-1',
                replacementBundleVersionId: 'bv-2',
                effectiveAt: '2027-02-01T00:00:00.000Z',
            },
        ]);
    });

    test('and none where nothing was told', async () => {
        const { service } = retiring({ port: sendingPort({ recipients: [], channel: 'email' }) });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);

        assert.deepEqual(await service.addOnsAhead('sub-t1'), []);
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

        const refusal = await service.refusalToReinstate('sub-t2', 'sb-t2', NOW);

        assert.deepEqual(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
        assert.deepEqual(refusal?.params, {
            bundleKey: 'REPORTS',
            version: 1,
            replacementVersion: 2,
            bookableFrom: '2026-11-01',
        });
    });

    test('names the day after where the booking ends during one', async () => {
        const bookings = [
            bookingOf('t1'),
            bookingOf('t2', {
                canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-11-01T15:30:00.000Z'),
            }),
        ];
        const { service } = retiring({ bookings });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1'], ACTOR, NOW);

        const refusal = await service.refusalToReinstate('sub-t2', 'sb-t2', NOW);

        assert.equal(refusal?.params.bookableFrom, '2026-11-02');
    });

    /**
     * t1 on Pro unless `t1` says otherwise, reached, its booking as `t1Booking`
     * says; t2 on Standard unless `t2` says otherwise, cancelled to end on 1
     * November and not reached; the replacement as `replacement`; asked `now`.
     */
    async function refusalForT2({
        t1 = { plan: 'PRO' },
        t2 = {},
        t1Booking = {},
        replacement,
        now = NOW,
    }) {
        const bookings = [
            bookingOf('t1', t1Booking),
            bookingOf('t2', {
                canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
            }),
        ];
        const { service } = retiring({
            subscriptions: [subscriptionOf('t1', t1), subscriptionOf('t2', t2)],
            bookings,
            versions: [RETIRED, replacement],
        });
        await service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1'], ACTOR, NOW);
        return service.refusalToReinstate('sub-t2', 'sb-t2', now);
    }
    const proOnly = { ...REPLACEMENT, compatibility: { planIds: ['PRO'] } };

    test('says the replacement cannot run beside its plan where it cannot, and names no day', async () => {
        const refusal = await refusalForT2({ replacement: proOnly });

        assert.equal(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN');
        assert.deepEqual(refusal?.params, {
            bundleKey: 'REPORTS',
            version: 1,
            replacementVersion: 2,
        });
    });

    test('asks of the plan the subscription is on when the booking ends', async () => {
        const refusal = await refusalForT2({
            replacement: proOnly,
            t2: {
                pendingPlan: 'PRO',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: new Date('2026-11-01T00:00:00.000Z'),
            },
        });

        assert.equal(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
        assert.equal(refusal?.params.bookableFrom, '2026-11-01');
    });

    test('names the day where the replacement can be booked in the plan’s rhythm only', async () => {
        const refusal = await refusalForT2({
            replacement: { ...REPLACEMENT, monthlyNet: null, pricingOverrides: [] },
            t1Booking: {
                billingCycle: 'YEARLY',
                currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
                currentPeriodEnd: new Date('2027-03-01T00:00:00.000Z'),
            },
        });

        assert.equal(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
    });

    test('answers nothing once the cancellation has landed: the booking route says so', async () => {
        const refusal = await refusalForT2({
            replacement: REPLACEMENT,
            now: new Date('2026-11-01T00:00:00.000Z'),
        });

        assert.equal(refusal, null);
    });

    test('says the subscription ends by then where it does, and names no day', async () => {
        const subscriptionEnding = (canceledEffectiveAt) =>
            refusalForT2({
                replacement: REPLACEMENT,
                t2: { canceledAt: new Date('2026-10-01T00:00:00.000Z'), canceledEffectiveAt },
            });

        const withIt = await subscriptionEnding(new Date('2026-11-01T00:00:00.000Z'));
        const aDayLater = await subscriptionEnding(new Date('2026-11-02T00:00:00.000Z'));

        assert.equal(withIt?.code, 'BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS');
        assert.deepEqual(withIt?.params, {
            bundleKey: 'REPORTS',
            version: 1,
            replacementVersion: 2,
        });
        assert.equal(aDayLater?.code, 'BUNDLE_RETIREMENT_REINSTATE_REFUSED');
    });

    test('asks the plans the subscription is set to move to after that day', async () => {
        const refusal = await refusalForT2({
            t1: {},
            replacement: { ...REPLACEMENT, compatibility: { planIds: ['STANDARD'] } },
            t2: {
                pendingPlan: 'PRO',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
            },
        });

        assert.equal(refusal?.code, 'BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN');
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

        assert.equal(await service.refusalToReinstate('sub-t1', 'sb-t1', NOW), null);
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

        assert.equal(await service.refusalToReinstate('sub-t1', 'sb-t1', NOW), null);
        assert.equal(await untouched.service.refusalToReinstate('sub-t2', 'sb-t2', NOW), null);
    });
});

/** The tenant's add-on route over one subscription and `bundleRetirements`; t1's booking as `booking` says. */
function routeOver(bundleRetirements, booking = {}) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const calls = [];
    const service = {
        listForSubscription: async () => [
            { ...bookingOf('t1', booking), bundleKey: 'REPORTS', label: 'Reports', priceNet: 9.9 },
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
    const told = {
        subscriptionBundleId: 'sb-t1',
        retired: { bundleVersionId: 'bv-1' },
        effectiveAt: '2027-02-01T00:00:00.000Z',
    };

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

    // @requirement SC-BUN-046 — A tenant sees the retirement of an add-on's version beside the add-on
    test('lists no retirement on a booking cancelled to end by its date, and keeps it on one that runs past', async () => {
        const cancelled = (endsAt) =>
            routeOver(
                { toldForSubscription: async () => [told] },
                {
                    canceledAt: new Date('2026-10-16T00:00:00.000Z'),
                    canceledEffectiveAt: new Date(endsAt),
                },
            ).ctrl.list(REQ);

        const endingBefore = await cancelled('2027-02-01T00:00:00.000Z');
        const endingAfter = await cancelled('2027-03-01T00:00:00.000Z');

        assert.equal(endingBefore[0].retirement, null);
        assert.equal(endingAfter[0].retirement, told);
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

    // @requirement SC-BUN-049 — A booking continues on the replacement at the date it was told
    test('moves the add-on bookings whose date has come, after the plan’s subscriptions', async () => {
        const calls = [];
        const cron = new VersionNoticeCron(
            { sendDue: async () => ({ told: 0, failed: 0 }) },
            null,
            null,
            { moveDue: async () => (calls.push('plan moves'), { moved: 0, failed: 0 }) },
            null,
            null,
            { moveDue: async () => (calls.push('add-on moves'), { moved: 1, failed: 0 }) },
        );

        await cron.sendDueNotices();

        assert.deepEqual(calls, ['plan moves', 'add-on moves']);
    });
});
