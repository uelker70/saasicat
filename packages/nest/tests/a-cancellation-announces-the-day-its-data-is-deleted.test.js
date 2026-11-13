// Before a tenant confirms its cancellation, the account it reads states the
// read-only period, the last day it can still read on and the day its data is
// deleted on; confirming records exactly those days, and the end is later
// recorded with them. A page that showed another day is asked again before
// anything is written, and a request that lost the cancellation to another
// announces nothing.
//
// The route reads the real clock, so a term that ends here ends decades ahead,
// and a case that lands at once compares against the moment the answer names
// rather than against a clock of its own.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { addDaysToDay, dayInZone } from '@saasicat/core';

import {
    FeatureWithdrawalTenantController,
    SubscriptionEndService,
    TenantBillingController,
} from '../dist/billing/index.js';
import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from '../dist/admin/index.js';
import { FakeSubscriptionEndRepository } from '../dist/testing/index.js';
import { usageRecord } from './helpers/subscription-fixtures.js';
import { cancellationsOver, tenantBillingRoutes } from './helpers/tenant-billing-routes.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
const UTC = { timeZone: 'UTC' };
const THIRTY_DAYS = { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] };
/** Half past midnight into 1 January 2100 in Berlin: still 31 December 2099 in UTC. */
const TERM_ENDS = new Date('2099-12-31T23:30:00.000Z');
/** What cancelling for that end announces in Berlin, with thirty read-only days. */
const ANNOUNCED_IN_BERLIN = {
    readOnlyDays: 30,
    readOnlyUntil: '2100-01-30',
    deletesOn: '2100-01-31',
};
const ADMIN = {
    user: { tenantId: 't1', sub: 'u-admin', email: 'admin@t1.example' },
    headers: {},
};
const OTHER_ADMIN = {
    user: { tenantId: 't1', sub: 'u-other', email: 'other@t1.example' },
    headers: {},
};
/** How the audit log tags each of them, as the announcement names who confirmed. */
const ADMIN_TAG = 'web:admin@t1.example:s1';
const OTHER_ADMIN_TAG = 'web:other@t1.example:s1';

/** A running monthly subscription whose term ends at `TERM_ENDS`; `fields` say what a case is about. */
function subscriptionWith(fields = {}) {
    return usageRecord({
        id: 'sub-t1',
        billingCycle: 'MONTHLY',
        currentPeriodEnd: TERM_ENDS,
        ...fields,
    });
}

/** A trial without dates: nothing is left to run, so it is cancelled at once. */
const NOTHING_LEFT_TO_RUN = { status: 'TRIAL', currentPeriodEnd: null };

/** Cancelled for `TERM_ENDS`, which has not come yet. */
const CANCELLED_FOR_THE_TERM_END = {
    canceledAt: new Date('2099-06-01T08:00:00.000Z'),
    canceledEffectiveAt: TERM_ENDS,
};

/**
 * The tenant's routes over one subscription, the cancellation service they
 * project and declare through, and what they wrote: the cancellation claims,
 * the announcements, the audit entries and the contracts ended. The write
 * claims the cancellation the way a store's conditional write does — the first
 * takes it, any later one finds it taken. `withEnds: false` stands for a module
 * wired without the end of a subscription; `noticeDays` is the notice the
 * file names, none unless a case is about it.
 */
