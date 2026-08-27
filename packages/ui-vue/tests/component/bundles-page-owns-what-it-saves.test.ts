// The bundles page owns its rows and its version map; the resource is
// stateless. Whatever a mutation returns has to be written back, or the page
// keeps showing — and the next form keeps being built from — what was there
// before the save. Same class as the discovery page's translations.

import { afterEach, describe, expect, test } from 'vitest';

import BundlesPage from '../../src/pages/BundlesPage.vue';
import {
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_HTTP_KEY,
} from '../../src/vue/super-admin-context.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const BUNDLE = {
    id: 'b-1',
    bundleKey: 'extra',
    label: 'Extra',
    description: null,
    icon: null,
    sortOrder: 0,
    i18n: {},
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    deletedAt: null,
};

const version = (id: string, publishedAt: string | null) => ({
    id,
    bundleId: 'b-1',
    bundleKey: 'extra',
    label: 'Extra',
    version: id === 'v-1' ? 1 : 2,
    baseVersionId: null,
    publishedAt,
    supersededAt: null,
    publishedChanges: null,
    changeNote: '',
    nonRegressive: true,
    validFrom: null,
    validUntil: null,
    features: ['export'],
    quotas: {},
    compatibility: {},
    pricingOverrides: [],
    monthlyNet: '9.00',
    yearlyNet: null,
    marketed: true,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
});

const PLAN = { id: 'p-1', planKey: 'PRO', label: 'Pro', description: null, sortOrder: 1 };

const LIVE_PLAN_VERSION = {
    id: 'pv-1',
    planId: 'PRO',
    version: 1,
    baseVersionId: null,
    features: ['export'],
    bundles: [],
    quotas: { notes: 100 },
    monthlyNet: '10.00',
    yearlyNet: '100.00',
    marketed: true,
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'v1',
    nonRegressive: true,
    validFrom: null,
    validUntil: null,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

type Page = {
    bundles: Array<typeof BUNDLE>;
    livePlanVersions: Record<string, { id: string } | null>;
    editForm: { label: string };
    toggle: (b: typeof BUNDLE) => Promise<void>;
    submitEdit: () => Promise<void>;
    onInlineSave: (bundleId: string, versionId: string, data: unknown) => Promise<void>;
    versionsOf: (bundleId: string) => unknown[];
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

function mountPage() {
    let versions = [version('v-1', '2026-01-01T00:00:00.000Z')];
    const wrapper = mountWithQuasar(BundlesPage as never, {
        global: {
            provide: {
                // What the shell provides app-wide; the page reads the endpoints
                // for its bulk-publish link.
                [SUPER_ADMIN_BRAND_KEY as symbol]: { tag: 'SuperAdmin', name: 'T', logoText: 'T' },
                [SUPER_ADMIN_ENDPOINTS_KEY as symbol]: {
                    apiBase: '/api/admin',
                    publicBootEndpoint: '/api/admin/boot',
                    manifestEndpoint: '/api/admin/manifest',
                },
                [SUPER_ADMIN_HTTP_KEY as symbol]: async () => ({
                    status: 200,
                    headers: { get: () => null },
                    json: async () => ({}),
                    text: async () => '',
                }),
                ...provideStubResources({
                    bundles: {
                        list: async () => [BUNDLE],
                        update: async (_id: string, data: { label: string }) => ({
                            ...BUNDLE,
                            label: data.label,
                        }),
                        softDelete: async () => undefined,
                        create: async () => BUNDLE,
                    },
                    bundleVersions: {
                        listForBundle: async () => versions,
                        updateDraft: async () => {
                            // What a save does on the server: the list has one more.
                            versions = [...versions, version('v-2', null)];
                            return { warnings: [] };
                        },
                    },
                    catalog: { features: async () => [], quotas: async () => [] },
                    plans: { list: async () => [PLAN] },
                    planVersions: { listForPlan: async () => [LIVE_PLAN_VERSION] },
                    discovery: { read: async () => ({ status: 'unchanged' }) },
                } as never),
            },
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('BundlesPage loads the live plan versions the overlap check reads', () => {
    test('each plan maps to its live version', async () => {
        const wrapper = mountPage();
        await settle();
        const page = wrapper.vm as unknown as Page;
        // `{}` here is the 4.10 regression: the wrapper used to fill this map,
        // and an empty one turns the Plan↔Bundle overlap warning off silently.
        expect(page.livePlanVersions.PRO?.id).toBe('pv-1');
    });
});

describe('BundlesPage writes back what a mutation returns', () => {
    test('an edited label shows in the row the page owns', async () => {
        const wrapper = mountPage();
        await settle();
        const page = wrapper.vm as unknown as Page;
        expect(page.bundles[0]?.label).toBe('Extra');

        await page.toggle(BUNDLE);
        page.editForm.label = 'Extra Plus';
        await page.submitEdit();
        await settle();

        // Before the fix this stayed 'Extra': the response was discarded, and
        // reopening the pane rebuilt the form from the stale row.
        expect(page.bundles[0]?.label).toBe('Extra Plus');
    });

    test('a saved version reaches the aggregate map the KPIs read', async () => {
        const wrapper = mountPage();
        await settle();
        const page = wrapper.vm as unknown as Page;
        await page.toggle(BUNDLE);
        await settle();
        expect(page.versionsOf('b-1')).toHaveLength(1);

        await page.onInlineSave('b-1', 'v-1', {});
        await settle();

        // `versionsOf` prefers the map; only the pane used to be refreshed.
        expect(page.versionsOf('b-1')).toHaveLength(2);
    });
});
