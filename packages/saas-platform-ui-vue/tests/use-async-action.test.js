// useAsyncAction — the pending/error/notify shape the pages write by hand.
//
// The cases are the shapes found in the pages it is meant to replace: a plain
// mutation, one with a success continuation, one whose failure needs a page's
// own wording, and one that must stay silent.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AdminError, DEFAULT_SA_LOCALE, SA_MESSAGES, useAsyncAction } from '../dist/index.js';

// Without a provider the composable reads the shared default i18n instance,
// which is the platform's default locale. Derived rather than hardcoded so the
// test still describes reality when that default changes.
const FALLBACK = SA_MESSAGES[DEFAULT_SA_LOCALE].errors;

/** Collects what the notify port was called with. */
function recordingNotify() {
    const calls = [];
    return { notify: (kind, message) => calls.push([kind, message]), calls };
}

/** A promise plus the handles to settle it, for testing the in-flight state. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('useAsyncAction — the happy path', () => {
    test('resolves what the action returned', async () => {
        const action = useAsyncAction(async (a, b) => a + b);
        assert.deepEqual(await action.run(2, 3), { ok: true, value: 5 });
    });

    test('passes every argument through', async () => {
        const seen = [];
        const action = useAsyncAction(async (...args) => {
            seen.push(args);
            return null;
        });
        await action.run('a', 1, { c: true });
        assert.deepEqual(seen[0], ['a', 1, { c: true }]);
    });

    test('pending is true while in flight and false afterwards', async () => {
        const gate = deferred();
        const action = useAsyncAction(() => gate.promise);
        assert.equal(action.pending.value, false);
        const running = action.run();
        assert.equal(action.pending.value, true);
        gate.resolve('done');
        await running;
        assert.equal(action.pending.value, false);
    });

    test('runs onSuccess with the result, before run resolves', async () => {
        const order = [];
        const action = useAsyncAction(async () => 'value', {
            onSuccess: async (result) => {
                order.push(`onSuccess:${result}`);
            },
        });
        await action.run();
        order.push('after');
        assert.deepEqual(order, ['onSuccess:value', 'after']);
    });

    test('stays silent on success by default', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(async () => 'x', { notify, successMessage: 'Saved' });
        await action.run();
        assert.deepEqual(calls, []);
    });

    test('notifyOn "both" raises the success message', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(async () => 'x', {
            notify,
            notifyOn: 'both',
            successMessage: 'Saved',
        });
        await action.run();
        assert.deepEqual(calls, [['positive', 'Saved']]);
    });

    test('a success message may be computed at call time', async () => {
        const { notify, calls } = recordingNotify();
        let name = 'first';
        const action = useAsyncAction(async () => null, {
            notify,
            notifyOn: 'both',
            successMessage: () => `Saved ${name}`,
        });
        await action.run();
        name = 'second';
        await action.run();
        assert.deepEqual(calls, [
            ['positive', 'Saved first'],
            ['positive', 'Saved second'],
        ]);
    });
});

describe('useAsyncAction — failure', () => {
    test('reports the failure in the result instead of throwing', async () => {
        const action = useAsyncAction(async () => {
            throw new Error('nope');
        });
        const result = await action.run();
        assert.equal(result.ok, false);
        assert.equal(result.error.detail, 'nope');
    });

    test('a void action is still distinguishable — the whole reason for the shape', async () => {
        // Most mutations here resolve `Promise<void>`: softDelete, discardDraft,
        // remove. With a bare `T | undefined` a success and a failure were the
        // same value, so no call site could branch on it.
        const succeeds = useAsyncAction(async () => {});
        const fails = useAsyncAction(async () => {
            throw new Error('gone');
        });
        assert.deepEqual(await succeeds.run(), { ok: true, value: undefined });
        assert.equal((await fails.run()).ok, false);
    });

    test('records the failure as an AdminError', async () => {
        const action = useAsyncAction(async () => {
            throw { response: { status: 403, data: { code: 'FORBIDDEN' } } };
        });
        await action.run();
        assert.ok(action.error.value instanceof AdminError);
        assert.equal(action.error.value.status, 403);
        assert.equal(action.error.value.code, 'FORBIDDEN');
    });

    test('clears pending even when the action throws', async () => {
        const action = useAsyncAction(async () => {
            throw new Error('nope');
        });
        await action.run();
        assert.equal(action.pending.value, false);
    });

    test('skips onSuccess', async () => {
        let ran = false;
        const action = useAsyncAction(
            async () => {
                throw new Error('nope');
            },
            {
                onSuccess: () => {
                    ran = true;
                },
            },
        );
        await action.run();
        assert.equal(ran, false);
    });

    test('reports through the notify port, worded from the default catalog', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(
            async () => {
                throw new AdminError({ status: 404 });
            },
            { notify },
        );
        await action.run();
        assert.deepEqual(calls, [['negative', FALLBACK.notFound]]);
    });

    test('what the server said outranks the catalog', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(
            async () => {
                throw new AdminError({ status: 409, detail: 'Version already published' });
            },
            { notify },
        );
        await action.run();
        assert.deepEqual(calls, [['negative', 'Version already published']]);
    });

    test('errorMessage outranks both, and sees the AdminError', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(
            async () => {
                throw new AdminError({ status: 422, code: 'STRICT_MODE_VIOLATIONS' });
            },
            {
                notify,
                errorMessage: (err) => `rejected: ${err.code} (${err.status})`,
            },
        );
        await action.run();
        assert.deepEqual(calls, [['negative', 'rejected: STRICT_MODE_VIOLATIONS (422)']]);
    });

    test('notifyOn "none" records the error without announcing it', async () => {
        const { notify, calls } = recordingNotify();
        const action = useAsyncAction(
            async () => {
                throw new Error('quiet');
            },
            { notify, notifyOn: 'none' },
        );
        await action.run();
        assert.deepEqual(calls, []);
        assert.equal(action.error.value.detail, 'quiet');
    });

    test('without a notify port the failure is still recorded', async () => {
        const action = useAsyncAction(async () => {
            throw new Error('nowhere to report');
        });
        await action.run();
        assert.equal(action.error.value.detail, 'nowhere to report');
    });
});

describe('useAsyncAction — the error ref over time', () => {
    test('a later success clears an earlier failure', async () => {
        let fail = true;
        const action = useAsyncAction(async () => {
            if (fail) throw new Error('first');
            return 'ok';
        });
        await action.run();
        assert.ok(action.error.value);
        fail = false;
        await action.run();
        assert.equal(action.error.value, null);
    });

    test('reset clears it without running anything', async () => {
        let runs = 0;
        const action = useAsyncAction(async () => {
            runs++;
            throw new Error('x');
        });
        await action.run();
        assert.ok(action.error.value);
        action.reset();
        assert.equal(action.error.value, null);
        assert.equal(runs, 1);
    });
});