function account({
    subscription = subscriptionWith(),
    settings = BERLIN,
    withEnds = true,
    ends = new FakeSubscriptionEndRepository(),
    noticeDays = { monthly: 0, yearly: 0 },
} = {}) {
    const seen = { subscription, ends, claims: [], audited: [], contractsEnded: [] };
    const usage = {
        findForTenant: async () => seen.subscription,
        listCancelled: async () => [],
    };
    const writes = {
        async cancelSubscription(_tenantId, input) {
            const stored = seen.subscription;
            if ((stored.canceledEffectiveAt ?? stored.canceledAt) !== null) {
                return {
                    canceledAt: stored.canceledAt,
                    canceledEffectiveAt: stored.canceledEffectiveAt,
                    status: stored.status,
                    alreadyCanceled: true,
                };
            }
            seen.claims.push(input);
            seen.subscription = {
                ...stored,
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: input.terminateNow ? 'CANCELED' : stored.status,
            };
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: seen.subscription.status,
                alreadyCanceled: false,
            };
        },
    };
    const endService = new SubscriptionEndService(usage, ends, THIRTY_DAYS, settings);
    endService.onModuleInit();
    seen.endService = endService;
    seen.writes = writes;
    const ports = {
        entitlements: {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        planPreview: {
            async planPriceNet() {
                return 49;
            },
        },
        subscriptionUsage: usage,
        usageSnapshot: { snapshot: async () => ({}) },
        subscriptionWrite: writes,
        tenantIdResolver: () => 't1',
        userIdResolver: (req) => req.user.sub,
        auditService: { log: async (entry) => seen.audited.push(entry) },
        userEmailResolver: (req) => req.user.email,
        auditContextResolver: () => 's1',
        contractFreeze: {
            endOnCancellation: async (_tenantId, at) => seen.contractsEnded.push(at),
        },
        noticeDays,
        settings,
        subscriptionEnds: withEnds ? endService : null,
    };
    seen.cancellations = cancellationsOver(ports);
    seen.controller = tenantBillingRoutes({ ...ports, cancellations: seen.cancellations });
    return seen;
}

/** The body of the refusal `promise` ends in, with its status. */
async function refusalOf(promise) {
    try {
        await promise;
    } catch (error) {
        return { status: error.getStatus?.(), ...error.getResponse?.() };
    }
    throw new Error('expected a refusal');
}

/** What the store keeps of each announcement, without the id it assigned. */
const announced = (ends) => ends.announcements.map(({ id: _id, ...kept }) => kept);

// @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
describe('what the account says cancelling now would tell the tenant', () => {
    test('for a cancellation landing at the term end: the days counted from that end, in the installation’s zone', async () => {
        const inBerlin = await account().controller.getUsage(ADMIN);
        assert.deepEqual(inBerlin.cancellation.deletion, ANNOUNCED_IN_BERLIN);

        // The same moment is still 31 December in UTC, so the period starts a day earlier.
        const inUtc = await account({ settings: UTC }).controller.getUsage(ADMIN);
        assert.deepEqual(inUtc.cancellation.deletion, {
            readOnlyDays: 30,
            readOnlyUntil: '2100-01-29',
            deletesOn: '2100-01-30',
        });
    });

    test('for one landing at once: the days counted from the moment it would land', async () => {
        const { cancellation } = await account({
            subscription: subscriptionWith(NOTHING_LEFT_TO_RUN),
        }).controller.getUsage(ADMIN);

        const landsOn = dayInZone(new Date(cancellation.effectiveAt), BERLIN.timeZone);
        assert.deepEqual(cancellation.deletion, {
            readOnlyDays: 30,
            readOnlyUntil: addDaysToDay(landsOn, 29),
            deletesOn: addDaysToDay(landsOn, 30),
        });
    });

    test('and says nothing was told while nothing was confirmed', async () => {
        const usage = await account().controller.getUsage(ADMIN);
        assert.equal(usage.announcedDeletion, null);
    });
});

