// A maintenance window, from the operator's side: announced, moved, cancelled,
// locked and unlocked — and what every other process of the application makes
// of it.
//
// The service decides everything; the port only guards its writes. So these
// run the real service over an in-memory port that keeps the port's promise
// the way the database does, and look at what the operator is told, what the
// application hears, and what the audit log keeps.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

import { AdminAuditService, MaintenanceService } from '../dist/index.js';
import { MAINTENANCE_MESSAGE_MAX_LENGTH, MAINTENANCE_STATE_MAX_AGE_SECONDS } from '@saasicat/core';
import {
    FakeMaintenanceWindowPort,
    OPERATOR,
    OPERATOR_TAG,
    RecordingAuditPort,
    RecordingNotifications,
    inMinutes,
    settle,
} from './helpers/maintenance-windows.js';

function setUp() {
    const port = new FakeMaintenanceWindowPort();
    const audit = new RecordingAuditPort();
    const notifications = new RecordingNotifications();
    const service = new MaintenanceService(port, notifications, new AdminAuditService(audit));
    return { port, audit, notifications, service };
}

/** The coded body of what `fn` threw, and its status. */
async function refusalOf(fn) {
    try {
        await fn();
    } catch (error) {
        return { status: error.getStatus?.(), code: error.getResponse?.().code, error };
    }
    assert.fail('expected a refusal');
}

const announcement = (overrides = {}) => ({
    startsAt: inMinutes(60),
    endsAt: inMinutes(120),
    message: 'Upgrade to 2.3',
    ...overrides,
});

afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
});

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('announcing a window', () => {
    test('records it open, tells the application, and audits who announced it', async () => {
        const { port, audit, notifications, service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);

        assert.equal(port.windows.length, 1);
        assert.equal(window.createdBy, OPERATOR_TAG);
        assert.equal(window.lockedAt, null, 'announcing locks nobody out');
        assert.equal(await service.isLocked(), false);

        await settle();
        assert.deepEqual(
            notifications.events.map((e) => [e.kind, e.window.id]),
            [['announced', window.id]],
        );
        assert.deepEqual(
            audit.entries.map((e) => [e.action, e.entityId, e.changes.actor]),
            [['MAINTENANCE_WINDOW_ANNOUNCE', window.id, OPERATOR_TAG]],
        );
    });

    test('a tenant is shown it from the moment it is announced', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        assert.deepEqual(await service.status(), {
            state: 'announced',
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
            message: 'Upgrade to 2.3',
        });
    });

    test('a second window is refused while one is open', async () => {
        const { port, notifications, service } = setUp();
        await service.announce(announcement(), OPERATOR);
        const refusal = await refusalOf(() => service.announce(announcement(), OPERATOR));
        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_ALREADY_OPEN');
        assert.equal(port.windows.length, 1);
        await settle();
        assert.equal(notifications.events.length, 1, 'nobody is told of a window that was refused');
    });

    test('its end has to be after its start — one millisecond is enough, none is not', async () => {
        const { service } = setUp();
        const startsAt = inMinutes(60);
        const refusal = await refusalOf(() =>
            service.announce(announcement({ startsAt, endsAt: new Date(startsAt) }), OPERATOR),
        );
        assert.equal(refusal.status, 400);
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_END_NOT_AFTER_START');

        const window = await service.announce(
            announcement({ startsAt, endsAt: new Date(startsAt.getTime() + 1) }),
            OPERATOR,
        );
        assert.ok(window.id);
    });

    test('an end that has already passed is refused, a start in the past is not', async () => {
        const { service } = setUp();
        const refusal = await refusalOf(() =>
            service.announce(
                announcement({ startsAt: inMinutes(-60), endsAt: inMinutes(-1) }),
                OPERATOR,
            ),
        );
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_END_IN_PAST');

        // Announcing a window that has already begun is how an operator tells
        // tenants about one that is under way.
        const window = await service.announce(
            announcement({ startsAt: inMinutes(-5), endsAt: inMinutes(30) }),
            OPERATOR,
        );
        assert.ok(window.id);
    });

    test('the message is kept as written, trimmed, and at most its limit long', async () => {
        const { service, port } = setUp();
        const longest = 'x'.repeat(MAINTENANCE_MESSAGE_MAX_LENGTH);
        const refusal = await refusalOf(() =>
            service.announce(announcement({ message: `${longest}y` }), OPERATOR),
        );
        assert.equal(refusal.code, 'MAINTENANCE_MESSAGE_TOO_LONG');
        assert.deepEqual(refusal.error.getResponse().params, {
            max: MAINTENANCE_MESSAGE_MAX_LENGTH,
        });

        await service.announce(announcement({ message: `  ${longest}  ` }), OPERATOR);
        assert.equal(port.windows[0].message, longest);
    });

    test('a message of nothing but spaces is no message', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement({ message: '   ' }), OPERATOR);
        assert.equal(window.message, null);
    });
});

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('moving and cancelling an announced window', () => {
    test('moving it tells the application what it was and what it is now', async () => {
        const { service, notifications, audit } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const endsAt = inMinutes(180);
        const moved = await service.reschedule(window.id, { endsAt }, OPERATOR);

        assert.equal(moved.endsAt.toISOString(), endsAt.toISOString());
        assert.equal(moved.startsAt.toISOString(), window.startsAt.toISOString());
        await settle();
        const told = notifications.events.at(-1);
        assert.equal(told.kind, 'rescheduled');
        assert.equal(told.previous.endsAt.toISOString(), window.endsAt.toISOString());
        assert.equal(told.window.endsAt.toISOString(), endsAt.toISOString());
        assert.equal(audit.entries.at(-1).action, 'MAINTENANCE_WINDOW_RESCHEDULE');
    });

    test('a form saved as it was moves nothing, and tells nobody', async () => {
        const { service, notifications, audit } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const same = await service.reschedule(
            window.id,
            {
                startsAt: new Date(window.startsAt),
                endsAt: new Date(window.endsAt),
                message: window.message,
            },
            OPERATOR,
        );
        assert.equal(same.id, window.id);
        await settle();
        assert.equal(notifications.events.length, 1, 'only the announcement was told');
        assert.equal(audit.entries.length, 1);
    });

    test('a locked window saved with its own start is not refused for moving it', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        await service.lock({}, OPERATOR);
        const later = inMinutes(240);
        const moved = await service.reschedule(
            window.id,
            { startsAt: new Date(window.startsAt), endsAt: later },
            OPERATOR,
        );
        assert.equal(moved.endsAt.toISOString(), later.toISOString());
    });

    test('taking the message away is a change, leaving it out is not', async () => {
        const { service, notifications } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const same = await service.reschedule(window.id, {}, OPERATOR);
        assert.equal(same.message, 'Upgrade to 2.3');
        await settle();
        assert.equal(
            notifications.events.length,
            1,
            'a revision that changes nothing tells nobody',
        );

        const cleared = await service.reschedule(window.id, { message: null }, OPERATOR);
        assert.equal(cleared.message, null);
    });

    test('a move that ends it before it starts is refused, and the window stays as it was', async () => {
        const { service, port } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const refusal = await refusalOf(() =>
            service.reschedule(window.id, { startsAt: inMinutes(150) }, OPERATOR),
        );
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_END_NOT_AFTER_START');
        assert.equal(port.windows[0].startsAt.toISOString(), window.startsAt.toISOString());
    });

    test('a window that is not the open one cannot be moved or cancelled', async () => {
        const { service } = setUp();
        await service.announce(announcement(), OPERATOR);
        for (const act of [
            () => service.reschedule('window-elsewhere', { endsAt: inMinutes(200) }, OPERATOR),
            () => service.cancel('window-elsewhere', OPERATOR),
        ]) {
            const refusal = await refusalOf(act);
            assert.equal(refusal.status, 404);
            assert.equal(refusal.code, 'MAINTENANCE_WINDOW_NOT_OPEN');
        }
    });

    test('cancelling ends it without a lock, tells the application, and frees the slot', async () => {
        const { service, notifications, audit } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const cancelled = await service.cancel(window.id, OPERATOR);

        assert.equal(cancelled.endedBy, OPERATOR_TAG);
        assert.equal(cancelled.lockedAt, null);
        assert.deepEqual(await service.status(), { state: 'none' });
        await settle();
        assert.equal(notifications.events.at(-1).kind, 'cancelled');
        assert.equal(audit.entries.at(-1).action, 'MAINTENANCE_WINDOW_CANCEL');
        assert.ok(
            await service.announce(announcement(), OPERATOR),
            'the next one can be announced',
        );
    });

    test('a cancelled window cannot be cancelled again', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        await service.cancel(window.id, OPERATOR);
        const refusal = await refusalOf(() => service.cancel(window.id, OPERATOR));
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_NOT_OPEN');
    });

    test('an announcement whose end passed without a lock is no longer shown to tenants', async () => {
        const { service, port } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        // The deploy never happened, and the window's end went by.
        Object.assign(port.windows[0], { startsAt: inMinutes(-120), endsAt: inMinutes(-60) });
        assert.deepEqual(await (await freshService(port)).status(), { state: 'none' });

        const overview = await service.overview();
        assert.equal(overview.open.id, window.id);
        assert.equal(overview.open.lapsed, true, 'the operator still sees it, flagged');
    });
});

