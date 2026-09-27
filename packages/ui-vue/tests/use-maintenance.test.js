// The maintenance page's state and the shell's lock strip, driven without a
// page.
//
// The composables take their seams — the bound resource, the notify and confirm
// ports, the second-factor prompt — so these hand them functions and read what
// they do: what is asked of the operator before a lock, what a declined
// confirmation or a cancelled code leaves untouched, what a failure reports,
// and how often the shell asks whether tenants are locked out.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, ref } from 'vue';

import {
    changedInstant,
    instantOfLocalInput,
    localInputOf,
    useMaintenance,
    useMaintenanceLockWatch,
} from '../dist/index.js';

// Stopped here rather than at the end of each case: a case that fails an
// assertion never reaches its own `scope.stop()`, and the composable's timer
// would then keep the process — and the failing run — alive for ever.
const scopes = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    mock.timers.reset();
});

const OPEN = { id: 'w-1', status: 'announced', overrun: false };
const LOCKED = { id: 'w-1', status: 'locked', overrun: false, lockedAt: '2026-10-02T20:03:00Z' };
const overviewOf = (open) => ({ open, recent: open ? [open] : [], takesEffectWithinSeconds: 5 });

async function settled() {
    await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

/**
 * The page's seams: a resource that records what it was asked, a confirm port
 * that answers as told, a second-factor prompt answered with `code` (or
 * cancelled, for `null`), and the notifications raised.
 */
function drive({ agree = true, code = '123456', lock, unlock, cancel, announce } = {}) {
    const requests = [];
    const notifications = [];
    const questions = [];
    const prompts = [];
    const record =
        (name, answer) =>
        async (...args) => {
            requests.push([name, ...args]);
            return answer ? answer(...args) : undefined;
        };
    const resource = {
        overview: record('overview', () => overviewOf(OPEN)),
        announce: record('announce', announce),
        reschedule: record('reschedule'),
        cancel: record('cancel', cancel),
        lock: record(
            'lock',
            lock ?? (() => ({ window: LOCKED, alreadyLocked: false, takesEffectWithinSeconds: 5 })),
        ),
        unlock: record('unlock', unlock ?? (() => ({ window: LOCKED, wasLocked: true }))),
    };
    // The loop itself is `useMfaPrompt`'s and is tested with it; here only
    // what the composable hands it, and what it does with the answer.
    const mfa = {
        async run(description, _invalid, action) {
            prompts.push(description);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
    const state = useMaintenance(
        resource,
        (kind, message) => notifications.push({ kind, message }),
        async (request) => {
            questions.push(request);
            return { ok: agree };
        },
        mfa,
    );
    return { state, requests, notifications, questions, prompts };
}

const writes = (requests) => requests.filter(([name]) => name !== 'overview');

// @requirement SC-ADM-029 — Locking tenants out and letting them back in needs the second factor in the administration
describe('locking from the administration', () => {
    test('asks for a confirmation that says every tenant is locked out, then for the code', async () => {
        const { state, requests, questions, notifications } = drive();
        const outcome = await state.lock({ windowId: 'w-1' });
        assert.equal(outcome, 'done');
        assert.equal(questions.length, 1);
        assert.equal(questions[0].tone, 'negative');
        assert.match(questions[0].message, /Every tenant request is refused/);
        assert.deepEqual(writes(requests), [['lock', { windowId: 'w-1' }, '123456']]);
        assert.match(
            notifications.at(-1).message,
            /Locked\. Every process sees the lock within 5 seconds/,
        );
    });

    test('a declined confirmation sends nothing and asks for no code', async () => {
        const { state, requests, prompts } = drive({ agree: false });
        assert.equal(await state.lock({}), 'cancelled');
        assert.deepEqual(writes(requests), []);
        assert.deepEqual(prompts, []);
    });

    test('a cancelled code sends nothing', async () => {
        const { state, requests } = drive({ code: null });
        assert.equal(await state.lock({}), 'cancelled');
        assert.deepEqual(writes(requests), []);
    });

    test('a lock that already held is said as such, not as a new lock', async () => {
        const { state, notifications } = drive({
            lock: () => ({ window: LOCKED, alreadyLocked: true, takesEffectWithinSeconds: 5 }),
        });
        assert.equal(await state.lock({}), 'unchanged');
        assert.equal(notifications.at(-1).message, 'The lock already held.');
    });

    test('a refused lock is reported, and nothing claims it held', async () => {
        const { state, notifications } = drive({
            lock: () => {
                throw new Error('No open maintenance window has this id.');
            },
        });
        assert.equal(await state.lock({ windowId: 'gone' }), 'failed');
        assert.deepEqual(
            notifications.map((n) => n.kind),
            ['negative'],
        );
    });

    test('unlocking asks again, and says when there was nothing to unlock', async () => {
        const { state, requests, questions, notifications } = drive({
            unlock: () => ({ window: null, wasLocked: false }),
        });
        assert.equal(await state.unlock('w-1'), 'unchanged');
        assert.equal(questions[0].title, 'Let the tenants back in?');
        assert.deepEqual(writes(requests), [['unlock', { windowId: 'w-1' }, '123456']]);
        assert.equal(notifications.at(-1).message, 'Nothing was locked.');
    });
});

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('announcing, moving and cancelling', () => {
    test('cancelling asks first and needs no code', async () => {
        const { state, requests, questions } = drive();
        assert.equal(await state.cancel('w-1'), 'done');
        assert.equal(questions.length, 1);
        assert.deepEqual(writes(requests), [['cancel', 'w-1']]);
    });

    test('a declined cancellation sends nothing', async () => {
        const { state, requests } = drive({ agree: false });
        assert.equal(await state.cancel('w-1'), 'cancelled');
        assert.deepEqual(writes(requests), []);
    });

    test('announcing sends the window and reads the windows again', async () => {
        const { state, requests } = drive();
        await settled();
        const readsBefore = requests.filter(([name]) => name === 'overview').length;
        const input = { startsAt: '2026-10-02T20:00:00.000Z', endsAt: '2026-10-02T21:00:00.000Z' };
        await state.announce(input);
        assert.deepEqual(writes(requests), [['announce', input]]);
        assert.equal(requests.filter(([name]) => name === 'overview').length, readsBefore + 1);
    });

    test('a refused announcement rejects, so the form keeps what was typed and says why', async () => {
        const { state } = drive({
            announce: () => {
                throw new Error('A maintenance window is already open.');
            },
        });
        await assert.rejects(() => state.announce({ startsAt: 'a', endsAt: 'b' }), /already open/);
    });
});

describe('the times a form sends', () => {
    // @requirement SC-OPS-011 — Dates are handled with their time zone stated, not inferred
    test('what the input shows is read back as the same moment, with its zone', () => {
        const iso = '2026-10-02T20:00:00.000Z';
        const local = localInputOf(iso);
        assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        assert.equal(instantOfLocalInput(local), iso);
    });

    test('a field left as it was sends nothing, even where the window carries seconds', () => {
        const had = '2026-10-02T20:00:30.500Z';
        assert.equal(changedInstant(localInputOf(had), had), undefined);
        const moved = localInputOf('2026-10-02T21:15:00.000Z');
        assert.equal(changedInstant(moved, had), '2026-10-02T21:15:00.000Z');
        assert.equal(changedInstant('', null), undefined);
    });

    test('nothing typed, or nothing readable, sends no time', () => {
        assert.equal(instantOfLocalInput(''), null);
        assert.equal(instantOfLocalInput('not a time'), null);
        assert.equal(localInputOf(null), '');
    });
});

// @requirement SC-ADM-030 — While tenants are locked out, every page of the administration says so
describe('the shell asking whether tenants are locked out', () => {
    function watching(answer, enabled = true) {
        let asked = 0;
        const resource = {
            overview: async () => {
                asked += 1;
                return answer();
            },
        };
        const scope = effectScope();
        scopes.push(scope);
        const watch = scope.run(() =>
            useMaintenanceLockWatch(ref(enabled ? resource : null), 30_000),
        );
        return { watch, scope, asked: () => asked };
    }

    test('knows a lock at once, and asks again every interval', async () => {
        mock.timers.enable({ apis: ['setInterval'] });
        const { watch, asked, scope } = watching(() => overviewOf(LOCKED));
        await settled();
        assert.equal(watch.locked.value?.id, 'w-1');
        mock.timers.tick(30_000);
        await settled();
        assert.equal(asked(), 2);
        scope.stop();
    });

    test('an announced window is no lock', async () => {
        const { watch, scope } = watching(() => overviewOf(OPEN));
        await settled();
        assert.equal(watch.locked.value, null);
        scope.stop();
    });

    test('stops asking when the shell unmounts', async () => {
        mock.timers.enable({ apis: ['setInterval'] });
        const { asked, scope } = watching(() => overviewOf(LOCKED));
        await settled();
        scope.stop();
        mock.timers.tick(90_000);
        await settled();
        assert.equal(asked(), 1);
    });

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('asks nothing where the installation keeps no windows', async () => {
        const { asked, scope } = watching(() => overviewOf(LOCKED), false);
        await settled();
        assert.equal(asked(), 0);
        scope.stop();
    });

    test('a failed read keeps what it knew rather than hiding the lock', async () => {
        mock.timers.enable({ apis: ['setInterval'] });
        let fail = false;
        const { watch, scope } = watching(() => {
            if (fail) throw new Error('offline');
            return overviewOf(LOCKED);
        });
        await settled();
        fail = true;
        mock.timers.tick(30_000);
        await settled();
        assert.equal(watch.locked.value?.id, 'w-1');
        scope.stop();
    });
});
