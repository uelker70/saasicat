// One edit is recorded once, however many replicas start on it.
//
// Several replicas of one installation start together after one edit of
// `config/saas.yaml`. Each reads the same record and each finds the same
// difference — and each would write a change and mail every address: three
// replicas and two addresses made six mails for one edit, and three rows an
// operator acknowledges one by one. Every write to the record is guarded on
// the fingerprint that was read, so one start records the change and tells
// people; the others read again, find the record saying what they run, and
// say nothing.
//
// Recorders built by hand over one in-memory port, all started before any of
// them awaits — the shape the defect was reproduced in. The port keeps the
// guard the way a database does; that is what makes two recorders two
// replicas rather than two calls.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { AppliedSettingsRecorder, fingerprintOf, SettingsChangeNotifier } from '../dist/index.js';
import { settingsSubtreeOf } from '@saasicat/core';
import { FakeAppliedSettingsPort } from './helpers/applied-settings-port.js';

const ADDRESSES = ['ops@example.com', 'cfo@example.com'];
const SOURCE = '/srv/app/config/saas.yaml';
const NOW = new Date('2026-09-05T06:00:00.000Z');

const catalogWith = (overrides = {}) => ({
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 14, yearly: 90 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    notifications: { settingsChanged: ADDRESSES },
    plans: [{ id: 'PRO', name: 'Pro', monthlyNet: 9, yearlyNet: 90, features: [], quotas: {} }],
    ...overrides,
});

/** Keeps every mail it was asked to send. */
class FakeEmailPort {
    sent = [];
    async send(message) {
        this.sent.push(message);
    }
}

/** A port whose record says `catalog` was what the previous start applied. */
function portRecording(catalog) {
    const port = new FakeAppliedSettingsPort();
    const previous = settingsSubtreeOf(catalog);
    port.applied = {
        fingerprint: fingerprintOf(previous),
        settings: previous,
        source: SOURCE,
        appliedAt: new Date('2026-08-01T06:00:00.000Z'),
    };
    return port;
}

/** `count` replicas running `catalog`, over one port, mailing through one email port. */
function replicasOf(catalog, port, email, count) {
    return Array.from(
        { length: count },
        () =>
            new AppliedSettingsRecorder(
                catalog,
                SOURCE,
                port,
                new SettingsChangeNotifier(catalog, email),
            ),
    );
}