// @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
describe('what the account says confirming a cancellation already declared would leave on record', () => {
    /** The end of a yearly term, at midnight in UTC: its last day is 31 January 2027. */
    const YEAR_ENDS = new Date('2027-02-01T00:00:00.000Z');
    /** Past the ninety days' notice before it: cancelling now would land a year later. */
    const AFTER_THE_DEADLINE = new Date('2027-01-15T10:00:00.000Z');
    /** Thirty days from the date the declared cancellation lands on. */
    const COUNTED_FROM_ITS_DATE = {
        readOnlyDays: 30,
        readOnlyUntil: '2027-03-02',
        deletesOn: '2027-03-03',
    };
    /** The tenant's administrator, as the routes build them into the audit log. */
    const ACTOR = { userId: 'u-admin', email: 'admin@t1.example', source: 'web', context: 's1' };

    /** Cancelled on time for `YEAR_ENDS`, with ninety days' notice in the file. */
    const declaredOnTime = ({ ends } = {}) =>
        account({
            subscription: subscriptionWith({
                billingCycle: 'YEARLY',
                currentPeriodEnd: YEAR_ENDS,
                canceledAt: new Date('2026-09-01T08:00:00.000Z'),
                canceledEffectiveAt: YEAR_ENDS,
            }),
            settings: UTC,
            noticeDays: { monthly: 0, yearly: 90 },
            ends,
        });

    test('told no day: the day counted from the date it lands on, which a repeat sent back with it records', async () => {
        const { cancellations, subscription, ends, claims, audited } = declaredOnTime();

        const { cancellation } = await cancellations.projectionFor(
            't1',
            subscription,
            AFTER_THE_DEADLINE,
        );
        assert.deepEqual(cancellation.effectiveAt, new Date('2028-02-01T00:00:00.000Z'));
        assert.deepEqual(cancellation.deletion, COUNTED_FROM_ITS_DATE);

        const again = await cancellations.declare(
            't1',
            { expectedDeletesOn: cancellation.deletion.deletesOn },
            ACTOR,
            AFTER_THE_DEADLINE,
        );

        assert.deepEqual(again.deletion, COUNTED_FROM_ITS_DATE);
        assert.deepEqual(
            ends.announcements.map(({ endsAt, deletesOn }) => [endsAt, deletesOn]),
            [[YEAR_ENDS, '2027-03-03']],
        );
        assert.deepEqual(
            audited.map(({ action, changes }) => [action, changes.deletesOn]),
            [['ANNOUNCE_DELETION_DAY', '2027-03-03']],
        );
        assert.deepEqual(claims, [], 'the cancellation is left as it was');
    });

    test('told no day: a repeat sent the day counted from where cancelling now would land is refused, with the day counted from its date', async () => {
        const { cancellations, ends } = declaredOnTime();

        const refusal = await refusalOf(
            cancellations.declare(
                't1',
                { expectedDeletesOn: '2028-03-02' },
                ACTOR,
                AFTER_THE_DEADLINE,
            ),
        );

        assert.equal(refusal.code, 'CANCELLATION_TERMS_CHANGED');
        assert.deepEqual(refusal.deletion, COUNTED_FROM_ITS_DATE);
        assert.deepEqual(ends.announcements, []);
    });

    test('told a day: that day, as announcedDeletion names it', async () => {
        const ends = new FakeSubscriptionEndRepository();
        await ends.announce({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt: YEAR_ENDS,
            readOnlyDays: 90,
            deletesOn: '2027-05-02',
            announcedAt: new Date('2026-09-01T08:00:00.000Z'),
            announcedBy: ADMIN_TAG,
        });
        const { cancellations, subscription } = declaredOnTime({ ends });

        const projected = await cancellations.projectionFor('t1', subscription, AFTER_THE_DEADLINE);

        assert.deepEqual(projected.cancellation.deletion, {
            readOnlyDays: 90,
            readOnlyUntil: '2027-05-01',
            deletesOn: '2027-05-02',
        });
        assert.deepEqual(projected.cancellation.deletion, projected.announcedDeletion);
    });

    test('landed: none, since nothing is told afterwards', async () => {
        const { cancellations, subscription } = declaredOnTime();

        const projected = await cancellations.projectionFor(
            't1',
            subscription,
            new Date('2027-03-01T10:00:00.000Z'),
        );

        assert.equal(projected.cancellation.deletion, null);
    });
});

