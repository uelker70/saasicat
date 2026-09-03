// The settings page's state, driven without a page.
//
// The composable takes the two seams it needs — the bound resource and the
// notify port — so these hand it two functions and read what it does: what it
// loads, what a failed load leaves on screen, which of two overlapping loads
// wins, what an acknowledgement replaces in place, and what a failed one
// reports and leaves alone.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';

import { useAppliedSettings } from '../dist/index.js';

const CHANGE = {
    id: 'c-1',
    noticedAt: '2026-08-22T12:03:00.000Z',
    source: '/srv/app/config/saas.yaml',
    differences: [{ path: 'vatRate', before: 19, after: 20 }],
    acknowledgedAt: null,
    acknowledgedBy: null,
};

const VIEW = {
    source: '/srv/app/config/saas.yaml',
    fingerprint: 'sha256-a',
    settings: { currency: 'EUR', vatRate: 20 },
    recorded: true,
    appliedAt: '2026-08-22T12:03:00.000Z',
    changes: [CHANGE],
};

const SEEN = {
    acknowledgedAt: '2026-08-23T08:00:00.000Z',
    acknowledgedBy: 'web:ops@example.com:s-1',
};

/** A promise and the hand that settles it. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function drive(resource) {
    const notifications = [];
    const state = useAppliedSettings(resource, (kind, message) => {
        notifications.push({ kind, message });
    });
    return { state, notifications };
}

async function settled() {
    await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

// @requirement SC-CFG-008 — An operator can see when the running configuration was applied, and from where
describe('loading the view', () => {
    test('loads on creation, and a reload after a failure clears the error', async () => {
        let answer = () => Promise.reject(new Error('503'));
        const { state } = drive({ read: () => answer(), acknowledgeChange: async () => CHANGE });
        await settled();
        assert.equal(state.view.value, null);
        assert.ok(state.error.value, 'the failure is kept');
        assert.equal(state.loading.value, false);

        answer = () => Promise.resolve(VIEW);
        await state.reload();
        assert.deepEqual(state.view.value, VIEW);
        assert.equal(state.error.value, null);
    });

    test('loading is on while the read is in flight, and off after', async () => {
        const read = deferred();
        const { state } = drive({
            read: () => read.promise,
            acknowledgeChange: async () => CHANGE,
        });
        await nextTick();
        assert.equal(state.loading.value, true);
        read.resolve(VIEW);
        await settled();
        assert.equal(state.loading.value, false);
    });

    test('a refresh that fails takes the old facts off the screen with it', async () => {
        // The page exists to say whether an edit has landed. Last visit's
        // appliedAt under an error banner would answer that about a read that
        // never happened.
        let answer = () => Promise.resolve(VIEW);
        const { state } = drive({ read: () => answer(), acknowledgeChange: async () => CHANGE });
        await settled();
        assert.deepEqual(state.view.value, VIEW);

        answer = () => Promise.reject(new Error('503'));
        await state.reload();
        assert.equal(state.view.value, null);
        assert.ok(state.error.value);
    });

    test('of two overlapping reloads, the newer answer stands even when it arrives first', async () => {
        const reads = [];
        const { state } = drive({
            read: () => {
                const read = deferred();
                reads.push(read);
                return read.promise;
            },
            acknowledgeChange: async () => CHANGE,
        });
        await nextTick();
        reads[0].resolve(VIEW);
        await settled();

        const first = state.reload();
        const second = state.reload();
        reads[2].resolve({ ...VIEW, fingerprint: 'sha256-newer' });
        await second;
        reads[1].resolve({ ...VIEW, fingerprint: 'sha256-older' });
        await first;
        assert.equal(state.view.value.fingerprint, 'sha256-newer');
        assert.equal(state.loading.value, false);
    });
});

// @requirement SC-CFG-031 — A recorded change survives until an operator acknowledges it
describe('acknowledging a change', () => {
    test('replaces the change in place with what the server answered', async () => {
        const seen = { ...CHANGE, ...SEEN };
        const asked = [];
        const { state, notifications } = drive({
            read: async () => VIEW,
            acknowledgeChange: async (id) => {
                asked.push(id);
                return seen;
            },
        });
        await settled();
        await state.acknowledge('c-1');
        assert.deepEqual(asked, ['c-1']);
        assert.deepEqual(state.view.value.changes, [seen]);
        assert.equal(state.acknowledging.value.size, 0);
        assert.deepEqual(notifications, []);
    });

    test('each button reports its own request: the first to answer clears only itself', async () => {
        const other = { ...CHANGE, id: 'c-2' };
        const pending = new Map();
        const { state } = drive({
            read: async () => ({ ...VIEW, changes: [CHANGE, other] }),
            acknowledgeChange: (id) => {
                const request = deferred();
                pending.set(id, request);
                return request.promise;
            },
        });
        await settled();

        const first = state.acknowledge('c-1');
        const second = state.acknowledge('c-2');
        assert.deepEqual([...state.acknowledging.value].sort(), ['c-1', 'c-2']);

        pending.get('c-1').resolve({ ...CHANGE, ...SEEN });
        await first;
        assert.deepEqual([...state.acknowledging.value], ['c-2']);

        pending.get('c-2').resolve({ ...other, ...SEEN });
        await second;
        assert.equal(state.acknowledging.value.size, 0);
        assert.ok(state.view.value.changes.every((change) => change.acknowledgedAt));
    });

    test('a failure is reported through the notify port, and the change stays as it was', async () => {
        const { state, notifications } = drive({
            read: async () => VIEW,
            acknowledgeChange: async () => {
                throw new Error('503');
            },
        });
        await settled();
        // Resolves rather than rejects: the person has been told where they
        // are looking, and a rejection out of a click handler is an error
        // nobody hears.
        await state.acknowledge('c-1');
        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].kind, 'negative');
        assert.deepEqual(state.view.value.changes, [CHANGE]);
        assert.equal(state.acknowledging.value.size, 0);
    });
});
