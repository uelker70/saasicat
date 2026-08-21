// A declared `getAuthToken` prop has to end up on the wire.
//
// `DashboardPage` declared it, documented it as "token provider (when the
// HttpClient default fetch is used)" — and then never read it. Removing the
// page's bare `fetch()` had taken the Authorization header with it. An app that
// mounts the page the documented way, with `getAuthToken` and no `http` of its
// own, sent every KPI request unauthenticated and rendered an error in all of
// its cards.
//
// Nothing caught it because the prop's existence was never tied to its effect.
// This test ties them: for every standard page that declares the prop, it
// asserts the header reaches the client.

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import DashboardPage from '../src/pages/DashboardPage.vue';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const PAGES_DIR = resolve(process.cwd(), 'src', 'pages');

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

describe('DashboardPage getAuthToken', () => {
    test('sends the token it was handed', async () => {
        const { calls, http } = recordingHttp();

        const wrapper = mountWithQuasar(DashboardPage, {
            props: {
                manifest: MANIFEST,
                http,
                getAuthToken: () => 'the-token',
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(calls.length, 'the KPI card never issued a request').toBeGreaterThan(0);
        expect(
            calls.every((c) => c.headers.Authorization === 'Bearer the-token'),
            'a KPI request went out without the Authorization header',
        ).toBe(true);

        wrapper.unmount();
    });

    test('sends no Authorization header when there is no token', async () => {
        const { calls, http } = recordingHttp();

        const wrapper = mountWithQuasar(DashboardPage, {
            props: { manifest: MANIFEST, http, getAuthToken: () => null },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(calls.every((c) => c.headers.Authorization === undefined)).toBe(true);
        wrapper.unmount();
    });
});

describe('every page that declares getAuthToken', () => {
    /**
     * The roster is derived from the source, not hand-maintained.
     *
     * A page that adds the prop without using it is exactly the defect this
     * file exists for, so the check has to find such a page by itself rather
     * than wait for someone to remember to list it here.
     */
    test('reads it somewhere, rather than only declaring it', () => {
        const offenders: string[] = [];

        for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.vue'))) {
            const source = readFileSync(resolve(PAGES_DIR, file), 'utf8');
            if (!source.includes('getAuthToken')) continue;

            // One occurrence is the prop declaration alone: declared, documented,
            // never read.
            const uses = source.split('getAuthToken').length - 1;
            if (uses < 2) offenders.push(file);
        }

        expect(offenders, 'these pages declare getAuthToken and never read it').toEqual([]);
    });
});
