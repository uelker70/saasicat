// The half of `useResourceList` that only a compiler can check.
//
// The runtime suite (`tests/use-resource-list.test.js`) proves what goes on the
// wire and what comes back. It cannot prove the thing the composable exists
// for: that a page gets its rows already typed, without an assertion and
// without naming an endpoint. That is a claim about types, so the assertions
// here are the compiler's — `vue-tsc -p tsconfig.tests.json`, which CI runs as
// `pnpm -r typecheck`, is what executes them.
//
// The `@ts-expect-error` lines are the guard, not decoration: each one fails
// the typecheck the day the call it marks starts compiling.

import type { TenantDto } from '@saasicat/types';
import { createApp } from 'vue';
import { describe, expect, it } from 'vitest';

import {
    SUPER_ADMIN_RESOURCES_KEY,
    createResourceRegistry,
    platformResources,
    useResourceList,
} from '../../src/index.js';
import type { HttpClient } from '../../src/client/types.js';

const CTX = { apiBase: '/api/v1/admin', projectKey: 'demo', locale: 'en' };

const oneTenant: HttpClient = () =>
    Promise.resolve({
        status: 200,
        headers: { get: () => null },
        json: async () => [
            { id: 't1', slug: 'demo', name: 'Demo', isActive: true, deletedAt: null },
        ],
        text: async () => '[]',
    });

function inShell<T>(run: () => T): T {
    const app = createApp({});
    app.provide(
        SUPER_ADMIN_RESOURCES_KEY,
        createResourceRegistry({ http: oneTenant, context: CTX, resources: platformResources }),
    );
    return app.runWithContext(run);
}

/**
 * Compiled, never called: the calls the type system has to refuse.
 *
 * They would each fail at runtime in a different, later way — `plans.list`
 * answers with a bare `PlanRow[]`, so `items` would simply be `undefined` on
 * screen — which is why the refusal belongs to the compiler.
 */
function refusals(): void {
    // @ts-expect-error `plans` has no operation answering with a page of rows.
    useResourceList('plans');
    // @ts-expect-error neither has `planVersions`.
    useResourceList('planVersions');
    // @ts-expect-error there is no resource under that name.
    useResourceList('tenant');
    // @ts-expect-error `tenants` offers no operation called `search`.
    useResourceList('tenants', { op: 'search' });
}

describe('useResourceList — the typed surface', () => {
    it('hands a page its rows already typed, with no assertion at the call site', async () => {
        const list = inShell(() => useResourceList('tenants', { immediate: false }));
        await list.reload();

        // The annotation is the assertion: this line stops compiling if the row
        // type ever collapses to `never` or widens to `unknown`.
        const first: TenantDto | undefined = list.items.value[0];
        expect(first?.slug).toBe('demo');
    });

    it('refuses the resources and operations that cannot answer with a page', () => {
        expect(refusals).toBeTypeOf('function');
    });
});
