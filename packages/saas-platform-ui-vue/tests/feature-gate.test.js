import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import {
    ENTITLEMENT_INJECTION_KEY,
    buildFeatureRouterGuard,
    provideEntitlement,
} from '../dist/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P8.

function fakeEntitlement({ features = [], loading = false, snapshot = {} } = {}) {
    return {
        entitlement: ref(snapshot),
        loading: ref(loading),
        error: ref(null),
        load: async () => {},
        hasFeature: (key) => features.includes(key),
    };
}

describe('provideEntitlement', () => {
    test('app.provide is called with the inject key', () => {
        const recorded = [];
        const app = { provide: (key, value) => recorded.push({ key, value }) };
        const ent = fakeEntitlement({ features: ['NOTES'] });
        provideEntitlement(app, ent);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0].key, ENTITLEMENT_INJECTION_KEY);
        assert.equal(recorded[0].value, ent);
    });
});

describe('buildFeatureRouterGuard', () => {
    function callGuard(guard, to) {
        return new Promise((resolve) => {
            guard(to, { path: '/' }, (target) => resolve(target));
        });
    }

    test('route without meta.requiresFeature always passes', async () => {
        const guard = buildFeatureRouterGuard({ getEntitlement: () => null });
        const r = await callGuard(guard, { path: '/free', meta: {} });
        assert.equal(r, undefined, 'next() without argument = let it pass');
    });

    test('no entitlement bound -> pass', async () => {
        const guard = buildFeatureRouterGuard({ getEntitlement: () => null });
        const r = await callGuard(guard, {
            path: '/dms',
            meta: { requiresFeature: 'DMS' },
        });
        assert.equal(r, undefined);
    });

    test('feature present -> pass', async () => {
        const ent = fakeEntitlement({ features: ['DMS'] });
        const guard = buildFeatureRouterGuard({ getEntitlement: () => ent });
        const r = await callGuard(guard, {
            path: '/dms',
            meta: { requiresFeature: 'DMS' },
        });
        assert.equal(r, undefined);
    });

    test('feature missing + no redirectTo -> next(false)', async () => {
        const ent = fakeEntitlement({ features: [] });
        const guard = buildFeatureRouterGuard({ getEntitlement: () => ent });
        const r = await callGuard(guard, {
            path: '/dms',
            meta: { requiresFeature: 'DMS' },
        });
        assert.equal(r, false);
    });

    test('feature missing + redirectTo -> next("/upgrade")', async () => {
        const ent = fakeEntitlement({ features: [] });
        const guard = buildFeatureRouterGuard({
            getEntitlement: () => ent,
            redirectTo: '/upgrade',
        });
        const r = await callGuard(guard, {
            path: '/dms',
            meta: { requiresFeature: 'DMS' },
        });
        assert.equal(r, '/upgrade');
    });

    test('array requiresFeature -> logical OR', async () => {
        const ent = fakeEntitlement({ features: ['STORAGE_PRO'] });
        const guard = buildFeatureRouterGuard({ getEntitlement: () => ent });
        const r = await callGuard(guard, {
            path: '/x',
            meta: { requiresFeature: ['DMS', 'STORAGE_PRO'] },
        });
        assert.equal(r, undefined);
    });

    test('loading + null snapshot + allowWhileLoading default -> pass', async () => {
        const ent = fakeEntitlement({ loading: true, snapshot: null });
        const guard = buildFeatureRouterGuard({ getEntitlement: () => ent });
        const r = await callGuard(guard, {
            path: '/dms',
            meta: { requiresFeature: 'DMS' },
        });
        assert.equal(r, undefined);
    });
});
