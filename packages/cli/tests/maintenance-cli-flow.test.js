// `<app> maintenance …`, as a deploy script runs it: lock before the migration,
// unlock after the health check, and nothing in between typed by a person.
//
// The real service over an in-memory port; the operator's identity and the
// production confirmation are the CLI context's, stood in for here so that a
// test can tell whether each command asked for them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAINTENANCE_STATE_MAX_AGE_SECONDS } from '@saasicat/core';
import { MaintenanceService } from '@saasicat/nest';

import {
    DEFAULT_DRAIN_SECONDS,
    MaintenanceAnnounceCommand,
    MaintenanceCancelCommand,
    MaintenanceCliFlow,
    MaintenanceCommands,
    MaintenanceDoctorCheck,
    MaintenanceOffCommand,
    MaintenanceOnCommand,
    MaintenanceRescheduleCommand,
    MaintenanceStatusCommand,
} from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

/** The port, in memory: one window open at most, moves guarded on the stage read. */
class MemoryWindows {
    windows = [];
    failReads = null;
    async findOpen() {
        if (this.failReads) throw this.failReads;
        return this.windows.find((w) => w.endedAt === null) ?? null;
    }
    async listRecent(limit) {
        return [...this.windows].reverse().slice(0, limit);
    }
    async open(window) {
        if (this.windows.some((w) => w.endedAt === null)) return null;
        const stored = {
            id: `w-${this.windows.length + 1}`,
            ...window,
            endedAt: null,
            endedBy: null,
        };
        this.windows.push(stored);
        return { ...stored };
    }
    async update(id, stage, changes) {
        const w = this.windows.find(
            (c) =>
                c.id === id && c.endedAt === null && (c.lockedAt !== null) === (stage === 'locked'),
        );
        if (!w) return null;
        Object.assign(w, changes);
        return { ...w };
    }
}

function setUp() {
    const port = new MemoryWindows();
    const ctx = recordingContext();
    const service = new MaintenanceService(port, null, null);
    const flow = new MaintenanceCliFlow(ctx, service);
    const slept = [];
    flow.sleep = async (ms) => {
        slept.push(ms);
    };
    return { port, ctx, service, flow, slept };
}

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000);
const zoned = (date) => date.toISOString().replace('Z', '+00:00');

// @requirement SC-OPS-015 — The lock survives a restart, and the version being replaced honours it too
describe('`maintenance on` returns once every process has seen the lock', () => {
    const fullWait = (MAINTENANCE_STATE_MAX_AGE_SECONDS + DEFAULT_DRAIN_SECONDS) * 1000;

    test('it waits the time a process may keep an answer, plus the grace for requests under way', async () => {
        const { flow, slept, service } = setUp();
        const outcome = await flow.on({ yes: true });
        assert.equal(outcome.alreadyLocked, false);
        assert.equal(await service.isLocked(), true);
        assert.deepEqual(slept, [fullWait]);
        assert.equal(outcome.waitedMs, fullWait);
    });

    test('a grace of its own is waited instead, zero included', async () => {
        const { flow, slept } = setUp();
        await flow.on({ yes: true, drain: 0 });
        assert.deepEqual(slept, [MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000]);
    });

    test('the wait starts once the lock is written, not at the moment the lock records', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const { flow, slept, port } = setUp();
        const open = port.open.bind(port);
        port.open = async (window) => {
            t.mock.timers.tick(2000);
            return open(window);
        };
        const outcome = await flow.on({ yes: true });
        assert.ok(
            Date.now() - outcome.window.lockedAt.getTime() >= 2000,
            'the write took its time',
        );
        assert.deepEqual(slept, [fullWait]);
    });

    test('a lock that already held is waited for from this call too', async () => {
        const { flow, slept, port } = setUp();
        await flow.on({ yes: true });
        port.windows[0].lockedAt = inMinutes(-5);
        const again = await flow.on({ yes: true });
        assert.equal(again.alreadyLocked, true);
        assert.deepEqual(slept, [fullWait, fullWait]);
    });

    test('a grace that is not a number of seconds is refused before anything is locked', async () => {
        const { flow, service } = setUp();
        for (const drain of [Number.NaN, -1]) {
            const error = await cliErrorOf(() => flow.on({ yes: true, drain }));
            assert.equal(error.exitCode, 1);
        }
        assert.equal(await service.isLocked(), false);
    });
});

