// A booking an add-on retirement reached continues on the replacement at its
// date: the run that moves it, what it writes, what it leaves alone, and what
// it does when the contract cannot be written.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

import { BundleRetirementMoveService } from '../dist/billing/index.js';
import { BundlesService } from '../dist/catalog/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';
import {
    ACTOR,
    NOW,
    REPLACEMENT,
    RETIRED,
    addOnVersion,
    bookingOf,
    rejection,
    retiring,
    subscriptionOf,
} from './helpers/add-on-retirement-fixtures.js';
import { unsupportedTaxCase } from './helpers/tax-adapter.js';
import { sendingPort } from './helpers/version-notices.js';

/** Both bookings, monthly to 1 November and told at `NOW`, move on 1 February 2027. */
const THE_DATE = new Date('2027-02-01T00:00:00.000Z');
const AT_THE_DATE = new Date('2027-02-01T00:15:00.000Z');

/** An announcement of v1 onto v2 that reached t1 and t2. */
async function announced(options = {}) {
    const world = retiring(options);
    await world.service.announce(RETIRED.id, REPLACEMENT.id, ['sb-t1', 'sb-t2'], ACTOR, NOW);
    return world;
}

/**
 * The run over `world`, with what it freezes, invalidates and audits recorded.
 * `noParty` names tenants whose party is missing; `freezeFails` makes every
 * contract fail.
 */
function mover(world, { noParty = [], untreated = [], freezeFails = false, charges = null } = {}) {
    const frozen = [];
    const invalidated = [];
    const audited = [];
    const contractFreeze = {
        async assertPartyFor(tenantId) {
            if (noParty.includes(tenantId)) throw new Error('no party');
            if (untreated.includes(tenantId)) throw unsupportedTaxCase();
        },
        async freezeOnPlanChange(...args) {
            if (freezeFails) throw new Error('the contract store is down');
            frozen.push(args);
        },
    };
    const service = new BundleRetirementMoveService(
        world.bookingRepository,
        world.usage,
        world.notices,
        { invalidateTenant: (tenantId) => invalidated.push(tenantId) },
        null,
        contractFreeze,
        charges,
        { log: async (entry) => audited.push(entry) },
    );
    return { service, frozen, invalidated, audited };
}

const versionOf = (world, id) =>
    world.bookingRepository.rows.find((row) => row.id === id)?.bundleVersionId;

/** A month past the date: what a run that missed it meets. */
const A_MONTH_LATE = new Date('2027-03-01T00:00:00.000Z');

/** The booking `id` ending a month after its date, cancelled before a run came. */
function endsAMonthLate(world, id = 'sb-t1') {
    const index = world.bookingRepository.rows.findIndex((row) => row.id === id);
    world.bookingRepository.rows[index] = {
        ...world.bookingRepository.rows[index],
        canceledAt: new Date('2027-02-10T00:00:00.000Z'),
        canceledEffectiveAt: A_MONTH_LATE,
    };
}

/** What `work` logs as errors, for as long as it runs. */
async function errorsLoggedBy(work) {
    const logged = [];
    const error = Logger.prototype.error;
    Logger.prototype.error = function (message) {
        logged.push(String(message));
    };
    try {
        await work();
    } finally {
        Logger.prototype.error = error;
    }
    return logged;
}

/** A recorder of the journal's calls, failing the first `failures` of them. */
function journal({ failures = 0 } = {}) {
    const recorded = [];
    let failed = 0;
    return {
        recorded,
        recordDueCharges: async (tenantId) => {
            if (failed < failures) {
                failed += 1;
                throw new Error('the ledger is down');
            }
            recorded.push(tenantId);
        },
    };
}