/** A second process of the same application, reading the same table. */
async function freshService(port) {
    return new MaintenanceService(port, null, null);
}

// @requirement SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does
describe('locking and unlocking are the operator’s, not the clock’s', () => {
    test('an announced window does not lock by itself when its start comes', async () => {
        const { service, port } = setUp();
        await service.announce(announcement({ startsAt: inMinutes(-1) }), OPERATOR);
        assert.equal(await (await freshService(port)).isLocked(), false);
    });

    test('locking takes the announced window, and it holds past its announced end', async () => {
        const { service, port, audit } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const { window: locked, alreadyLocked } = await service.lock({}, OPERATOR);

        assert.equal(alreadyLocked, false);
        assert.equal(locked.id, window.id);
        assert.equal(locked.lockedBy, OPERATOR_TAG);
        assert.equal(audit.entries.at(-1).action, 'MAINTENANCE_LOCK');

        // The migration runs long.
        Object.assign(port.windows[0], { endsAt: inMinutes(-1) });
        const other = await freshService(port);
        assert.equal(await other.isLocked(), true);
        const status = await other.status();
        assert.equal(status.state, 'locked');
        assert.equal(status.overrun, true);
    });

    test('with nothing announced, locking opens a window that is locked at once', async () => {
        const { service } = setUp();
        const endsAt = inMinutes(30);
        const { window } = await service.lock({ endsAt, message: 'Hotfix' }, OPERATOR);
        assert.equal(window.startsAt, null, 'it was not announced');
        assert.equal(window.endsAt.toISOString(), endsAt.toISOString());
        assert.equal(window.message, 'Hotfix');
        assert.equal(await service.isLocked(), true);
    });

    test('locking what is locked changes nothing and says so', async () => {
        const { service, port, audit } = setUp();
        const first = await service.lock({}, OPERATOR);
        const second = await service.lock({ message: 'another try' }, OPERATOR);
        assert.equal(second.alreadyLocked, true);
        assert.equal(second.window.id, first.window.id);
        assert.equal(port.windows[0].message, null, 'the second lock wrote nothing');
        assert.equal(audit.entries.length, 1);
    });

    test('a lock meant for a window that is no longer the open one is refused', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        await service.cancel(window.id, OPERATOR);
        const refusal = await refusalOf(() => service.lock({ windowId: window.id }, OPERATOR));
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_NOT_OPEN');
        assert.equal(await service.isLocked(), false);
    });

    test('a lock stating an end that has passed is refused', async () => {
        const { service } = setUp();
        const refusal = await refusalOf(() => service.lock({ endsAt: inMinutes(-1) }, OPERATOR));
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_END_IN_PAST');
        assert.equal(await service.isLocked(), false);
    });

    test('a lock that lands while this one is being written is reported as already held', async () => {
        const { service, port } = setUp();
        await service.announce(announcement(), OPERATOR);
        // Another operator's lock lands between this call's read and its write.
        port.refuseNextUpdates = 1;
        port.lockBehindTheServicesBack();
        const outcome = await service.lock({}, OPERATOR);
        assert.equal(outcome.alreadyLocked, true);
        assert.equal(outcome.window.lockedBy, 'cli:other@example.com:elsewhere');
    });

    test('a locked window keeps its start, and may still move its expected end', async () => {
        const { service, notifications } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        await service.lock({}, OPERATOR);

        const refusal = await refusalOf(() =>
            service.reschedule(window.id, { startsAt: inMinutes(5) }, OPERATOR),
        );
        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_LOCKED');

        const later = inMinutes(240);
        const moved = await service.reschedule(window.id, { endsAt: later }, OPERATOR);
        assert.equal(moved.endsAt.toISOString(), later.toISOString());
        await settle();
        assert.equal(notifications.events.at(-1).kind, 'rescheduled');
    });

    test('a locked window is ended by unlocking, not by cancelling', async () => {
        const { service } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        await service.lock({}, OPERATOR);
        const refusal = await refusalOf(() => service.cancel(window.id, OPERATOR));
        assert.equal(refusal.code, 'MAINTENANCE_WINDOW_LOCKED');
        assert.equal(await service.isLocked(), true);
    });

    test('unlocking ends the window and lets tenants back in', async () => {
        const { service, audit } = setUp();
        await service.lock({}, OPERATOR);
        const outcome = await service.unlock({}, OPERATOR);
        assert.equal(outcome.wasLocked, true);
        assert.equal(outcome.window.endedBy, OPERATOR_TAG);
        assert.equal(await service.isLocked(), false);
        assert.deepEqual(await service.status(), { state: 'none' });
        assert.equal(audit.entries.at(-1).action, 'MAINTENANCE_UNLOCK');
    });

    test('an unlock that lost to another one does not end the lock a later deploy took', async () => {
        const { service, port } = setUp();
        await service.lock({}, OPERATOR);
        const [first] = port.windows;
        // Between this unlock's read and its write, another unlock ends the
        // lock, and the next deploy takes one of its own.
        const update = port.update.bind(port);
        port.update = async (...args) => {
            port.update = update;
            Object.assign(first, {
                endedAt: new Date(),
                endedBy: 'cli:other@example.com:elsewhere',
            });
            port.lockBehindTheServicesBack();
            return update(...args);
        };
        const outcome = await service.unlock({}, OPERATOR);
        assert.deepEqual(outcome, { window: null, wasLocked: false });
        const second = port.windows.find((window) => window.id !== first.id);
        assert.equal(second.endedAt, null, 'the later lock still holds');
        assert.equal(await new MaintenanceService(port, null, null).isLocked(), true);
    });

    test('unlocking what is not locked changes nothing, and leaves an announcement standing', async () => {
        const { service, audit } = setUp();
        const window = await service.announce(announcement(), OPERATOR);
        const outcome = await service.unlock({}, OPERATOR);
        assert.equal(outcome.wasLocked, false);
        assert.equal(outcome.window.id, window.id);
        assert.equal((await service.status()).state, 'announced');
        assert.equal(audit.entries.length, 1, 'only the announcement is recorded');

        const nothing = await setUp().service.unlock({}, OPERATOR);
        assert.deepEqual(nothing, { window: null, wasLocked: false });
    });
});

