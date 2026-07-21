// createManifestStore — tests for the Pinia store factory. We set up an
// active Pinia, instantiate the store with a stub loader and verify the
// boilerplate (loaded flag, ensureLoaded inflight sharing, clearCache,
// reload).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { createManifestStore } from '../dist/index.js';

function buildLoaderStub({ payload, fail = false } = {}) {
    let loadCalls = 0;
    let clearCalls = 0;
    const loader = {
        load: async () => {
            loadCalls += 1;
            if (fail) throw new Error('boom');
            return payload ?? { build: { manifestHash: `h-${loadCalls}` } };
        },
        clearCache: () => {
            clearCalls += 1;
        },
    };
    return {
        loader,
        get loadCalls() {
            return loadCalls;
        },
        get clearCalls() {
            return clearCalls;
        },
    };
}

describe('createManifestStore — Happy Path', () => {
    test('initial: manifest=null, loaded=false, loading=false', () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-1' });
        const store = useStore();
        assert.equal(store.manifest, null);
        assert.equal(store.loaded, false);
        assert.equal(store.loading, false);
        assert.equal(store.error, null);
    });

    test('ensureLoaded triggers load + sets loaded=true', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-2' });
        const store = useStore();
        await store.ensureLoaded();
        assert.equal(stub.loadCalls, 1);
        assert.equal(store.loaded, true);
        assert.notEqual(store.manifest, null);
    });

    test('ensureLoaded is idempotent — second call does not load again', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-3' });
        const store = useStore();
        await store.ensureLoaded();
        await store.ensureLoaded();
        await store.ensureLoaded();
        assert.equal(stub.loadCalls, 1);
    });

    test('parallel ensureLoaded calls share the same inflight promise', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-4' });
        const store = useStore();
        await Promise.all([store.ensureLoaded(), store.ensureLoaded(), store.ensureLoaded()]);
        assert.equal(stub.loadCalls, 1);
    });
});

describe('createManifestStore — error path', () => {
    test('ensureLoaded rejects with the original error, state is still set', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub({ fail: true });
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-err-1' });
        const store = useStore();
        await assert.rejects(() => store.ensureLoaded(), /boom/);
        assert.notEqual(store.error, null);
        assert.equal(store.error.message, 'boom');
        assert.equal(store.manifest, null);
        assert.equal(store.loaded, false);
    });

    test('parallel ensureLoaded calls all reject with the same error', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub({ fail: true });
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-err-2' });
        const store = useStore();
        const results = await Promise.allSettled([
            store.ensureLoaded(),
            store.ensureLoaded(),
            store.ensureLoaded(),
        ]);
        assert.equal(stub.loadCalls, 1);
        for (const r of results) {
            assert.equal(r.status, 'rejected');
            assert.equal(r.reason.message, 'boom');
        }
    });
});

describe('createManifestStore — clearCache + reload', () => {
    test('clearCache clears manifest, loaded, loader cache', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-clear-1' });
        const store = useStore();
        await store.ensureLoaded();
        store.clearCache();
        assert.equal(store.manifest, null);
        assert.equal(store.loaded, false);
        assert.equal(stub.clearCalls, 1);
    });

    test('reload forces a re-load', async () => {
        setActivePinia(createPinia());
        const stub = buildLoaderStub();
        const useStore = createManifestStore({ loader: stub.loader, id: 'mfs-reload-1' });
        const store = useStore();
        await store.ensureLoaded();
        await store.reload();
        assert.equal(stub.loadCalls, 2);
        assert.equal(stub.clearCalls, 1);
        assert.equal(store.loaded, true);
    });
});

describe('createManifestStore — store ID override', () => {
    test('uses the given `id`, so parallel stores are isolated', async () => {
        setActivePinia(createPinia());
        const stubA = buildLoaderStub({ payload: { build: { manifestHash: 'a' } } });
        const stubB = buildLoaderStub({ payload: { build: { manifestHash: 'b' } } });
        const useA = createManifestStore({ loader: stubA.loader, id: 'mfs-a' });
        const useB = createManifestStore({ loader: stubB.loader, id: 'mfs-b' });
        const a = useA();
        const b = useB();
        await Promise.all([a.ensureLoaded(), b.ensureLoaded()]);
        assert.equal(a.manifest.build.manifestHash, 'a');
        assert.equal(b.manifest.build.manifestHash, 'b');
    });
});