// @requirement SC-BUN-049 — A booking continues on the replacement at the date it was told
describe('the move at the date', () => {
    test('moves each booking onto the replacement, keeping its period, terms and rhythm', async () => {
        const world = await announced({
            bookings: [
                bookingOf('t1', { minimumTermEndsAt: new Date('2027-06-01T00:00:00.000Z') }),
                bookingOf('t2'),
            ],
        });
        const before = world.bookingRepository.rows.map((row) => ({ ...row }));
        const { service, frozen, invalidated, audited } = mover(world);

        const run = await service.moveDue(AT_THE_DATE);

        assert.deepEqual(run, { moved: 2, failed: 0 });
        assert.deepEqual(
            world.bookingRepository.rows,
            before.map((row) => ({ ...row, bundleVersionId: REPLACEMENT.id })),
        );
        assert.deepEqual(invalidated, ['t1', 't2']);
        assert.deepEqual(
            frozen.map(([tenantId, plan, cycle, at, endsAt, terms]) => [
                tenantId,
                plan,
                cycle,
                at,
                endsAt,
                terms.addOn,
            ]),
            [
                [
                    't1',
                    'STANDARD',
                    'YEARLY',
                    AT_THE_DATE,
                    null,
                    { bundleVersionId: REPLACEMENT.id, subscriptionBundleId: 'sb-t1' },
                ],
                [
                    't2',
                    'STANDARD',
                    'YEARLY',
                    AT_THE_DATE,
                    null,
                    { bundleVersionId: REPLACEMENT.id, subscriptionBundleId: 'sb-t2' },
                ],
            ],
        );
        assert.ok(frozen.every(([, , , , , terms]) => typeof terms.retirementId === 'string'));
        assert.deepEqual(
            audited.map((entry) => [entry.action, entry.entityId, entry.changes.toBundleVersionId]),
            [
                ['BUNDLE_VERSION_RETIREMENT_MOVE', 'sb-t1', REPLACEMENT.id],
                ['BUNDLE_VERSION_RETIREMENT_MOVE', 'sb-t2', REPLACEMENT.id],
            ],
        );
    });

    test('writes the contract to end where the subscription does', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            canceledAt: new Date('2027-01-05T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-06-01T00:00:00.000Z'),
        });
        const { service, frozen } = mover(world);

        await service.moveDue(AT_THE_DATE);

        assert.deepEqual(
            frozen.map(([tenantId, , , , endsAt]) => [tenantId, endsAt]),
            [
                ['t1', new Date('2027-06-01T00:00:00.000Z')],
                ['t2', null],
            ],
        );
    });

    test('moves nothing before the date, and a second run nothing more', async () => {
        const world = await announced();
        const { service, frozen } = mover(world);

        const early = await service.moveDue(new Date(THE_DATE.getTime() - 1));
        const first = await service.moveDue(AT_THE_DATE);
        const second = await service.moveDue(new Date('2027-02-01T00:30:00.000Z'));

        assert.deepEqual(
            [early, first, second].map((run) => run.moved),
            [0, 2, 0],
        );
        assert.equal(frozen.length, 2);
    });

    test('moves a booking past its date, the run having missed it', async () => {
        const world = await announced();
        const { service } = mover(world);

        await service.moveDue(new Date('2027-03-15T00:00:00.000Z'));

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
    });

    test('moves nothing whose notice has reached nobody, however late it is', async () => {
        const world = await announced({ port: sendingPort({ recipients: [], channel: 'email' }) });
        const { service } = mover(world);

        const run = await service.moveDue(new Date('2028-01-01T00:00:00.000Z'));

        assert.equal(run.moved, 0);
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
    });

    test('leaves a booking that ends by its date, and one whose subscription does', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        // After the announcement: t1 cancels without its term to end on the
        // date, and t2's subscription ends the day before it.
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2027-01-05T00:00:00.000Z'),
            canceledEffectiveAt: THE_DATE,
        };
        subscriptions[1] = subscriptionOf('t2', {
            canceledAt: new Date('2027-01-05T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-01-31T00:00:00.000Z'),
        });
        const { service } = mover(world);

        const run = await service.moveDue(AT_THE_DATE);

        assert.equal(run.moved, 0);
        assert.deepEqual(
            [versionOf(world, 'sb-t1'), versionOf(world, 'sb-t2')],
            [RETIRED.id, RETIRED.id],
        );
    });

    test('leaves a booking taken off the version between the read and the write to the next run', async () => {
        const world = await announced();
        const write = world.bookingRepository.moveToVersion;
        world.bookingRepository.moveToVersion = async (id, from, to) =>
            id === 'sb-t1' ? null : write(id, from, to);
        const { service, audited } = mover(world);

        const run = await service.moveDue(AT_THE_DATE);

        assert.deepEqual(run, { moved: 1, failed: 0 });
        assert.equal(audited.length, 1);
    });

    test('moves a booking in a trial, and writes it no contract and no charge', async () => {
        const world = await announced({
            subscriptions: [subscriptionOf('t1', { status: 'TRIAL' }), subscriptionOf('t2')],
        });
        const charges = journal();
        const { service, frozen } = mover(world, { charges });

        await service.moveDue(AT_THE_DATE);

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
        assert.deepEqual(
            frozen.map(([tenantId]) => tenantId),
            ['t2'],
        );
        assert.deepEqual(charges.recorded, ['t2']);
    });

    test('records the charges the move makes due', async () => {
        const recorded = [];
        const world = await announced();
        const { service } = mover(world, {
            charges: { recordDueCharges: async (tenantId) => recorded.push(tenantId) },
        });

        await service.moveDue(AT_THE_DATE);

        assert.deepEqual(recorded, ['t1', 't2']);
    });
});