describe('confirming a cancellation', () => {
    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('records exactly the days the account stated, and the answer, the audit entry and the account afterwards repeat them', async () => {
        const { controller, ends, audited } = account();
        const shown = (await controller.getUsage(ADMIN)).cancellation.deletion;

        const confirmed = await controller.cancelSubscription(ADMIN, {
            expectedDeletesOn: shown.deletesOn,
        });

        assert.deepEqual(confirmed.deletion, shown);
        assert.deepEqual(announced(ends), [
            {
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                endsAt: TERM_ENDS,
                readOnlyDays: 30,
                deletesOn: '2100-01-31',
                announcedAt: confirmed.canceledAt,
                announcedBy: ADMIN_TAG,
            },
        ]);
        assert.equal(audited.length, 1);
        assert.deepEqual(
            {
                action: audited[0].action,
                deletesOn: audited[0].changes.deletesOn,
                readOnlyDays: audited[0].changes.readOnlyDays,
            },
            { action: 'CANCEL_SUBSCRIPTION', deletesOn: '2100-01-31', readOnlyDays: 30 },
        );
        assert.deepEqual((await controller.getUsage(ADMIN)).announcedDeletion, shown);
    });

    /** Confirms after a page that showed `shownDay`, which no longer applies. */
    const refusedWhereThePageShowed = async (shownDay) => {
        const { controller, ends, claims, audited, contractsEnded } = account();

        const refusal = await refusalOf(
            controller.cancelSubscription(ADMIN, { expectedDeletesOn: shownDay }),
        );

        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'CANCELLATION_TERMS_CHANGED');
        assert.deepEqual(refusal.deletion, ANNOUNCED_IN_BERLIN);
        assert.deepEqual(refusal.effectiveAt, TERM_ENDS);
        assert.deepEqual(claims, [], 'no cancellation');
        assert.deepEqual(ends.announcements, [], 'no announcement');
        assert.deepEqual(audited, []);
        assert.deepEqual(contractsEnded, []);
    };

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    describe('is refused, with the days that apply now and nothing written, where the page showed', () => {
        test('a day earlier', () => refusedWhereThePageShowed('2100-01-30'));
        test('a day later', () => refusedWhereThePageShowed('2100-02-01'));
    });

    /** Confirms with `dto`, which holds the confirmation to no day. */
    const takenFromAPageThatSends = async (dto) => {
        const { controller, ends, claims } = account();

        const confirmed = await controller.cancelSubscription(ADMIN, dto);

        assert.equal(claims.length, 1);
        assert.deepEqual(confirmed.deletion, ANNOUNCED_IN_BERLIN);
        assert.equal(ends.announcements[0]?.deletesOn, '2100-01-31');
    };

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    describe('is taken, and records the days the server counts, from a page that', () => {
        test('sends no day', () => takenFromAPageThatSends({}));
        test('sends the day as null', () => takenFromAPageThatSends({ expectedDeletesOn: null }));
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('landing at once records the days counted from the moment it landed', async () => {
        const { controller, ends } = account({
            subscription: subscriptionWith(NOTHING_LEFT_TO_RUN),
        });

        const confirmed = await controller.cancelSubscription(ADMIN, {});

        const landsOn = dayInZone(confirmed.canceledEffectiveAt, BERLIN.timeZone);
        assert.equal(confirmed.status, 'CANCELED');
        assert.equal(confirmed.deletion.deletesOn, addDaysToDay(landsOn, 30));
        assert.deepEqual(
            [ends.announcements[0]?.endsAt, ends.announcements[0]?.deletesOn],
            [confirmed.canceledEffectiveAt, addDaysToDay(landsOn, 30)],
        );
    });
});

// @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
describe('confirming a cancellation again', () => {
    /** Confirms again, after a page that sent `shownDay`, where a day was told before. */
    const answersTheDayToldThoughThePageSent = async (shownDay) => {
        const ends = new FakeSubscriptionEndRepository();
        // Told with a longer period than the one in force now.
        await ends.announce({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt: TERM_ENDS,
            readOnlyDays: 90,
            deletesOn: '2100-03-31',
            announcedAt: CANCELLED_FOR_THE_TERM_END.canceledAt,
            announcedBy: ADMIN_TAG,
        });
        const { controller, claims, audited } = account({
            subscription: subscriptionWith(CANCELLED_FOR_THE_TERM_END),
            ends,
        });

        const again = await controller.cancelSubscription(OTHER_ADMIN, {
            expectedDeletesOn: shownDay,
        });

        assert.equal(again.alreadyCanceled, true);
        assert.deepEqual(again.deletion, {
            readOnlyDays: 90,
            readOnlyUntil: '2100-03-30',
            deletesOn: '2100-03-31',
        });
        assert.deepEqual(claims, []);
        assert.equal(ends.announcements.length, 1);
        assert.equal(ends.announcements[0].announcedBy, ADMIN_TAG, 'kept as it was');
        assert.deepEqual(audited, [], 'and nothing more is audited');
    };

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    describe('where a day was told, changes nothing and answers that day, though the page sent', () => {
        test('the day on record', () => answersTheDayToldThoughThePageSent('2100-03-31'));
        test('the day counted now', () => answersTheDayToldThoughThePageSent('2100-01-31'));
    });

    test('where none was told and it has not landed, tells it now, records it and audits the day as its own entry', async () => {
        const { controller, ends, claims, audited } = account({
            subscription: subscriptionWith(CANCELLED_FOR_THE_TERM_END),
        });

        const again = await controller.cancelSubscription(OTHER_ADMIN, {
            expectedDeletesOn: '2100-01-31',
        });

        assert.equal(again.alreadyCanceled, true);
        assert.deepEqual(again.deletion, ANNOUNCED_IN_BERLIN);
        assert.deepEqual(claims, [], 'the cancellation is left as it was');
        assert.deepEqual(
            announced(ends).map(({ endsAt, deletesOn, announcedBy }) => ({
                endsAt,
                deletesOn,
                announcedBy,
            })),
            [{ endsAt: TERM_ENDS, deletesOn: '2100-01-31', announcedBy: OTHER_ADMIN_TAG }],
        );
        assert.deepEqual(
            audited.map(({ actor, entity, entityId, action, changes }) => ({
                by: [actor.userId, actor.email],
                entity,
                entityId,
                action,
                changes,
            })),
            [
                {
                    by: ['u-other', 'other@t1.example'],
                    entity: 'Subscription',
                    entityId: 't1',
                    action: 'ANNOUNCE_DELETION_DAY',
                    changes: {
                        effectiveAt: TERM_ENDS.toISOString(),
                        deletesOn: '2100-01-31',
                        readOnlyDays: 30,
                    },
                },
            ],
        );
        const declared = PLATFORM_CORE_MANIFEST_CONTRIBUTION.audit.actions.find(
            ({ key }) => key === audited[0].action,
        );
        assert.ok(declared?.label, 'the audit page can name it');
    });

    test('where another repeat records the day first, answers that day and leaves the audit to it', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const announce = ends.announce.bind(ends);
        // The other request records between this one's read and its write.
        ends.announce = async (announcement) => {
            await announce({ ...announcement, announcedBy: ADMIN_TAG });
            return announce(announcement);
        };
        const { controller, audited } = account({
            subscription: subscriptionWith(CANCELLED_FOR_THE_TERM_END),
            ends,
        });

        const again = await controller.cancelSubscription(OTHER_ADMIN, {
            expectedDeletesOn: '2100-01-31',
        });

        assert.deepEqual(again.deletion, ANNOUNCED_IN_BERLIN);
        assert.deepEqual(
            ends.announcements.map(({ announcedBy }) => announcedBy),
            [ADMIN_TAG],
        );
        assert.deepEqual(audited, []);
    });

    test('where none was told, refuses a page that showed another day before it writes anything', async () => {
        const { controller, ends, contractsEnded, audited } = account({
            subscription: subscriptionWith(CANCELLED_FOR_THE_TERM_END),
        });

        const refusal = await refusalOf(
            controller.cancelSubscription(ADMIN, { expectedDeletesOn: '2100-02-01' }),
        );

        assert.equal(refusal.code, 'CANCELLATION_TERMS_CHANGED');
        assert.deepEqual(refusal.deletion, ANNOUNCED_IN_BERLIN);
        assert.deepEqual(refusal.effectiveAt, TERM_ENDS);
        assert.deepEqual(ends.announcements, []);
        assert.deepEqual(contractsEnded, [], 'nor repairs the contract');
        assert.deepEqual(audited, [], 'nor audits anything');
    });

    test('once it has landed, tells nothing, records nothing and audits nothing', async () => {
        const landed = new Date('2020-01-31T23:00:00.000Z');
        const { controller, ends, audited } = account({
            subscription: subscriptionWith({
                canceledAt: new Date('2020-01-02T08:00:00.000Z'),
                canceledEffectiveAt: landed,
                status: 'CANCELED',
            }),
        });

        const again = await controller.cancelSubscription(ADMIN, {
            expectedDeletesOn: '2100-01-31',
        });

        assert.equal(again.alreadyCanceled, true);
        assert.equal(again.deletion, null);
        assert.deepEqual(ends.announcements, []);
        assert.deepEqual(audited, []);
    });
});

