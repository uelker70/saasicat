// The colour-scheme context: what 'system' resolves to, who owns the value,
// and what is remembered.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computed, nextTick, ref } from 'vue';

import {
    createSaTheme,
    useSaTheme,
    SA_COLOR_SCHEMES,
    SA_THEME_KEY,
    SA_THEME_STORAGE_KEY,
} from '../dist/index.js';

function buildStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => map.set(k, v),
        remove: (k) => map.delete(k),
        map,
    };
}

/**
 * Stands in for the browser's `prefers-color-scheme`, with a handle to flip it.
 *
 * The composable subscribes rather than reading once, and this is what proves
 * it: somebody changing their system to dark at sunset has the tab open.
 */
function stubMatchMedia(initiallyDark) {
    const listeners = new Set();
    const original = globalThis.window;
    globalThis.window = {
        matchMedia: (query) => ({
            matches: query.includes('dark') ? initiallyDark : false,
            addEventListener: (_event, handler) => listeners.add(handler),
            removeEventListener: (_event, handler) => listeners.delete(handler),
        }),
    };
    return {
        set(dark) {
            for (const handler of listeners) handler({ matches: dark });
        },
        restore() {
            if (original === undefined) delete globalThis.window;
            else globalThis.window = original;
        },
    };
}

describe('createSaTheme', () => {
    test("defaults to 'system'", () => {
        const theme = createSaTheme({ storage: buildStorage(), persist: false });
        assert.equal(theme.scheme.value, 'system');
    });

    test('an explicit scheme resolves to itself', () => {
        const theme = createSaTheme({ scheme: 'dark', storage: buildStorage(), persist: false });
        assert.equal(theme.resolved.value, 'dark');
        theme.scheme.value = 'light';
        assert.equal(theme.resolved.value, 'light');
    });

    test("without matchMedia, 'system' resolves to light", () => {
        // Guessing dark for a missing API would disagree with the stylesheet,
        // which also falls back to its light block.
        //
        // Stated rather than assumed: the case only means something while there
        // is no `window`, and a leaked stub from another test would leave this
        // passing for the wrong reason.
        assert.equal(
            typeof globalThis.window,
            'undefined',
            'a matchMedia stub leaked into this test',
        );
        const theme = createSaTheme({ storage: buildStorage(), persist: false });
        assert.equal(theme.resolved.value, 'light');
    });

    test("'system' follows the operating system, and keeps following it", async () => {
        const media = stubMatchMedia(true);
        try {
            const theme = createSaTheme({ storage: buildStorage(), persist: false });
            assert.equal(theme.resolved.value, 'dark');

            media.set(false);
            await nextTick();
            assert.equal(
                theme.resolved.value,
                'light',
                'the composable read the preference once instead of subscribing',
            );
        } finally {
            media.restore();
        }
    });

    test('an explicit pick outranks the operating system', () => {
        const media = stubMatchMedia(true);
        try {
            const theme = createSaTheme({
                scheme: 'light',
                storage: buildStorage(),
                persist: false,
            });
            assert.equal(theme.resolved.value, 'light');
        } finally {
            media.restore();
        }
    });

    test('the picked scheme is written to storage', async () => {
        const storage = buildStorage();
        const theme = createSaTheme({ storage });
        theme.scheme.value = 'dark';
        await nextTick();
        assert.equal(storage.get('saasicat.theme.scheme'), 'dark');
    });

    test('a stored pick outranks the app default', () => {
        const storage = buildStorage({ 'saasicat.theme.scheme': 'dark' });
        const theme = createSaTheme({ scheme: 'light', storage });
        assert.equal(theme.scheme.value, 'dark');
    });

    test('a corrupt stored value falls back to the app default', () => {
        const storage = buildStorage({ 'saasicat.theme.scheme': 'sepia' });
        const theme = createSaTheme({ scheme: 'dark', storage });
        assert.equal(theme.scheme.value, 'dark');
    });

    test('persist: false neither reads nor writes storage', async () => {
        const storage = buildStorage({ 'saasicat.theme.scheme': 'dark' });
        const theme = createSaTheme({ scheme: 'light', storage, persist: false });
        assert.equal(theme.scheme.value, 'light');
        theme.scheme.value = 'dark';
        await nextTick();
        assert.equal(
            storage.get('saasicat.theme.scheme'),
            'dark',
            'the stored value was rewritten',
        );
        assert.equal(storage.map.size, 1);
    });

    test('an app-supplied Ref is used as-is and is not persisted', async () => {
        // The app owns that value and persists it where it belongs — a user
        // profile, its own store. Writing it here too would give one setting
        // two homes that can disagree.
        const storage = buildStorage();
        const scheme = ref('dark');
        const theme = createSaTheme({ scheme, storage });
        assert.equal(theme.scheme, scheme);
        assert.equal(theme.resolved.value, 'dark');

        scheme.value = 'light';
        await nextTick();
        assert.equal(theme.resolved.value, 'light');
        assert.equal(storage.map.size, 0);
    });

    test('dispose() ends the operating-system subscription', async () => {
        // Nothing unmounts this context, so nothing releases it either. A second
        // shell in the same document would otherwise leave the first subscribed,
        // and the next OS change would drive two bridges onto one document — the
        // stale one able to overrule the new shell's explicit scheme.
        const media = stubMatchMedia(false);
        try {
            const theme = createSaTheme({ storage: buildStorage(), persist: false });
            media.set(true);
            await nextTick();
            assert.equal(theme.resolved.value, 'dark', 'the subscription was never live');

            theme.dispose();
            media.set(false);
            await nextTick();
            assert.equal(
                theme.resolved.value,
                'dark',
                'a disposed theme still follows the operating system',
            );
        } finally {
            media.restore();
        }
    });

    test('dispose() is idempotent and stops persisting', async () => {
        const storage = buildStorage();
        const theme = createSaTheme({ storage });
        theme.dispose();
        theme.dispose();

        theme.scheme.value = 'dark';
        await nextTick();
        assert.equal(
            storage.get('saasicat.theme.scheme'),
            null,
            'a disposed theme still writes to storage',
        );
    });

    test('a stored pick does not overrule an app-supplied Ref', () => {
        const storage = buildStorage({ 'saasicat.theme.scheme': 'dark' });
        const scheme = ref('light');
        const theme = createSaTheme({ scheme, storage });
        assert.equal(theme.scheme.value, 'light');
    });
});