// @requirement SC-OPS-015 — The lock survives a restart, and the version being replaced honours it too
describe('what another process of the application makes of it', () => {
    test('a lock reaches a process that asked before it, within the time it may keep an answer', async () => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const port = new FakeMaintenanceWindowPort();
        const process = new MaintenanceService(port, null, null);
        assert.equal(await process.isLocked(), false);

        port.lockBehindTheServicesBack(new Date());
        mock.timers.tick(MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000 - 1);
        assert.equal(await process.isLocked(), false, 'still within the age it may keep');
        mock.timers.tick(1);
        assert.equal(await process.isLocked(), true, 'asks again once its answer is that old');
    });

    test('an answer that took its time to arrive ages from when it was asked', async () => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const port = new FakeMaintenanceWindowPort();
        const process = new MaintenanceService(port, null, null);
        const release = port.holdNextRead();
        const asked = process.isLocked();
        port.lockBehindTheServicesBack(new Date());
        mock.timers.tick(3000);
        release();
        assert.equal(await asked, false, 'the database answered before the lock');

        mock.timers.tick(MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000 - 3000);
        assert.equal(await process.isLocked(), true, 'aged from the question, not the reply');
    });

    test('an answer too old to act on when it arrives is asked for again', async () => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const port = new FakeMaintenanceWindowPort();
        const process = new MaintenanceService(port, null, null);
        const release = port.holdNextRead();
        const asked = process.isLocked();
        port.lockBehindTheServicesBack(new Date());
        mock.timers.tick(MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000 + 1000);
        release();
        assert.equal(await asked, true, 'the requests waiting on it are decided on a new answer');
        assert.equal(port.reads, 2);
    });

    test('a lock is acted on however late its answer arrives', async () => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const port = new FakeMaintenanceWindowPort();
        port.lockBehindTheServicesBack(new Date());
        const process = new MaintenanceService(port, null, null);
        const release = port.holdNextRead();
        const asked = process.isLocked();
        mock.timers.tick(MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000 + 1000);
        release();
        assert.equal(await asked, true);
        assert.equal(port.reads, 1, 'not asked again');
    });

    test('a read still on its way when this process locks does not undo the lock', async () => {
        const port = new FakeMaintenanceWindowPort();
        const process = new MaintenanceService(port, null, null);
        const release = port.holdNextRead();
        const asked = process.isLocked();
        await process.lock({}, OPERATOR);
        release();
        assert.equal(await asked, true, 'the requests waiting on it are decided on the lock');
        assert.equal(await process.isLocked(), true, 'and the late answer is not kept over it');
    });

    test('a burst of requests after the answer aged asks the table once', async () => {
        const port = new FakeMaintenanceWindowPort();
        const process = new MaintenanceService(port, null, null);
        await Promise.all([1, 2, 3, 4, 5].map(() => process.isLocked()));
        assert.equal(port.reads, 1);
    });

    test('a lock known to hold is not dropped because one read failed', async () => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const errors = mock.method(Logger.prototype, 'error', () => {});
        const port = new FakeMaintenanceWindowPort();
        port.lockBehindTheServicesBack(new Date());
        const process = new MaintenanceService(port, null, null);
        assert.equal(await process.isLocked(), true);

        port.failReads = new Error('connection refused');
        for (let i = 0; i < 3; i++) {
            mock.timers.tick(MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000);
            assert.equal(await process.isLocked(), true);
        }
        assert.equal(
            errors.mock.callCount(),
            1,
            'a failing database is logged once, not per request',
        );
    });

    test('a process that never read the lock lets requests through while the table cannot answer', async () => {
        mock.method(Logger.prototype, 'error', () => {});
        const port = new FakeMaintenanceWindowPort();
        port.failReads = new Error('relation "maintenance_windows" does not exist');
        assert.equal(await new MaintenanceService(port, null, null).isLocked(), false);
    });
});