/** Every replica boots at once: the lifecycle hook, not just the record. */
function bootTogether(replicas) {
    return Promise.all(replicas.map((replica) => replica.onApplicationBootstrap()));
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A replica's view of one port whose first read is held until `proceed()`
 * lets it return: the interleaving is chosen, not raced. Only the first, so a
 * recorder that reads again fails on what it then writes instead of hanging.
 */
function heldReplica(port) {
    let release = null;
    let held = false;
    const view = {
        async readApplied() {
            const record = await port.readApplied();
            if (!held) {
                held = true;
                await new Promise((resolve) => {
                    release = resolve;
                });
            }
            return record;
        },
        writeApplied: (...args) => port.writeApplied(...args),
        recordChange: (...args) => port.recordChange(...args),
        listChanges: (...args) => port.listChanges(...args),
        acknowledgeChange: (...args) => port.acknowledgeChange(...args),
    };
    return {
        view,
        /** Lets the read this replica is parked on return, and waits for what follows it. */
        async proceed() {
            while (!release) await settle();
            release();
            release = null;
            await settle();
        },
    };
}

// @requirement SC-CFG-032 — One edit is recorded once, however many replicas start on it
describe('replicas of one file starting together after one edit', () => {
    test('three replicas, two addresses: one change, and one mail per address', async () => {
        const port = portRecording(catalogWith());
        const edited = catalogWith({ vatRate: 20 });
        const email = new FakeEmailPort();

        await bootTogether(replicasOf(edited, port, email, 3));

        assert.equal(port.changes.length, 1, 'one edit is one change');
        assert.deepEqual(
            email.sent.map((mail) => mail.to),
            ADDRESSES,
            'one mail per address, not one per replica',
        );
        assert.equal(port.applied.fingerprint, fingerprintOf(settingsSubtreeOf(edited)));
    });

    test('the start that recorded it says so; the others find it recorded and say nothing', async () => {
        const port = portRecording(catalogWith());
        const edited = catalogWith({ vatRate: 20 });

        const outcomes = await Promise.all(
            replicasOf(edited, port, null, 3).map((replica) => replica.record(port, () => NOW)),
        );

        assert.deepEqual(outcomes.map((outcome) => outcome.kind).sort(), [
            'changed',
            'unchanged',
            'unchanged',
        ]);
        const [winner] = outcomes.filter((outcome) => outcome.kind === 'changed');
        assert.equal(winner.change.id, port.changes[0].id);
        for (const other of outcomes.filter((outcome) => outcome.kind === 'unchanged')) {
            assert.deepEqual(
                other.record,
                port.applied,
                'a start that lost answers with the record as the winner left it',
            );
        }
    });

    test('a first start in several replicas writes one record, and one of them says so', async () => {
        const port = new FakeAppliedSettingsPort();
        const outcomes = await Promise.all(
            replicasOf(catalogWith(), port, null, 3).map((replica) =>
                replica.record(port, () => NOW),
            ),
        );

        assert.ok(port.applied, 'a record expected after the first start');
        assert.deepEqual(port.changes, [], 'nothing to compare against, so no change');
        assert.deepEqual(outcomes.map((outcome) => outcome.kind).sort(), [
            'first-record',
            'unchanged',
            'unchanged',
        ]);
    });

    test('a file moved on every replica is one relocation, not a race anybody loses', async () => {
        const port = portRecording(catalogWith());
        const replicas = Array.from(
            { length: 3 },
            () => new AppliedSettingsRecorder(catalogWith(), '/moved/config/saas.yaml', port),
        );

        const outcomes = await Promise.all(
            replicas.map((replica) => replica.record(port, () => NOW)),
        );

        assert.deepEqual(
            outcomes.map((outcome) => outcome.kind),
            ['unchanged', 'unchanged', 'unchanged'],
        );
        assert.equal(port.applied.source, '/moved/config/saas.yaml');
        assert.deepEqual(port.changes, [], 'a moved file is not a changed setting');
    });
});

// @requirement SC-CFG-032 — One edit is recorded once, however many replicas start on it
describe('replicas running different files', () => {
    test('each records the difference it found, and the record ends on one of them', async () => {
        // A rolling deployment has two files in flight. The start that loses
        // the first write reads again, finds a record that is not what it
        // runs, and has a change of its own — both are true, and an operator
        // sees both.
        const port = portRecording(catalogWith());
        const email = new FakeEmailPort();
        const [onTwenty] = replicasOf(catalogWith({ vatRate: 20 }), port, email, 1);
        const [onSeven] = replicasOf(catalogWith({ vatRate: 7 }), port, email, 1);

        await bootTogether([onTwenty, onSeven]);

        assert.equal(port.changes.length, 2, 'two files in flight are two changes');
        const [later, earlier] = port.changes;
        assert.deepEqual(
            later.previous,
            earlier.current,
            'the second change starts where the first ended',
        );
        assert.deepEqual([earlier.current.vatRate, later.current.vatRate].sort(), [20, 7]);
        assert.deepEqual(port.applied.settings, later.current);
        assert.equal(email.sent.length, 2 * ADDRESSES.length, 'each change is mailed once');
    });

    // @requirement SC-CFG-033 — The changes are listed in the order the record went through them
    test('an old start between two new ones is three real moves, dated in the order they landed', async () => {
        // The interleaving a stale guard can meet: two starts on the new file
        // read A; the first writes A→B; a start on the old file reads B and
        // writes it back to A; then the second new start writes, its guard
        // from the first read matching again. That row is a real move — the
        // record did say A — and it is dated after the move it follows,
        // because the clock is read after the read and right before the
        // write, not when the start began.
        const port = portRecording(catalogWith());
        const edited = catalogWith({ vatRate: 20 });
        const [first, second, old] = [heldReplica(port), heldReplica(port), heldReplica(port)];
        const onNew = () => new AppliedSettingsRecorder(edited, SOURCE, port);
        const onOld = new AppliedSettingsRecorder(catalogWith(), SOURCE, port);
        let reads = 0;
        const clock = () => new Date(Date.UTC(2026, 8, 5, 6, 0, ++reads));

        const p1 = onNew().record(first.view, clock);
        const p2 = onNew().record(second.view, clock);
        await first.proceed();
        assert.equal((await p1).kind, 'changed', 'the first new start moves A→B');
        const p3 = onOld.record(old.view, clock);
        await old.proceed();
        assert.equal((await p3).kind, 'changed', 'the old start moves it back to A');
        await second.proceed();
        assert.equal((await p2).kind, 'changed', 'the second new start moves A→B again');

        const rows = [...port.changes].reverse();
        assert.deepEqual(
            rows.map((c) => [c.previous.vatRate, c.current.vatRate]),
            [
                [19, 20],
                [20, 19],
                [19, 20],
            ],
        );
        for (let i = 1; i < rows.length; i++) {
            assert.deepEqual(
                rows[i].previous,
                rows[i - 1].current,
                'every row starts where the one before ended',
            );
            assert.ok(rows[i].noticedAt > rows[i - 1].noticedAt, 'and is dated after it');
        }
        assert.deepEqual(port.applied.settings, rows.at(-1).current);
        assert.equal(
            port.applied.appliedAt.getTime(),
            rows.at(-1).noticedAt.getTime(),
            'the record carries the moment of the write that made it',
        );
        assert.deepEqual(
            (await port.listChanges()).map((c) => c.id),
            [...rows].reverse().map((c) => c.id),
            'the list reads in the order the record moved, latest first',
        );
    });
});

describe('an adapter whose guarded write never confirms', () => {
    // Bounded, so that a recorder that never stops reading fails here rather
    // than hanging the suite.
    test(
        'the start gives up rather than reading for ever, and the boot completes',
        { timeout: 10_000 },
        async () => {
            const port = portRecording(catalogWith());
            const previous = port.applied;
            port.recordChange = async () => null;
            const [replica] = replicasOf(catalogWith({ vatRate: 20 }), port, null, 1);

            await assert.rejects(
                replica.record(port, () => NOW),
                /record moved \d+ times/,
            );

            // Through the lifecycle hook the same failure is logged, not thrown:
            // an installation that cannot write its record still starts.
            await replica.onApplicationBootstrap();
            assert.equal(port.applied, previous, 'the record was not replaced');
            assert.deepEqual(port.changes, []);
        },
    );
});