// @requirement SC-ADM-029 — Locking tenants out and letting them back in needs the second factor in the administration
describe('what a writing command asks of the operator', () => {
    test('an identity and the production confirmation — and no second factor', async () => {
        const { flow, ctx, port } = setUp();
        await flow.on({ yes: true, as: 'deployer@example.com' });
        assert.deepEqual(ctx.asked, ['identity', 'super-admin', 'confirmed with --yes']);
        assert.equal(port.windows[0].lockedBy, 'cli:deployer@example.com:deploy-host');
    });

    test('reading the status asks for nothing', async () => {
        const { flow, ctx } = setUp();
        const overview = await flow.status();
        assert.equal(overview.open, null);
        assert.deepEqual(ctx.asked, []);
        assert.equal(flow.formatOverview(overview), 'No maintenance window is open.');
    });
});

// @requirement SC-OPS-011 — Dates are handled with their time zone stated, not inferred
describe('times are read with their zone', () => {
    test('a time without one is refused, naming the flag', async () => {
        const { flow } = setUp();
        const error = await cliErrorOf(() =>
            flow.announce({ starts: '2026-10-02T22:00', ends: '2026-10-02T23:00+02:00' }),
        );
        assert.equal(error.exitCode, 1);
        assert.match(error.message, /--starts takes a date and time with its zone/);
    });

    test('an offset and a Z both name a moment', async () => {
        const { flow } = setUp();
        const startsAt = inMinutes(60);
        const window = await flow.announce({
            starts: zoned(startsAt),
            ends: inMinutes(120).toISOString(),
            yes: true,
        });
        assert.equal(window.startsAt.getTime(), startsAt.getTime());
    });
});

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('announcing, moving and cancelling from the command line', () => {
    test('an announcement needs both times', async () => {
        const { flow } = setUp();
        const error = await cliErrorOf(() => flow.announce({ ends: inMinutes(60).toISOString() }));
        assert.equal(error.code, 'MAINTENANCE_TIMES_REQUIRED');
    });

    test('a second announcement is a conflict a script can branch on', async () => {
        const { flow } = setUp();
        const times = { starts: inMinutes(60).toISOString(), ends: inMinutes(90).toISOString() };
        await flow.announce({ ...times, yes: true });
        const error = await cliErrorOf(() => flow.announce({ ...times, yes: true }));
        assert.equal(error.exitCode, 6);
        assert.equal(error.code, 'MAINTENANCE_WINDOW_ALREADY_OPEN');
    });

    test('moving and cancelling act on the open window, and refuse where none is', async () => {
        const { flow } = setUp();
        for (const act of [() => flow.reschedule({ message: 'x' }), () => flow.cancel({})]) {
            const error = await cliErrorOf(act);
            assert.equal(error.code, 'MAINTENANCE_WINDOW_NOT_OPEN');
            assert.equal(error.exitCode, 1);
        }
        await flow.announce({
            starts: inMinutes(60).toISOString(),
            ends: inMinutes(90).toISOString(),
            message: 'Upgrade',
        });
        const moved = await flow.reschedule({ message: 'Upgrade to 2.3' });
        assert.equal(moved.message, 'Upgrade to 2.3');
        const cancelled = await flow.cancel({});
        assert.ok(cancelled.endedAt);
    });

    test('the status says what is announced, and what is locked', async () => {
        const { flow } = setUp();
        await flow.announce({
            starts: inMinutes(60).toISOString(),
            ends: inMinutes(90).toISOString(),
            message: 'Upgrade',
        });
        assert.match(
            flow.formatOverview(await flow.status()),
            /^Announced for .* by cli:ops@example.com:deploy-host\.\nMessage: Upgrade$/,
        );
        await flow.on({});
        assert.match(flow.formatOverview(await flow.status()), /^LOCKED since /);
    });
});

// @requirement SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does
describe('`maintenance off`', () => {
    test('lets tenants back in, and says when there was nothing to unlock', async () => {
        const { flow, service } = setUp();
        assert.deepEqual(await flow.off({}), { window: null, wasLocked: false });
        await flow.on({});
        const outcome = await flow.off({});
        assert.equal(outcome.wasLocked, true);
        assert.equal(await service.isLocked(), false);
    });
});