describe('what the operator does not wait on', () => {
    test('an application that fails to hear of a window leaves the window recorded', async () => {
        const errors = mock.method(Logger.prototype, 'error', () => {});
        const { service, notifications, port } = setUp();
        notifications.failWith = new Error('smtp down');
        const window = await service.announce(announcement(), OPERATOR);
        await settle();
        assert.equal(port.windows[0].id, window.id);
        assert.equal(errors.mock.callCount(), 1);
    });

    test('and one that throws before it answers does too, and the announcement succeeds', async () => {
        const errors = mock.method(Logger.prototype, 'error', () => {});
        const { service, notifications, port } = setUp();
        notifications.windowChanged = () => {
            throw new Error('no recipient configured');
        };
        const window = await service.announce(announcement(), OPERATOR);
        await settle();
        assert.equal(port.windows[0].id, window.id);
        assert.equal(errors.mock.callCount(), 1);
    });

    // @requirement SC-AUD-004 — A failure to record something never blocks the act itself
    test('an audit log that cannot be written does not undo the lock', async () => {
        mock.method(Logger.prototype, 'error', () => {});
        const { service, audit } = setUp();
        audit.failWith = new Error('audit table locked');
        await service.lock({}, OPERATOR);
        assert.equal(await service.isLocked(), true);
    });
});
