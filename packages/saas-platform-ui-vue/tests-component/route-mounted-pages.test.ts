// A route-mounted page cannot have required props.
//
// `createAdminRoutes()` registers login, error page and layout as plain route
// records — `{ path, component }`, no `props:`. Vue Router passes nothing to
// such a component, so a prop declared as required is unsatisfiable by
// construction: Vue logs "Missing required prop" and the value is `undefined`
// wherever the template uses it.
//
// This bit in production. `AdminManifestErrorPage` declared `onRetry` and
// `onLogout` as required and wired them straight to two `@click` handlers. The
// page is the *fail-closed* screen — it renders precisely when the app is
// already broken — and both of its buttons called `undefined`. The operator
// got a dead end with two dead buttons.
//
// The instance is fixed. This test is here for the class: it mounts every
// route-mounted page with **no props at all** and fails on any Vue warning.

import { describe, expect, test, vi, afterEach } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AdminManifestErrorPage from '../src/pages-standard/AdminManifestErrorPage.vue';
import SuperAdminLoginPage from '../src/pages-standard/SuperAdminLoginPage.vue';
import {
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_HTTP_KEY,
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
} from '../src/vue/super-admin-context.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const SRC_DIR = resolve(process.cwd(), 'src');

/**
 * What `createSuperAdminApp()` provides app-wide, and nothing else.
 *
 * This is the whole point of the test: the shell reaches a route-mounted page
 * through `provide()`, never through props. Supplying the context here while
 * passing zero props reproduces exactly what the router does.
 */
const SHELL_CONTEXT = {
    [SUPER_ADMIN_BRAND_KEY as symbol]: { tag: 'SuperAdmin', name: 'Test', logoText: 'T' },
    [SUPER_ADMIN_ENDPOINTS_KEY as symbol]: {
        apiBase: '/api/admin',
        publicBootEndpoint: '/api/admin/boot',
        manifestEndpoint: '/api/admin/manifest',
    },
    [SUPER_ADMIN_LOGIN_ADAPTER_KEY as symbol]: { login: async () => undefined },
    [SUPER_ADMIN_HTTP_KEY as symbol]: async () => ({
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
    }),
};

/**
 * A real router, not a `$router` mock: the pages call `useRouter()`, which reads
 * from `provide()`. Mounting them without one is not a scenario that exists —
 * they are route components.
 */
function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/login', component: { template: '<div />' } },
            { path: '/admin-error', component: { template: '<div />' } },
        ],
    });
}

/**
 * Pages that `createAdminRoutes()` mounts as bare route records.
 *
 * Keep in sync with `src/vue/create-admin-routes.ts`. `AdminLayout` is not in
 * here: it is mounted the same way, but its props all carry defaults already
 * and it needs a router-view child to render at all.
 */
const ROUTE_MOUNTED = [
    { name: 'AdminManifestErrorPage.vue', component: AdminManifestErrorPage },
    { name: 'SuperAdminLoginPage.vue', component: SuperAdminLoginPage },
] as const;

/**
 * Reads the required props straight out of the SFC source.
 *
 * Deliberately source-based rather than runtime-based: a type-only
 * `defineProps<{...}>()` is compiled away, and reading the source is what makes
 * the failure message name the offending prop instead of just "something threw".
 */
function requiredPropsOf(file: string): string[] {
    const source = readFileSync(resolve(SRC_DIR, 'pages-standard', file), 'utf8');
    const block = /defineProps<\{([\s\S]*?)\n}>\(\)/.exec(source);
    if (!block) return [];

    const body = block[1]
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/\/\/[^\n]*/g, ''); // line comments

    // `name: T` is required, `name?: T` is not. Only top-level members count —
    // nested object literals are indented deeper.
    return [...body.matchAll(/^\s{4}(\w+)(\??):/gm)]
        .filter((match) => match[2] !== '?')
        .map((match) => match[1]);
}