// @requirement SC-BUN-051 — A retirement keeps its promise, and the add-on stays until its bookings have moved
describe('the replacement the notice promised', () => {
    test('is bound at the date though its sale has ended since', async () => {
        const world = await announced();
        // Superseded since the announcement: its sale ended before the date.
        world.catalogue.seedVersion({ ...REPLACEMENT, validUntil: '2027-01-15T00:00:00.000Z' });
        const { service } = mover(world);

        await service.moveDue(AT_THE_DATE);

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
    });

    test('keeps the add-on from being deleted while bookings still move onto it, counted', async () => {
        const world = await announced();

        const error = await rejection(world.service.assertMayDelete('b-reports', NOW));

        assert.equal(error.getStatus(), 422);
        assert.equal(error.getResponse().code, 'BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING');
        assert.deepEqual(error.getResponse().params, { count: 2, bundleKey: 'REPORTS' });
    });

    test('and so does a notice still waiting for somebody to tell, and a move past its date', async () => {
        const waiting = await announced({
            port: sendingPort({ recipients: [], channel: 'email' }),
        });
        const overdue = await announced();

        const countOf = async (world, at) =>
            (await rejection(world.service.assertMayDelete('b-reports', at))).getResponse().params
                .count;

        assert.deepEqual(
            [await countOf(waiting, NOW), await countOf(overdue, AT_THE_DATE)],
            [2, 2],
        );
    });

    test('but not once every booking has moved, or ended by its date', async () => {
        const moved = await announced();
        await mover(moved).service.moveDue(AT_THE_DATE);
        const ended = await announced();
        ended.bookingRepository.rows.forEach((row, index) => {
            ended.bookingRepository.rows[index] = {
                ...row,
                canceledAt: new Date('2026-11-01T00:00:00.000Z'),
                canceledEffectiveAt: THE_DATE,
            };
        });

        await moved.service.assertMayDelete('b-reports', AT_THE_DATE);
        await ended.service.assertMayDelete('b-reports', NOW);
    });

    test('nor once a booking past its date has ended before anything moved it', async () => {
        const world = await announced();
        endsAMonthLate(world);
        const late = new Date('2027-03-01T00:15:00.000Z');
        await mover(world).service.moveDue(late);

        await world.service.assertMayDelete('b-reports', late);
    });

    test('nor for a notice that can no longer go out', async () => {
        const world = await announced({ port: sendingPort({ recipients: [], channel: 'email' }) });
        // Neither is told by mid-December, so a notice sent then would set a
        // date in April. t1's booking is cancelled to end on 1 March: after the
        // date it was announced with, before any it could still be given.
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2026-12-10T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-03-01T00:00:00.000Z'),
        };
        const midDecember = new Date('2026-12-15T00:00:00.000Z');

        const [retirement] = await world.service.list(midDecember);
        const error = await rejection(world.service.assertMayDelete('b-reports', midDecember));

        assert.equal(retirement.progress.notToldReasons.noLongerReached, 1);
        assert.equal(error.getResponse().params.count, 1, 'only t2, whose notice can still go out');
    });

    test('and holds back no other add-on, nor reads its retirements', async () => {
        const archive = addOnVersion('bv-archive-1', {
            bundleId: 'b-archive',
            bundleKey: 'ARCHIVE',
            label: 'Archive',
        });
        const archived = addOnVersion('bv-archive-2', {
            bundleId: 'b-archive',
            bundleKey: 'ARCHIVE',
            label: 'Archive',
            version: 2,
            validFrom: '2026-10-01T00:00:00.000Z',
        });
        const world = await announced({
            versions: [
                RETIRED,
                REPLACEMENT,
                { ...archive, validUntil: '2026-09-30T00:00:00.000Z' },
                archived,
            ],
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2'), subscriptionOf('t3')],
            bookings: [
                bookingOf('t1'),
                bookingOf('t2'),
                bookingOf('t3', { bundleVersionId: archive.id }),
            ],
        });
        await world.service.announce(archive.id, archived.id, ['sb-t3'], ACTOR, NOW);
        const read = [];
        const listOfVersion = world.bookingRepository.listOfVersion;
        world.bookingRepository.listOfVersion = async (id) => {
            read.push(id);
            return listOfVersion(id);
        };

        await rejection(world.service.assertMayDelete('b-reports', NOW));
        const asked = [...read];
        read.length = 0;
        const archiveError = await rejection(world.service.assertMayDelete('b-archive', NOW));

        assert.deepEqual(asked, [RETIRED.id], 'only the add-on asked about');
        assert.deepEqual(read, [archive.id]);
        assert.equal(archiveError.getResponse().params.count, 1);
    });

    test('is what the catalogue asks before it deletes an add-on, deleting nothing it is refused', async () => {
        const refusal = new Error('bookings still move onto it');
        const repo = new FakeBundleRepository();
        let asked = null;
        const bundles = new BundlesService(
            repo,
            null,
            { strictModeCheckMode: 'warn-only' },
            null,
            null,
            null,
            null,
            null,
            {
                async assertMayDelete(bundleId) {
                    asked = bundleId;
                    throw refusal;
                },
            },
        );
        const created = await bundles.createBundle({ bundleKey: 'REPORTS', label: 'Reports' });

        await assert.rejects(() => bundles.softDeleteBundle(created.id), refusal);

        assert.equal(asked, created.id);
        assert.equal((await repo.findById(created.id))?.deletedAt, null);
    });
});