// @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
describe('a confirmation whose days cannot be recorded', () => {
    test('leaves the cancellation standing, audits it without a day and answers the failure; a repeat records the days and audits them, once it can', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const announce = ends.announce.bind(ends);
        let failing = true;
        ends.announce = async (announcement) => {
            if (failing) throw new Error('store unavailable');
            return announce(announcement);
        };
        const { controller, claims, audited, contractsEnded } = account({ ends });

        await assert.rejects(
            controller.cancelSubscription(ADMIN, { expectedDeletesOn: '2100-01-31' }),
            /store unavailable/,
        );
        assert.equal(claims.length, 1, 'the cancellation stands');
        assert.equal(contractsEnded.length, 1);
        assert.equal(audited.length, 1);
        assert.deepEqual(
            [audited[0].changes.deletesOn, audited[0].changes.readOnlyDays],
            [null, null],
        );
        assert.deepEqual(ends.announcements, []);

        await assert.rejects(
            controller.cancelSubscription(ADMIN, { expectedDeletesOn: '2100-01-31' }),
            /store unavailable/,
        );
        assert.equal(audited.length, 1, 'a repeat that cannot record the day audits none');

        failing = false;
        const again = await controller.cancelSubscription(ADMIN, {
            expectedDeletesOn: '2100-01-31',
        });
        assert.deepEqual(again.deletion, ANNOUNCED_IN_BERLIN);
        assert.equal(ends.announcements.length, 1);
        assert.equal(claims.length, 1, 'and is not declared twice');
        assert.deepEqual(
            audited.map(({ action, changes }) => [action, changes.deletesOn, changes.readOnlyDays]),
            [
                ['CANCEL_SUBSCRIPTION', null, null],
                ['ANNOUNCE_DELETION_DAY', '2100-01-31', 30],
            ],
        );
        assert.deepEqual(audited[1].actor, audited[0].actor, 'by whoever asked');
    });
});