describe('pages mounted by createAdminRoutes()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const { name, component } of ROUTE_MOUNTED) {
        test(`${name} declares no required props`, () => {
            expect(requiredPropsOf(name)).toEqual([]);
        });

        test(`${name} mounts with no props and without Vue warnings`, () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});

            const wrapper = mountWithQuasar(component, {
                global: {
                    provide: SHELL_CONTEXT,
                    plugins: [makeRouter()],
                },
            });

            const complaints = [...warn.mock.calls, ...error.mock.calls]
                .map((args) => String(args[0]))
                .filter((message) => message.includes('[Vue warn]'));

            expect(complaints, `${name} warned when mounted the way the router mounts it`).toEqual(
                [],
            );
            expect(wrapper.html().length).toBeGreaterThan(0);
            wrapper.unmount();
        });
    }

    test('the roster covers every page create-admin-routes mounts directly', () => {
        // If someone adds a fourth bare route record, this fails and points at
        // the roster above rather than letting the new page skip the check.
        const factory = readFileSync(resolve(SRC_DIR, 'vue', 'create-admin-routes.ts'), 'utf8');
        const componentSlots = [...factory.matchAll(/component:\s*options\.(\w+)/g)].map(
            (match) => match[1],
        );

        expect(new Set(componentSlots)).toEqual(
            new Set(['loginPage', 'adminErrorPage', 'adminLayout']),
        );
    });
});

describe('AdminManifestErrorPage retry', () => {
    /**
     * The retry has to leave this route to have any effect.
     *
     * `/admin-error` is `meta.public` — it must be, or the manifest guard would
     * redirect to itself. But that also means the guard returns early for it and
     * never calls `ensureLoaded()`. A reload in place therefore re-renders the
     * same error forever, including after the backend has come back: the button
     * looks like a way out and is a dead end.
     */
    test('boots into a guarded route rather than reloading the public error route', async () => {
        const assign = vi.fn();
        vi.spyOn(window, 'location', 'get').mockReturnValue({
            ...window.location,
            assign,
            reload: () => {
                throw new Error('reload() cannot re-run the manifest guard from a public route');
            },
        } as unknown as Location);

        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            global: { provide: SHELL_CONTEXT, plugins: [router] },
        });

        await wrapper.findAll('button')[0].trigger('click');

        expect(assign).toHaveBeenCalledTimes(1);
        const target = String(assign.mock.calls[0][0]);

        expect(target, 'retry must not land back on the fail-closed page').not.toContain(
            '/admin-error',
        );
        expect(publicPathsOfAdminRoutes(), 'retry target must run through the guard').not.toContain(
            target,
        );

        wrapper.unmount();
    });

    /**
     * Reads the `meta.public` route paths out of `create-admin-routes.ts`.
     *
     * Source-based on purpose: the point is that the retry target and the
     * public-route list cannot drift apart silently. Comparing against a
     * hardcoded list here would just move the drift into this file.
     */
    function publicPathsOfAdminRoutes(): string[] {
        const factory = readFileSync(resolve(SRC_DIR, 'vue', 'create-admin-routes.ts'), 'utf8');
        return [...factory.matchAll(/path:\s*'([^']+)'[\s\S]{0,220}?meta:\s*\{\s*public:\s*true/g)]
            .map((match) => match[1])
            .filter((path) => path.startsWith('/'));
    }
});

describe('AdminManifestErrorPage without callbacks', () => {
    test('its buttons are wired to handlers, never to a possibly-undefined prop', () => {
        // The original defect was `@click="onRetry"` with `onRetry` a required
        // prop: the template called the prop directly, so an unset prop meant
        // clicking did nothing at all. Handlers keep the fallback reachable.
        const source = readFileSync(
            resolve(SRC_DIR, 'pages-standard', 'AdminManifestErrorPage.vue'),
            'utf8',
        );

        expect(source).not.toMatch(/@click="on(Retry|Logout)"/);
        expect(source).toMatch(/@click="retry"/);
        expect(source).toMatch(/@click="logout"/);
    });
});