// @requirement SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does
describe('`<app> doctor` about the lock', () => {
    async function checkWith(prepare) {
        const port = new MemoryWindows();
        const service = new MaintenanceService(port, null, null);
        await prepare?.(service, port);
        return new MaintenanceDoctorCheck(service).run();
    }
    const OPERATOR = { userId: 'u', email: 'ops@example.com', source: 'cli', context: 'h' };

    test('without maintenance turned on there is nothing to report', async () => {
        assert.equal((await new MaintenanceDoctorCheck(null).run()).severity, 'ok');
    });

    test('nothing open, or a window ahead, is fine', async () => {
        assert.equal((await checkWith()).severity, 'ok');
        const ahead = await checkWith((s) =>
            s.announce({ startsAt: inMinutes(60), endsAt: inMinutes(90) }, OPERATOR),
        );
        assert.equal(ahead.severity, 'ok');
    });

    test('a lock is reported while it holds, and louder once its announced end has passed', async () => {
        const holding = await checkWith((s) => s.lock({ endsAt: inMinutes(30) }, OPERATOR));
        assert.equal(holding.severity, 'warning');
        assert.match(holding.message, /Tenants are locked out since/);

        const overrun = await checkWith(async (s, port) => {
            await s.lock({ endsAt: inMinutes(30) }, OPERATOR);
            port.windows[0].endsAt = inMinutes(-10);
        });
        assert.equal(overrun.severity, 'warning');
        assert.match(overrun.message, /has passed\. Unlock with `maintenance off`/);
    });

    test('an announcement whose end passed without a lock is named for cancelling', async () => {
        const lapsed = await checkWith(async (s, port) => {
            await s.announce({ startsAt: inMinutes(60), endsAt: inMinutes(90) }, OPERATOR);
            Object.assign(port.windows[0], { startsAt: inMinutes(-90), endsAt: inMinutes(-60) });
        });
        assert.equal(lapsed.severity, 'warning');
        assert.match(lapsed.message, /never locked/);
    });

    test('a table the lock cannot be read from is an error', async () => {
        const broken = await checkWith((_, port) => {
            port.failReads = new Error('relation "maintenance_windows" does not exist');
        });
        assert.equal(broken.severity, 'error');
        assert.match(broken.message, /cannot be read/);
    });
});

// What each command prints, and the options it reads — the part a deploy
// script's log shows and an operator's shell parses.
describe('the `maintenance` commands', () => {
    const times = () => ({
        starts: inMinutes(60).toISOString(),
        ends: inMinutes(90).toISOString(),
    });

    test('status prints the open window, or the overview as JSON', async () => {
        const { flow } = setUp();
        const command = new MaintenanceStatusCommand(flow);
        assert.equal(await printed(command), 'No maintenance window is open.\n');
        assert.equal(JSON.parse(await printed(command, { output: 'json' })).open, null);
        assert.equal(command.parseOutput('json'), 'json');
    });

    test('announce, reschedule and cancel say what they did', async () => {
        const { flow } = setUp();
        const announce = new MaintenanceAnnounceCommand(flow);
        assert.match(await printed(announce, times()), /^Announced: .+ to .+\.\n$/);
        assert.match(
            await printed(new MaintenanceRescheduleCommand(flow), { message: 'Later' }),
            /^Now .+ to .+\.\n$/,
        );
        assert.equal(
            await printed(new MaintenanceCancelCommand(flow), {}),
            'The announced window is cancelled.\n',
        );
    });

    test('on and off say whether they locked, and how long they waited', async () => {
        const { flow } = setUp();
        assert.match(
            await printed(new MaintenanceOnCommand(flow), { drain: 0 }),
            /^Locked since .+; waited 5 s for every process to see it\.\n$/,
        );
        assert.match(await printed(new MaintenanceOnCommand(flow), {}), /^Already locked since /);
        const off = new MaintenanceOffCommand(flow);
        assert.equal(await printed(off), 'Unlocked; tenants are back.\n');
        assert.equal(await printed(off), 'Nothing was locked.\n');
    });

    test('every option reads what was typed, and --drain as a number', () => {
        const { flow } = setUp();
        const announce = new MaintenanceAnnounceCommand(flow);
        const on = new MaintenanceOnCommand(flow);
        const reschedule = new MaintenanceRescheduleCommand(flow);
        assert.equal(announce.parseAs('a@example.com'), 'a@example.com');
        assert.equal(announce.parseYes(), true);
        assert.equal(announce.parseStarts('s'), 's');
        assert.equal(announce.parseEnds('e'), 'e');
        assert.equal(announce.parseMessage('m'), 'm');
        assert.equal(reschedule.parseStarts('s'), 's');
        assert.equal(reschedule.parseEnds('e'), 'e');
        assert.equal(reschedule.parseMessage('m'), 'm');
        assert.equal(on.parseUntil('u'), 'u');
        assert.equal(on.parseMessage('m'), 'm');
        assert.equal(on.parseDrain('15'), 15);
        assert.ok(Number.isNaN(on.parseDrain('soon')), 'refused by the flow, not guessed here');
    });

    test('without a sub-command it names them and exits 2', async () => {
        const exit = process.exit;
        const errorWrite = process.stderr.write;
        let code;
        let said = '';
        process.exit = (value) => {
            code = value;
        };
        process.stderr.write = (chunk) => {
            said += String(chunk);
            return true;
        };
        try {
            await new MaintenanceCommands().run();
        } finally {
            process.exit = exit;
            process.stderr.write = errorWrite;
        }
        assert.equal(code, 2);
        assert.match(said, /status, announce, reschedule, cancel, on, off/);
    });
});
