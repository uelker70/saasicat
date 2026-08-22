// Two locale edits on one catalog entry, saved one after the other.
//
// A locale save sends the WHOLE `i18n` object of the entry, assembled from the
// page's row. If the row is never updated with what the server answered, the
// second save is assembled from the row as it was before the first — and sends
// the first edit's absence, which the server takes as a deletion.

import { afterEach, describe, expect, test } from 'vitest';

import DiscoveryPage from '../../src/pages/DiscoveryPage.vue';
import { mountWithQuasar } from './support/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const FEATURE = {
    id: 'f-1',
    projectKey: 'notesapp',
    featureKey: 'EXPORT',
    label: 'Export',
    description: null,
    marketingLabel: null,
    marketingDescription: null,
    icon: null,
    tier: null,
    discoveryStatus: 'approved',
    requires: [],
    replaces: [],
    successorKey: null,
    approvedAt: null,
    approvedBy: null,
    approvedSignature: null,
    plannedOnly: false,
    core: false,
    i18n: {},
    sortOrder: 0,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    deletedAt: null,
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

describe('DiscoveryPage carries a saved translation into the next save', () => {
    test('the second payload still holds the first edit', async () => {
        const payloads: Array<Record<string, Record<string, string>>> = [];
        const wrapper = mountWithQuasar(DiscoveryPage as never, {
            props: { activeLocales: ['en'] },
            global: {
                provide: provideStubResources({
                    catalog: {
                        capabilities: async () => [],
                        features: async () => [FEATURE],
                        quotas: async () => [],
                        syncDiscovery: async () => ({}),
                        reviewFeature: async () => ({}),
                        reviewQuota: async () => ({}),
                        setQuotaI18n: async () => ({}),
                        setFeatureBase: async () => ({}),
                        setQuotaBase: async () => ({}),
                        setFeatureI18n: async (
                            key: string,
                            i18n: Record<string, Record<string, string>>,
                        ) => {
                            payloads.push(i18n);
                            // What the server does: the row, with the i18n it now holds.
                            return { ...FEATURE, featureKey: key, i18n };
                        },
                    },
                    discovery: {
                        read: async () => ({ status: 'loaded', snapshot: {}, etag: null }),
                        rescan: async () => ({ snapshot: {}, etag: null }),
                    },
                } as never),
            },
        });
        mounted.push(wrapper);
        await settle();

        const page = wrapper.vm as unknown as {
            onFeatureLocale: (key: string, locale: string, patch: Record<string, string>) => void;
        };

        page.onFeatureLocale('EXPORT', 'en', { label: 'Exportieren' });
        await settle();
        expect(payloads).toHaveLength(1);
        expect(payloads[0]?.en).toEqual({ label: 'Exportieren' });

        page.onFeatureLocale('EXPORT', 'en', { description: 'Daten exportieren' });
        await settle();
        expect(payloads).toHaveLength(2);
        // Without the write-back this is `{ description }` alone, and the label
        // the operator just saved is gone on the server.
        expect(payloads[1]?.en).toEqual({ label: 'Exportieren', description: 'Daten exportieren' });
    });
});

/** Past the page's 500 ms save debounce, with the response applied. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 650));
    await new Promise((resolve) => setTimeout(resolve, 0));
}
