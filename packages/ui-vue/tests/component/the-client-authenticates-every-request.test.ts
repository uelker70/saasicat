// The app's client authenticates every request a page issues.
//
// `DashboardPage` used to declare a `getAuthToken` prop, document it as "token
// provider (when the HttpClient default fetch is used)" — and never read it. An
// app that mounted the page the documented way sent every KPI request
// unauthenticated and rendered an error in all of its cards. Nothing caught it
// because the prop's existence was never tied to its effect.
//
// The prop is gone: the client carries the auth and is the only thing that
// does. The property this file guards did not change with it — a mounted page
// must issue authenticated requests — but the seam did, and it is now one seam
// instead of two. What is left to get wrong is a page that builds its own
// request instead of going through the client it was handed, which is what the
// second test below would catch.

// @requirement SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session
// @requirement SC-SEC-004 — Every decision that matters is made where the request is served

import { describe, expect, test } from 'vitest';

import DashboardPage from '../../src/pages/DashboardPage.vue';
import {
    SUPER_ADMIN_RESOURCES_KEY,
    createResourceRegistry,
    platformResources,
} from '../../src/index.js';
import { authenticating } from '../support/authenticating-client.mjs';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

/** The page reaches the network through the registry, so the fixture builds one. */
function shellWith(http: unknown): Record<symbol, unknown> {
    return {
        [SUPER_ADMIN_RESOURCES_KEY]: createResourceRegistry({
            http: http as never,
            context: CTX,
            resources: platformResources,
        }),
    };
}

/** Records what each request was given, and answers every endpoint. */
function recordingHttp() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const http = async (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: init?.headers ?? {} });
        return {
            status: 200,
            headers: { get: () => null },
            json: async () => ({ value: 42 }),
            text: async () => '',
        };
    };
    return { calls, http };
}

const MANIFEST = {
    schemaVersion: 1 as const,
    dashboard: {
        kpiCards: [
            {
                id: 'tenants',
                label: 'Tenants',
                endpoint: '/api/admin/dashboard/tenants',
                displayHint: { type: 'value' as const, icon: 'apartment' },
                slotPriority: 90,
            },
        ],
    },
};

describe('a mounted page issues authenticated requests', () => {
    test("every request carries the client's header", async () => {
        const { calls, http } = recordingHttp();

        const wrapper = mountWithQuasar(DashboardPage, {
            props: { manifest: MANIFEST },
            global: { provide: shellWith(authenticating(http, 'the-token')) },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(calls.length, 'the KPI card never issued a request').toBeGreaterThan(0);
        expect(
            calls.every((c) => c.headers.Authorization === 'Bearer the-token'),
            'a KPI request went out without the Authorization header',
        ).toBe(true);

        wrapper.unmount();
    });

    test('the page adds no header of its own to an unauthenticated client', async () => {
        const { calls, http } = recordingHttp();

        const wrapper = mountWithQuasar(DashboardPage, {
            props: { manifest: MANIFEST },
            global: { provide: shellWith(http) },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((c) => c.headers.Authorization === undefined)).toBe(true);
        wrapper.unmount();
    });
});
