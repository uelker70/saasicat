// The bootstrap must install the Quasar plugins the ports it hands out depend
// on, whatever the app configures.
//
// `createSuperAdminApp` provides `quasarConfirm` unconditionally, and that port
// calls `Dialog.create`. The options handling took the app's `quasarOptions`
// whole when one was given, so `{ plugins: {}, config: { dark: true } }` — a
// shape this package's own theme tests use — left `Dialog` uninstalled while
// the confirm port was still handed out. The first "are you sure" threw
// instead of asking, which turns a guarded action into a broken one rather
// than a stricter one.
//
// Checked through `resolveQuasarOptions` rather than by booting an app: a test
// that imports `Dialog` and calls `Dialog.create` passes whether or not the
// plugin was installed, because the import is the module singleton. That
// version of this test was written first and passed against the defect.

import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { Notify } from 'quasar';

import {
    createSuperAdminApp,
    resolveQuasarOptions,
} from '../../src/quasar/create-super-admin-app.js';
import { SUPER_ADMIN_RESOURCES_KEY } from '../../src/vue/resource-registry.js';

/** The plugins the shell's own ports call into. */
const REQUIRED = ['Notify', 'Dialog', 'Loading'];

describe('resolveQuasarOptions', () => {
    test('with no app options, the platform set is installed', () => {
        expect(Object.keys(resolveQuasarOptions().plugins ?? {}).sort()).toEqual(
            [...REQUIRED].sort(),
        );
    });

    test('an app configuring Quasar still gets every plugin the ports need', () => {
        // The exact shape that broke: plugins declared, and empty.
        const resolved = resolveQuasarOptions({ plugins: {}, config: { dark: true } });
        for (const plugin of REQUIRED) {
            expect(Object.keys(resolved.plugins ?? {})).toContain(plugin);
        }
    });

    test('the app’s own config is kept', () => {
        const resolved = resolveQuasarOptions({ plugins: {}, config: { dark: true } });
        expect((resolved.config as { dark?: unknown }).dark).toBe(true);
    });

    test('an app may replace a plugin with its own build', () => {
        const own = { ...Notify };
        const resolved = resolveQuasarOptions({ plugins: { Notify: own } });
        expect((resolved.plugins as Record<string, unknown>).Notify).toBe(own);
        // …without losing the others.
        expect(Object.keys(resolved.plugins ?? {})).toContain('Dialog');
    });

    test('an app that passes only a config keeps the whole platform set', () => {
        const resolved = resolveQuasarOptions({ config: { dark: 'auto' } });
        expect(Object.keys(resolved.plugins ?? {}).sort()).toEqual([...REQUIRED].sort());
    });
});

describe('the resource registry is installed only with a real client', () => {
    const Root = defineComponent({ setup: () => () => h('div') });

    function boot(extra: Record<string, unknown>) {
        return createSuperAdminApp({
            rootComponent: Root,
            brand: { name: 'Fixture', logoText: 'FX' },
            endpoints: { apiBase: '/api/v1/admin', projectKey: 'demo' },
            appRoutes: [{ path: '/:pathMatch(.*)*', component: Root }],
            theme: { persist: false },
            ...extra,
        } as never);
    }

    /** What the app provided under a key, without mounting anything. */
    function provided(app: ReturnType<typeof boot>['app'], key: symbol): unknown {
        return (app as unknown as { _context: { provides: Record<symbol, unknown> } })._context
            .provides[key];
    }

    test('an app that names its client gets a registry', () => {
        const { app } = boot({ http: async () => new Response('{}') });
        expect(provided(app, SUPER_ADMIN_RESOURCES_KEY)).toBeDefined();
    });

    test('an app that does not gets none, rather than one wired to a bare fetch', () => {
        // `createResourceRegistry` refuses to be built without a client,
        // because a bare fetch sends every request without the app's
        // Authorization header and the failure is silent — a 401, an em dash on
        // one card, nothing logged. Handing it the `defaultHttpClient()`
        // fallback here would have defeated that from inside the bootstrap.
        const { app } = boot({});
        expect(provided(app, SUPER_ADMIN_RESOURCES_KEY)).toBeUndefined();
    });
});
