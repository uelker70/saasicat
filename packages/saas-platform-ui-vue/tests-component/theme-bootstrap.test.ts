import { describe, expect, test, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { Dark } from 'quasar';

import { createSuperAdminApp } from '../src/quasar/create-super-admin-app.js';

// What the bootstrap does to a theme somebody already set.
//
// The bridge's first tick MIRRORS: it writes whatever the theme resolves to,
// including `Dark.set(false)`. So an app that asked Quasar for dark had that
// erased one line after it was applied, on any machine whose OS prefers light —
// which broke the documented "Quasar decided" path for exactly the apps using
// this helper.
//
// The way in is `quasarOptions.config.dark`, and only that: a `Dark.set(true)`
// BEFORE the bootstrap does not survive it either way, because `app.use(Quasar)`
// re-applies `Dark` from the config it was given. Writing the first case that
// way is what showed it — the assertion failed for a reason that had nothing to
// do with the fix.
//
// These run against the real `createSuperAdminApp` rather than a re-creation of
// its ordering, because the ordering IS the thing under test.

const Root = defineComponent({ render: () => h('div') });

function bootstrap(options: Record<string, unknown> = {}) {
    return createSuperAdminApp({
        rootComponent: Root,
        brand: { name: 'Fixture', logoText: 'FX' },
        endpoints: { apiBase: '/api/admin' },
        appRoutes: [{ path: '/:pathMatch(.*)*', component: Root }],
        // Nothing should be remembered between cases here; the storage seam is
        // covered in `tests/use-sa-theme.test.js`.
        theme: { persist: false, ...(options.theme as object) },
        ...options,
    });
}

describe('the bootstrap and an already-chosen theme', () => {
    beforeEach(() => {
        Dark.set(false);
        document.documentElement.removeAttribute('data-sa-theme');
    });

    test("Quasar's configured dark mode survives the bootstrap", () => {
        const handle = bootstrap({
            quasarOptions: { plugins: {}, config: { dark: true } },
        });

        expect(Dark.isActive, 'the bridge switched Quasar back to light').toBe(true);
        expect(handle.theme.scheme.value).toBe('dark');
        expect(document.documentElement.getAttribute('data-sa-theme')).toBe('dark');
        handle.dispose();
    });

    test('an explicit scheme still outranks what Quasar was set to', () => {
        // Seeding is a default, not a veto: an app that names a scheme means it.
        const handle = bootstrap({
            quasarOptions: { plugins: {}, config: { dark: true } },
            theme: { scheme: 'light', persist: false },
        });

        expect(handle.theme.scheme.value).toBe('light');
        expect(Dark.isActive).toBe(false);
        handle.dispose();
    });

    test('with Quasar light, the theme is left on system', () => {
        const handle = bootstrap();

        expect(handle.theme.scheme.value).toBe('system');
        handle.dispose();
    });

    test('dispose() stops the bridge writing to the document', async () => {
        const handle = bootstrap();
        handle.dispose();

        handle.theme.scheme.value = 'dark';
        await Promise.resolve();

        expect(
            document.documentElement.getAttribute('data-sa-theme'),
            'a disposed handle still drives the document — a second shell in this ' +
                'page would be fighting a context nobody holds any more',
        ).not.toBe('dark');
    });
});