describe('the switcher the theme offers', () => {
    test('the switcher is on by default', () => {
        const theme = createSaTheme({ storage: buildStorage(), persist: false });
        assert.equal(theme.switcherEnabled, true);
    });

    test('an app can turn it off', () => {
        // A deployment that ships one appearance — the control would be noise.
        const theme = createSaTheme({ switcher: false, storage: buildStorage(), persist: false });
        assert.equal(theme.switcherEnabled, false);
    });

    test('a readonly scheme turns it off on its own', () => {
        // Typically a `computed` derived from a profile setting. It swallows
        // writes silently, and TypeScript ignores `readonly` when checking
        // assignability — so a dead control is what the type system permits and
        // only a runtime check prevents.
        const scheme = computed(() => 'dark');
        const theme = createSaTheme({ scheme, storage: buildStorage(), persist: false });
        assert.equal(theme.switcherEnabled, false);
    });

    test('it offers exactly the three schemes, in a stable order', () => {
        assert.deepEqual([...SA_COLOR_SCHEMES], ['light', 'dark', 'system']);
    });
});

describe('the persisted key', () => {
    test('two apps on one origin can keep their picks apart', async () => {
        // Without a prefix both write `saasicat.theme.scheme`, so opening the
        // second admin inherits whatever the first one's operator picked. The
        // key itself does not move: it is already in browsers.
        const storage = buildStorage();
        const first = createSaTheme({ storage });
        const second = createSaTheme({ storage, storageKeyPrefix: 'ops:' });

        first.scheme.value = 'dark';
        second.scheme.value = 'light';
        await nextTick();

        assert.equal(storage.get(SA_THEME_STORAGE_KEY), 'dark');
        assert.equal(storage.get(`ops:${SA_THEME_STORAGE_KEY}`), 'light');
    });

    test('a prefixed app reads back its own pick, not the unprefixed one', () => {
        const storage = buildStorage({
            [SA_THEME_STORAGE_KEY]: 'dark',
            [`ops:${SA_THEME_STORAGE_KEY}`]: 'light',
        });
        assert.equal(createSaTheme({ storage, storageKeyPrefix: 'ops:' }).scheme.value, 'light');
    });

    test('the key itself is unchanged', () => {
        // It is persisted in real browsers; renaming it would silently reset
        // every operator's pick.
        assert.equal(SA_THEME_STORAGE_KEY, 'saasicat.theme.scheme');
    });
});

describe('useSaTheme', () => {
    test('outside a shell it returns a shared, unpersisted instance', () => {
        // Shared so two components agree; unpersisted so one test cannot decide
        // another one's outcome through real storage.
        const first = useSaTheme();
        const second = useSaTheme();
        assert.equal(first, second);
        assert.equal(first.scheme.value, 'system');
    });

    test('the injection key is a global symbol', () => {
        // Same reason as every other key in the package: the dist- and
        // src-imported copies of this module must resolve to one key, or a
        // consumer that imports both provides into one and injects from another.
        assert.equal(SA_THEME_KEY, Symbol.for('@saasicat/ui-vue/SA_THEME'));
    });
});
