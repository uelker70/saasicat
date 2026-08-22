// useAsyncData — the load-and-render shape, and what it leaves on the page
// when the load fails.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { AdminError, useAsyncData } from '../dist/index.js';

/** Lets the `immediate` microtask and any watcher run. */
async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

describe('useAsyncData — loading', () => {
    test('starts at the initial value', () => {
        const state = useAsyncData(async () => ['loaded'], { initial: [], immediate: false });
        assert.deepEqual(state.data.value, []);
        assert.equal(state.pending.value, false);
        assert.equal(state.error.value, null);
    });

    test('loads on creation by default', async () => {
        const state = useAsyncData(async () => ['loaded'], { initial: [] });
        await settle();
        assert.deepEqual(state.data.value, ['loaded']);
    });

    test('immediate: false loads nothing until asked', async () => {
        let calls = 0;
        const state = useAsyncData(
            async () => {
                calls++;
                return 'x';
            },
            { initial: null, immediate: false },
        );
        await settle();
        assert.equal(calls, 0);
        await state.reload();
        assert.equal(calls, 1);
        assert.equal(state.data.value, 'x');
    });

    test('does not block setup — nothing has loaded synchronously', () => {
        const state = useAsyncData(async () => 'x', { initial: 'initial' });
        assert.equal(state.data.value, 'initial');
    });

    test('pending is true while in flight', async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const state = useAsyncData(() => gate, { initial: null, immediate: false });
        const running = state.reload();
        assert.equal(state.pending.value, true);
        release('done');
        await running;
        assert.equal(state.pending.value, false);
    });
});

describe('useAsyncData — failure', () => {
    test('records the failure as an AdminError', async () => {
        const state = useAsyncData(
            async () => {
                throw { response: { status: 500, data: { message: 'boom' } } };
            },
            { initial: [], immediate: false },
        );
        await state.reload();
        assert.ok(state.error.value instanceof AdminError);
        assert.equal(state.error.value.status, 500);
        assert.equal(state.error.value.detail, 'boom');
    });

    test('puts the data back to initial rather than leaving stale rows', async () => {
        let fail = false;
        const state = useAsyncData(
            async () => {
                if (fail) throw new Error('gone');
                return ['a', 'b'];
            },
            { initial: [], immediate: false },
        );
        await state.reload();
        assert.deepEqual(state.data.value, ['a', 'b']);
        fail = true;
        await state.reload();
        assert.deepEqual(state.data.value, []);
    });

    test('reload does not throw', async () => {
        const state = useAsyncData(
            async () => {
                throw new Error('gone');
            },
            { initial: null, immediate: false },
        );
        await state.reload();
        assert.ok(state.error.value);
    });

    test('clears pending even when the load throws', async () => {
        const state = useAsyncData(
            async () => {
                throw new Error('gone');
            },
            { initial: null, immediate: false },
        );
        await state.reload();
        assert.equal(state.pending.value, false);
    });

    test('a later success clears the error', async () => {
        let fail = true;
        const state = useAsyncData(
            async () => {
                if (fail) throw new Error('first');
                return 'ok';
            },
            { initial: null, immediate: false },
        );
        await state.reload();
        assert.ok(state.error.value);
        fail = false;
        await state.reload();
        assert.equal(state.error.value, null);
        assert.equal(state.data.value, 'ok');
    });
});

describe('useAsyncData — overlapping loads', () => {
    /** A load whose promise the test settles by hand. */
    function gate() {
        let release;
        let fail;
        const promise = new Promise((resolve, reject) => {
            release = resolve;
            fail = reject;
        });
        return { promise, release, fail };
    }

    test('a superseded load does not overwrite the newer one', async () => {
        const gates = [gate(), gate()];
        let call = 0;
        const state = useAsyncData(() => gates[call++].promise, {
            initial: 'initial',
            immediate: false,
        });

        const first = state.reload();
        const second = state.reload();
        // The newer request answers first, the older one last.
        gates[1].release('second');
        gates[0].release('first');
        await Promise.all([first, second]);

        assert.equal(state.data.value, 'second');
    });

    test('a superseded load does not clear pending while the newer one runs', async () => {
        const gates = [gate(), gate()];
        let call = 0;
        const state = useAsyncData(() => gates[call++].promise, {
            initial: null,
            immediate: false,
        });

        const first = state.reload();
        const second = state.reload();
        gates[0].release('first');
        await first;
        assert.equal(state.pending.value, true, 'the newer load is still running');

        gates[1].release('second');
        await second;
        assert.equal(state.pending.value, false);
    });

    test('a superseded load that FAILS does not wipe the page or raise its error', async () => {
        // The worst of the three: the stale catch resets data to `initial` and
        // shows an error for a filter the operator has already left.
        const gates = [gate(), gate()];
        let call = 0;
        const state = useAsyncData(() => gates[call++].promise, {
            initial: [],
            immediate: false,
        });

        const first = state.reload();
        const second = state.reload();
        gates[1].release(['fresh']);
        await second;
        gates[0].fail(new Error('abandoned'));
        await first;

        assert.deepEqual(state.data.value, ['fresh']);
        assert.equal(state.error.value, null);
    });
});

describe('useAsyncData — watch', () => {
    test('reloads when a watched source changes', async () => {
        const slug = ref('acme');
        const seen = [];
        const state = useAsyncData(
            async () => {
                seen.push(slug.value);
                return slug.value.toUpperCase();
            },
            { initial: '', watch: [slug] },
        );
        await settle();
        assert.deepEqual(seen, ['acme']);
        slug.value = 'globex';
        await settle();
        assert.deepEqual(seen, ['acme', 'globex']);
        assert.equal(state.data.value, 'GLOBEX');
    });

    test('a watched source combines with immediate: false — the first load is the change', async () => {
        const slug = ref('acme');
        let calls = 0;
        useAsyncData(
            async () => {
                calls++;
                return null;
            },
            { initial: null, immediate: false, watch: [slug] },
        );
        await settle();
        assert.equal(calls, 0);
        slug.value = 'globex';
        await settle();
        assert.equal(calls, 1);
    });
});
