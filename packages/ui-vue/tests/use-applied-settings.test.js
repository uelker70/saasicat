// The settings page's state, driven without a page.
//
// The composable takes the two seams it needs — the bound resource and the
// notify port — so these hand it two functions and read what it does: what it
// loads, how it reloads, what an acknowledgement replaces in place, and what a
// failed one reports and leaves alone.

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
    test('reload puts the view in place and clears an earlier error', async () => {
        let answer = () => Promise.reject(new Error('503'));
        const { state } = drive({ read: () => answer(), acknowledgeChange: async () => CHANGE });

        await state.reload();
        assert.equal(state.view.value, null);
        assert.ok(state.error.value instanceof Error);
        assert.equal(state.loading.value, false);

        answer = () => Promise.resolve(VIEW);
        await state.reload();
        assert.deepEqual(state.view.value, VIEW);
        assert.equal(state.error.value, null);
    });

    test('loading is on while the read is in flight, and off after', async () => {
        let release;
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const { state } = drive({ read: () => pending, acknowledgeChange: async () => CHANGE });
        const reload = state.reload();
        assert.equal(state.loading.value, true);
        release(VIEW);
        await reload;
        assert.equal(state.loading.value, false);
    });
});

// @requirement SC-CFG-031 — A recorded change survives until an operator acknowledges it
describe('acknowledging a change', () => {
    test('replaces the change in place with what the server answered', async () => {
        const seen = {
            ...CHANGE,
            acknowledgedAt: '2026-08-23T08:00:00.000Z',
            acknowledgedBy: 'web:ops@example.com:s-1',
        };
        const asked = [];
        const { state, notifications } = drive({
            read: async () => VIEW,
            acknowledgeChange: async (id) => {
                asked.push(id);
                return seen;
            },
        });
        await state.reload();
        await state.acknowledge('c-1');
        assert.deepEqual(asked, ['c-1']);
        assert.deepEqual(state.view.value.changes, [seen]);
        assert.equal(state.acknowledging.value, null);
        assert.deepEqual(notifications, []);
    });

    test('marks which change is being acknowledged, so its button alone shows progress', async () => {
        let release;
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const { state } = drive({ read: async () => VIEW, acknowledgeChange: () => pending });
        await state.reload();
        const acknowledging = state.acknowledge('c-1');
        assert.equal(state.acknowledging.value, 'c-1');
        release(CHANGE);
        await acknowledging;
        assert.equal(state.acknowledging.value, null);
    });

    test('a failure is reported through the notify port, and the change stays as it was', async () => {
        const { state, notifications } = drive({
            read: async () => VIEW,
            acknowledgeChange: async () => {
                throw new Error('503');
            },
        });
        await state.reload();
        // Resolves rather than rejects: the person has been told where they
        // are looking, and a rejection out of a click handler is an error
        // nobody hears.
        await state.acknowledge('c-1');
        await settled();
        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].kind, 'negative');
        assert.deepEqual(state.view.value.changes, [CHANGE]);
        assert.equal(state.acknowledging.value, null);
    });
});