// @requirement SC-CANC-032 — A cancellation stands where its deletion day was not recorded; a repeat records it
describe('two confirmations at the same moment', () => {
    test('make one cancellation and one announcement, and it is the one the winner recorded', async () => {
        const seen = account();
        const claim = seen.writes.cancelSubscription.bind(seen.writes);
        let arrived = 0;
        let bothArrive;
        const bothArrived = new Promise((resolve) => (bothArrive = resolve));
        let releaseWinner;
        const winnerHeld = new Promise((resolve) => (releaseWinner = resolve));
        // Both read the subscription before either claims it; the first claim
        // takes it, and its request goes on only once the other has finished,
        // so a request that announced after losing would be the first to.
        seen.writes.cancelSubscription = async (tenantId, input) => {
            arrived += 1;
            const first = arrived === 1;
            if (arrived === 2) bothArrive();
            await bothArrived;
            const result = await claim(tenantId, input);
            if (first) await winnerHeld;
            return result;
        };

        const winning = seen.controller.cancelSubscription(ADMIN, {});
        const lost = await seen.controller.cancelSubscription(OTHER_ADMIN, {});
        releaseWinner();
        const won = await winning;

        assert.equal(won.alreadyCanceled, false, 'the first claim took the cancellation');
        assert.equal(lost.alreadyCanceled, true);
        assert.equal(seen.claims.length, 1, 'one cancellation');
        assert.deepEqual(
            announced(seen.ends).map(({ announcedBy }) => announcedBy),
            [ADMIN_TAG],
        );
        assert.deepEqual(won.deletion, ANNOUNCED_IN_BERLIN);
    });

    test('the one that lost the cancellation announces nothing, and answers what the winner recorded', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const seen = account({ ends });
        // Another request took the cancellation between this one's read and its write.
        seen.writes.cancelSubscription = async () => ({
            ...CANCELLED_FOR_THE_TERM_END,
            status: 'ACTIVE',
            alreadyCanceled: true,
        });

        const before = await seen.controller.cancelSubscription(ADMIN, {});
        assert.equal(before.deletion, null, 'nothing on record yet');
        assert.deepEqual(ends.announcements, [], 'and it recorded nothing itself');

        await ends.announce({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt: TERM_ENDS,
            readOnlyDays: 90,
            deletesOn: '2100-03-31',
            announcedAt: CANCELLED_FOR_THE_TERM_END.canceledAt,
            announcedBy: OTHER_ADMIN_TAG,
        });
        const after = await seen.controller.cancelSubscription(ADMIN, {});
        assert.equal(after.deletion.deletesOn, '2100-03-31');
        assert.equal(ends.announcements.length, 1);
    });
});

