// The plans and bundles pages ask for the second factor before a lasting
// action, and nothing leaves the page until the code is there.
//
// The routes refuse the request without the code, so a page that did not ask
// would not be less safe — it would be broken: every publish, end and purge
// would fail with a 401 the operator has no way to answer. Mounted rather than
// read, because what is in question is the order of two awaits inside a page.

// @requirement SC-SEC-013 — The platform's own routes with lasting consequences check the second factor themselves

import { afterEach, describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { AdminError } from '../../src/client/admin-error.js';
import { MFA_CODE_HEADER } from '../../src/client/mfa-header.js';
import BundlesPage from '../../src/pages/BundlesPage.vue';
import PlansPage from '../../src/pages/PlansPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { usePlanVersions } from '../../src/vue/use-plans.js';
import type { MfaPrompt } from '../../src/vue/use-mfa-prompt.js';
import {
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_HTTP_KEY,
} from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const CODE = '123456';
const API = '/api/admin';

interface Sent {
    url: string;
    method: string;
    headers: Record<string, string>;
}

/** Answers every read with an empty list and records every write. */
function recordingHttp() {
    const writes: Sent[] = [];
    const http = async (
        url: string,
        init?: { method?: string; headers?: Record<string, string> },
    ) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') writes.push({ url, method, headers: init?.headers ?? {} });
        return {
            status: method === 'DELETE' ? 204 : 200,
            headers: { get: () => null },
            json: async () => (method === 'GET' ? [] : { id: 'v-2', version: 2 }),
            text: async () => '',
        };
    };
    return { http, writes };
}

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

