// `defaultKvStore()` sits on the mandatory boot path (i18n persistence,
// manifest ETag cache). Browsers that block site data turn every localStorage
// touch into a throw, so the store has to degrade instead of taking the app
// down with it.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { defaultKvStore } from '../dist/index.js';

function stubLocalStorage(descriptor) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
}

afterEach(() => {
    delete globalThis.localStorage;
});

describe('defaultKvStore', () => {
    test('without localStorage it is a no-op store', () => {
        const store = defaultKvStore();
        assert.equal(store.get('k'), null);
        store.set('k', 'v');
        store.remove('k');
    });

    test('a throwing localStorage getter does not escape', () => {
        stubLocalStorage({
            get() {
                throw new Error('SecurityError: Access is denied for this document.');
            },
        });
        // The throw must be swallowed here, not at the call site — otherwise
        // createSuperAdminApp() dies before mount() and the app renders blank.
        const store = defaultKvStore();
        assert.equal(store.get('k'), null);
        store.set('k', 'v');
        store.remove('k');
    });

    test('reads and writes go through when localStorage works', () => {
        const map = new Map();
        stubLocalStorage({
            value: {
                getItem: (k) => map.get(k) ?? null,
                setItem: (k, v) => map.set(k, v),
                removeItem: (k) => map.delete(k),
            },
        });
        const store = defaultKvStore();
        store.set('k', 'v');
        assert.equal(store.get('k'), 'v');
        store.remove('k');
        assert.equal(store.get('k'), null);
    });

    test('a failing write is swallowed — quota or private mode', () => {
        stubLocalStorage({
            value: {
                getItem: () => null,
                setItem: () => {
                    throw new Error('QuotaExceededError');
                },
                removeItem: () => {
                    throw new Error('QuotaExceededError');
                },
            },
        });
        const store = defaultKvStore();
        store.set('k', 'v');
        store.remove('k');
    });

    test('a failing read yields null rather than throwing', () => {
        stubLocalStorage({
            value: {
                getItem: () => {
                    throw new Error('SecurityError');
                },
                setItem: () => {},
                removeItem: () => {},
            },
        });
        assert.equal(defaultKvStore().get('k'), null);
    });
});