describe('where no deletion day can be recorded', () => {
    test('a module wired without the end of a subscription states none and cancels as before', async () => {
        const { controller, claims, audited } = account({ withEnds: false });

        const usage = await controller.getUsage(ADMIN);
        assert.equal(usage.cancellation.deletion, null);
        assert.equal(usage.announcedDeletion, null);

        const confirmed = await controller.cancelSubscription(ADMIN, {});
        assert.equal(claims.length, 1);
        assert.equal(confirmed.deletion, null);
        assert.equal(audited[0].changes.deletesOn, null);
    });

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('a page that showed a day there is asked again, and nothing is written', async () => {
        const { controller, claims } = account({ withEnds: false });

        const refusal = await refusalOf(
            controller.cancelSubscription(ADMIN, { expectedDeletesOn: '2100-01-31' }),
        );

        assert.equal(refusal.code, 'CANCELLATION_TERMS_CHANGED');
        assert.equal(refusal.deletion, null);
        assert.deepEqual(claims, []);
    });

    test('a subscription the port answers without its id states none, is cancelled all the same, and the reason is said once', async () => {
        const { controller, endService, ends, claims } = account({
            subscription: subscriptionWith({ id: undefined }),
        });
        const said = [];
        endService.logger.warn = (message) => said.push(message);

        assert.equal((await controller.getUsage(ADMIN)).cancellation.deletion, null);
        const confirmed = await controller.cancelSubscription(ADMIN, {});

        assert.equal(claims.length, 1);
        assert.equal(confirmed.deletion, null);
        assert.deepEqual(ends.announcements, []);
        assert.equal(said.length, 1);
        assert.match(said[0], /SubscriptionUsagePort.*without its id/s);
    });
});

/** `body` as the application's global `ValidationPipe` hands it to `route` of `controller`. */
async function throughThePipe(controller, route, index, body) {
    const metatype = Reflect.getMetadata('design:paramtypes', controller.prototype, route)[index];
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    return pipe.transform(body, { type: 'body', metatype });
}

describe('the day a page sends back', () => {
    const routes = [
        ['the cancellation', TenantBillingController, 'cancelSubscription', 1],
        ['the end at once', FeatureWithdrawalTenantController, 'end', 2],
    ];

    for (const [name, controller, route, index] of routes) {
        test(`to ${name} is taken as a calendar day, and left out where none is sent`, async () => {
            const taken = await throughThePipe(controller, route, index, {
                expectedDeletesOn: '2100-02-28',
            });
            assert.equal(taken.expectedDeletesOn, '2100-02-28');
            assert.equal(
                (await throughThePipe(controller, route, index, {})).expectedDeletesOn,
                undefined,
            );
        });

        for (const [what, notADay] of [
            ['a day the calendar does not have', '2100-02-29'],
            ['a month without its leading zero', '2100-2-28'],
            ['a moment', '2100-02-28T00:00:00.000Z'],
            ['a day written another way', '28.02.2100'],
            ['a year of three digits', '0999-12-31'],
            ['a number', 20_000_101],
            ['fifty thousand spaces', ' '.repeat(50_000)],
        ]) {
            test(`to ${name} refuses ${what}`, async () => {
                await assert.rejects(
                    throughThePipe(controller, route, index, { expectedDeletesOn: notADay }),
                    BadRequestException,
                );
            });
        }
    }
});