/**
 * An announcement whose run reads the subscriptions as they were when it
 * began — t1's as `before` — while t1's has become `changed` by the time its
 * booking is moved.
 */
async function readBeforeT1Changed(changed, before = {}) {
    const subscriptions = [subscriptionOf('t1', before), subscriptionOf('t2')];
    const world = await announced({ subscriptions });
    const asRead = [...subscriptions];
    world.usage.listByIds = async (ids) =>
        asRead.filter(({ subscription }) => ids.includes(subscription.id));
    subscriptions[0] = subscriptionOf('t1', changed);
    return world;
}

// @requirement SC-BUN-050 — A booking's move and its contract are one, and its periods from the date wait for both
describe('what changed since the run read the subscription', () => {
    test('a cancellation declared since ends the contract the move writes on its date', async () => {
        const world = await readBeforeT1Changed({
            canceledAt: new Date('2027-01-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-06-01T00:00:00.000Z'),
        });
        const { service, frozen } = mover(world);

        await service.moveDue(AT_THE_DATE);

        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
        assert.deepEqual(
            frozen.map(([tenantId, , , , endsAt]) => [tenantId, endsAt]),
            [
                ['t1', new Date('2027-06-01T00:00:00.000Z')],
                ['t2', null],
            ],
        );
    });

    test('a subscription that ended since takes the booking back, and writes nothing', async () => {
        const world = await readBeforeT1Changed({
            canceledAt: new Date('2027-01-20T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-02-01T00:10:00.000Z'),
        });
        const { service, frozen, audited } = mover(world);

        const run = await service.moveDue(AT_THE_DATE);

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(run, { moved: 1, failed: 0 });
        assert.deepEqual(
            frozen.map(([tenantId]) => tenantId),
            ['t2'],
        );
        assert.deepEqual(
            audited.map((entry) => entry.entityId),
            ['sb-t2'],
        );
    });

    test('a tenant on another subscription by now takes the booking back', async () => {
        const world = await readBeforeT1Changed({ id: 'sub-t1-again' });
        const { service, frozen } = mover(world);

        await service.moveDue(AT_THE_DATE);

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(
            frozen.map(([tenantId]) => tenantId),
            ['t2'],
        );
    });

    test('a trial converted since gets the contract the move writes', async () => {
        const world = await readBeforeT1Changed({}, { status: 'TRIAL' });
        const { service, frozen } = mover(world);

        await service.moveDue(AT_THE_DATE);

        assert.deepEqual(
            frozen.map(([tenantId]) => tenantId),
            ['t1', 't2'],
        );
    });
});

