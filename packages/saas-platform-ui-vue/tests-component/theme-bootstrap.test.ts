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
// The seed reads that option rather than the resulting `Dark.isActive`, because
// the option has three states and the flag has two: `'auto'` means "follow the
// machine", which is what 'system' already does.
//
// These run against the real `createSuperAdminApp` rather than a re-creation of
// its ordering, because the ordering IS the thing under test.

const Root = defineComponent({ render: () => h('div') });

/**
 * Makes the machine report a dark preference for the duration of a case.
 *
 * jsdom ships no `matchMedia`, so without this the theme resolves 'system' to
 * light and the case that says "on a dark-preferring system" would pass for the
 * wrong reason — it is the whole condition of the finding.
 */
function prefersDark() {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: query.includes('dark'),
            addEventListener: () => {},
            removeEventListener: () => {},
        }),
    });
    return () => {
        if (original) Object.defineProperty(window, 'matchMedia', original);
        else delete (window as unknown as Record<string, unknown>).matchMedia;
    };
}

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

    test("Quasar's configured LIGHT mode survives a dark machine", () => {
        // The mirror of the case above, and the one the first fix missed: an
        // app that says `dark: false` on a dark-preferring machine had 'system'
        // resolve to dark and the bridge turn Quasar dark anyway.
        const restore = prefersDark();
        try {
            const handle = bootstrap({
                quasarOptions: { plugins: {}, config: { dark: false } },
            });

            expect(handle.theme.scheme.value).toBe('light');
            expect(Dark.isActive, 'the bridge overrode an explicit light config').toBe(false);
            expect(document.documentElement.getAttribute('data-sa-theme')).toBe('light');
            handle.dispose();
        } finally {
            restore();
        }
    });

    test("the machine still decides when Quasar says 'auto'", () => {
        const restore = prefersDark();
        try {
            const handle = bootstrap({
                quasarOptions: { plugins: {}, config: { dark: 'auto' } },
            });

            expect(handle.theme.scheme.value).toBe('system');
            expect(handle.theme.resolved.value).toBe('dark');
            handle.dispose();
        } finally {
            restore();
        }
    });

    test("Quasar's 'auto' stays 'system' rather than freezing", () => {
        // `'auto'` and 'system' say the same thing. Reading `Dark.isActive`
        // instead of the option would have pinned whatever the machine happened
        // to report at boot, and stopped following it afterwards.
        const handle = bootstrap({
            quasarOptions: { plugins: {}, config: { dark: 'auto' } },
        });

        expect(handle.theme.scheme.value).toBe('system');
        handle.dispose();
    });

    test('with no dark configuration at all, the theme is left on system', () => {
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