function shell(http: unknown) {
    return {
        [SUPER_ADMIN_BRAND_KEY as symbol]: { tag: 'SuperAdmin', name: 'T', logoText: 'T' },
        [SUPER_ADMIN_ENDPOINTS_KEY as symbol]: {
            apiBase: API,
            publicBootEndpoint: `${API}/boot`,
            manifestEndpoint: `${API}/manifest`,
        },
        [SUPER_ADMIN_HTTP_KEY as symbol]: http,
    };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const DRAFT = {
    id: 'v-2',
    bundleId: 'b-1',
    bundleKey: 'extra',
    version: 2,
    publishedAt: null,
    supersededAt: null,
};

describe('BundlesPage asks for the code before it publishes', () => {
    type Page = {
        publishDraft: typeof DRAFT | null;
        onPublishSubmit: (opts: { forceRegressive: boolean }) => Promise<unknown>;
        mfa: MfaPrompt;
    };

    function mountPage(publish: (id: string, opts: unknown, code?: string) => Promise<unknown>) {
        const wrapper = mountWithQuasar(BundlesPage as never, {
            global: {
                provide: {
                    ...shell(recordingHttp().http),
                    ...provideStubResources({
                        bundles: { list: async () => [] },
                        bundleVersions: { listForBundle: async () => [], publish },
                        catalog: { features: async () => [], quotas: async () => [] },
                        plans: { list: async () => [] },
                        planVersions: { listForPlan: async () => [] },
                        discovery: { read: async () => ({ status: 'unchanged' }) },
                    } as never),
                },
            },
        });
        mounted.push(wrapper);
        const page = wrapper.vm as unknown as Page;
        page.publishDraft = DRAFT;
        return page;
    }

    test('nothing is published until the code is entered, and the code goes with it', async () => {
        const calls: Array<string | undefined> = [];
        const page = mountPage(async (_id, _opts, code) => {
            calls.push(code);
            return { bundleVersion: DRAFT, warnings: [] };
        });
        await settle();

        const result = page.onPublishSubmit({ forceRegressive: false });
        await settle();
        expect(calls).toEqual([]);
        expect(page.mfa.show.value).toBe(true);

        page.mfa.onConfirm(CODE);
        expect(await result).toEqual({ bundleVersion: DRAFT, warnings: [] });
        expect(calls).toEqual([CODE]);
    });

    test('cancelling publishes nothing and answers null, which keeps the publish dialog open', async () => {
        const calls: Array<string | undefined> = [];
        const page = mountPage(async (_id, _opts, code) => {
            calls.push(code);
            return {};
        });
        await settle();

        const result = page.onPublishSubmit({ forceRegressive: false });
        await settle();
        page.mfa.onVisibility(false);

        expect(await result).toBeNull();
        expect(calls).toEqual([]);
    });

    test('a refused code asks again and says why', async () => {
        const calls: Array<string | undefined> = [];
        const page = mountPage(async (_id, _opts, code) => {
            calls.push(code);
            if (code !== CODE) throw new AdminError({ message: 'refused', status: 401 });
            return { bundleVersion: DRAFT, warnings: [] };
        });
        await settle();

        const result = page.onPublishSubmit({ forceRegressive: false });
        await settle();
        page.mfa.onConfirm('000000');
        await settle();
        expect(page.mfa.show.value).toBe(true);
        expect(page.mfa.error.value).not.toBe('');

        page.mfa.onConfirm(CODE);
        await result;
        expect(calls).toEqual(['000000', CODE]);
    });
});

describe('PlansPage asks for the code before it purges, ends or publishes', () => {
    const PLAN = { id: 'p-1', planKey: 'PRO', label: 'Pro', description: null, sortOrder: 1 };
    const LIVE = { id: 'v-1', planId: 'p-1', version: 1, publishedAt: '2026-01-01T00:00:00.000Z' };

    type Page = {
        archiveTarget: { plan: typeof PLAN; hasLive: boolean } | null;
        archiveError: string | null;
        executeArchive: () => Promise<void>;
        planVersions: unknown;
        onSubmitTerminate: (versionId: string, endsAt: string) => Promise<boolean>;
        publishTarget: typeof LIVE | null;
        executePublish: () => Promise<void>;
        mfa: MfaPrompt;
    };

    async function mountPage() {
        const { http, writes } = recordingHttp();
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/admin/plans', component: { template: '<div />' } }],
        });
        await router.push('/admin/plans');
        const wrapper = mountWithQuasar(PlansPage as never, {
            global: {
                plugins: [router],
                provide: {
                    ...shell(http),
                    ...provideStubResources({ audit: { list: async () => [] } } as never),
                },
            },
        });
        mounted.push(wrapper);
        await settle();
        const page = wrapper.vm as unknown as Page;
        page.planVersions = usePlanVersions({ adminEndpoint: API, planId: PLAN.id, http });
        return { page, writes };
    }

    const purge = (w: Sent) => w.method === 'DELETE' && w.url === `${API}/catalog/plans/p-1/purge`;

    test('purging sends nothing before the code, then the code', async () => {
        const { page, writes } = await mountPage();
        page.archiveTarget = { plan: PLAN, hasLive: false };

        const done = page.executeArchive();
        await settle();
        expect(writes.filter(purge)).toEqual([]);

        page.mfa.onConfirm(CODE);
        await done;
        expect(writes.filter(purge).map((w) => w.headers[MFA_CODE_HEADER])).toEqual([CODE]);
    });

    test('a cancelled purge sends nothing and shows no error', async () => {
        const { page, writes } = await mountPage();
        page.archiveTarget = { plan: PLAN, hasLive: false };

        const done = page.executeArchive();
        await settle();
        page.mfa.onVisibility(false);
        await done;

        expect(writes.filter(purge)).toEqual([]);
        expect(page.archiveError).toBeNull();
    });

    test('ending a live version waits for the code, and a cancel answers false', async () => {
        const { page, writes } = await mountPage();
        const terminate = (w: Sent) => w.url === `${API}/catalog/plan-versions/v-1/terminate`;

        const cancelled = page.onSubmitTerminate('v-1', '2027-01-01T23:59:59.000Z');
        await settle();
        page.mfa.onVisibility(false);
        expect(await cancelled).toBe(false);
        expect(writes.filter(terminate)).toEqual([]);

        const confirmed = page.onSubmitTerminate('v-1', '2027-01-01T23:59:59.000Z');
        await settle();
        page.mfa.onConfirm(CODE);
        expect(await confirmed).toBe(true);
        expect(writes.filter(terminate).map((w) => w.headers[MFA_CODE_HEADER])).toEqual([CODE]);
    });

    test('publishing from the dialog carries the code', async () => {
        const { page, writes } = await mountPage();
        const publish = (w: Sent) => w.url === `${API}/catalog/plan-versions/v-1/publish`;
        page.publishTarget = LIVE;

        const done = page.executePublish();
        await settle();
        expect(writes.filter(publish)).toEqual([]);
        page.mfa.onConfirm(CODE);
        await done;
        expect(writes.filter(publish).map((w) => w.headers[MFA_CODE_HEADER])).toEqual([CODE]);
    });
});