// @requirement SC-BUN-050 — A booking's move and its contract are one, and its periods from the date wait for both
describe('a move that cannot be made', () => {
    test('fails without a party to the contract, audited once though every run fails', async () => {
        const world = await announced();
        const { service, audited } = mover(world, { noParty: ['t1'] });

        const first = await service.moveDue(AT_THE_DATE);
        const second = await service.moveDue(new Date('2027-02-01T00:30:00.000Z'));

        assert.deepEqual(
            [first, second],
            [
                { moved: 1, failed: 1 },
                { moved: 0, failed: 1 },
            ],
        );
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(
            audited
                .filter((entry) => entry.action === 'BUNDLE_VERSION_RETIREMENT_MOVE_FAILED')
                .map((entry) => [entry.entityId, entry.changes.reason]),
            [['sb-t1', 'no-party']],
        );
    });

    test('fails for a subscriber the tax adapter supports no treatment for, and says so', async () => {
        const world = await announced();
        const { service, audited } = mover(world, { untreated: ['t1'] });

        const run = await service.moveDue(AT_THE_DATE);

        assert.deepEqual(run, { moved: 1, failed: 1 });
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(
            audited
                .filter((entry) => entry.action === 'BUNDLE_VERSION_RETIREMENT_MOVE_FAILED')
                .map((entry) => [entry.entityId, entry.changes.reason]),
            [['sb-t1', 'tax-not-supported']],
        );
    });

    test('puts the booking back where its contract cannot be written, and the next run makes both', async () => {
        const world = await announced();
        const failing = mover(world, { freezeFails: true });

        const run = await failing.service.moveDue(AT_THE_DATE);

        assert.deepEqual(run, { moved: 0, failed: 2 });
        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(
            failing.invalidated,
            ['t1', 't1', 't2', 't2'],
            'after the move, and again after putting it back',
        );
        assert.deepEqual(
            failing.audited.map((entry) => [
                entry.action,
                entry.changes.reason,
                entry.changes.putBack,
            ]),
            [
                ['BUNDLE_VERSION_RETIREMENT_MOVE_FAILED', 'contract-not-written', true],
                ['BUNDLE_VERSION_RETIREMENT_MOVE_FAILED', 'contract-not-written', true],
            ],
        );

        const retried = await mover(world).service.moveDue(new Date('2027-02-01T00:30:00.000Z'));

        assert.equal(retried.moved, 2);
        assert.equal(versionOf(world, 'sb-t1'), REPLACEMENT.id);
    });

    test('goes on with the next booking where putting one back fails, and says so', async () => {
        const world = await announced();
        const write = world.bookingRepository.moveToVersion;
        world.bookingRepository.moveToVersion = async (id, from, to) => {
            if (from === REPLACEMENT.id) throw new Error('the database is gone');
            return write(id, from, to);
        };
        const { service, audited } = mover(world, { freezeFails: true });

        const run = await service.moveDue(AT_THE_DATE);

        assert.deepEqual(run, { moved: 0, failed: 2 });
        assert.deepEqual(
            audited.map((entry) => [entry.entityId, entry.changes.putBack]),
            [
                ['sb-t1', false],
                ['sb-t2', false],
            ],
        );
    });

    test('says so where the booking cannot be put back either', async () => {
        const world = await announced();
        const write = world.bookingRepository.moveToVersion;
        world.bookingRepository.moveToVersion = async (id, from, to) =>
            from === REPLACEMENT.id ? null : write(id, from, to);
        const { service, audited } = mover(world, { freezeFails: true });

        const logged = await errorsLoggedBy(() => service.moveDue(AT_THE_DATE));

        assert.deepEqual(
            audited.map((entry) => entry.changes.putBack),
            [false, false],
        );
        const failures = logged.filter((message) => message.includes('could not be moved'));
        assert.equal(failures.length, 2);
        assert.ok(
            failures.every((message) => message.endsWith('and no run tries it again.')),
            'no run reads a booking off the version retired, so none is promised',
        );
    });
});

// @requirement SC-BUN-050 — A booking's move and its contract are one, and its periods from the date wait for both
describe('a booking that ended before its move came', () => {
    test('is not moved, and the journal is asked once for the periods it ran on', async () => {
        const world = await announced();
        endsAMonthLate(world);
        const charges = journal();
        const { service, frozen, audited } = mover(world, { charges });

        const first = await service.moveDue(new Date('2027-03-01T00:15:00.000Z'));
        const second = await service.moveDue(new Date('2027-03-01T00:30:00.000Z'));

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(
            [first, second],
            [
                { moved: 1, failed: 0 },
                { moved: 0, failed: 0 },
            ],
        );
        assert.deepEqual(charges.recorded, ['t1', 't2'], 't1 for its periods, t2 for its move');
        assert.deepEqual(
            frozen.map(([tenantId]) => tenantId),
            ['t2'],
        );
        assert.deepEqual(
            audited.map((entry) => entry.entityId),
            ['sb-t2'],
        );
    });

    test('nor where the subscription it belongs to ended since', async () => {
        const subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')];
        const world = await announced({ subscriptions });
        subscriptions[0] = subscriptionOf('t1', {
            canceledAt: new Date('2027-02-10T00:00:00.000Z'),
            canceledEffectiveAt: A_MONTH_LATE,
        });
        const charges = journal();
        const { service } = mover(world, { charges });

        await service.moveDue(new Date('2027-03-01T00:15:00.000Z'));

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(charges.recorded, ['t1', 't2']);
    });

    test('asks nothing where nothing waited: an end by the date, or a trial', async () => {
        const world = await announced({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2', { status: 'TRIAL' })],
        });
        world.bookingRepository.rows[0] = {
            ...world.bookingRepository.rows[0],
            canceledAt: new Date('2027-01-05T00:00:00.000Z'),
            canceledEffectiveAt: THE_DATE,
        };
        endsAMonthLate(world, 'sb-t2');
        const charges = journal();
        const { service } = mover(world, { charges });

        const run = await service.moveDue(new Date('2027-03-01T00:15:00.000Z'));

        assert.deepEqual(run, { moved: 0, failed: 0 });
        assert.deepEqual(charges.recorded, []);
    });

    test('claims nothing for a booking of a subscription the tenant is no longer on', async () => {
        const world = await readBeforeT1Changed({ id: 'sub-t1-again' });
        endsAMonthLate(world);
        const charges = journal();
        const { service } = mover(world, { charges });

        await service.moveDue(new Date('2027-03-01T00:15:00.000Z'));

        assert.equal(versionOf(world, 'sb-t1'), RETIRED.id);
        assert.deepEqual(charges.recorded, ['t2'], 't2 for its move, and nothing for t1');
    });

    test('asks the journal again where it could not record them', async () => {
        const world = await announced();
        endsAMonthLate(world);
        endsAMonthLate(world, 'sb-t2');
        const charges = journal({ failures: 1 });
        const { service } = mover(world, { charges });

        await service.moveDue(new Date('2027-03-01T00:15:00.000Z'));
        await service.moveDue(new Date('2027-03-01T00:30:00.000Z'));

        assert.deepEqual(charges.recorded, ['t2', 't1']);
    });
});
