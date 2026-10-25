// The tenant detail shows whom the tenant's contracts are concluded with, where
// a tax adapter decides what holds the next one back, and the way into the
// subscriber's record.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown.

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: true, users: [] };

const SUBSCRIBER = {
    id: 's-1',
    customerNumber: 'K-10001',
    legalName: 'Wien GmbH',
    addressLine1: 'Ringstraße 1',
    addressLine2: null,
    postalCode: '1010',
    city: 'Wien',
    country: 'AT',
    business: true,
    vatId: 'ATU12345678',
    vatIdValidated: true,
    taxNumber: null,
    invoiceEmail: null,
    migrated: false,
};
const READY = { ready: true, missing: [], taxRefusal: null };

const SERVING = { capabilities: { 'subscribers.read': true } };

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountPage({
    manifest = SERVING as unknown,
    subscriber = async (): Promise<unknown> => ({ subscriber: SUBSCRIBER, readiness: READY }),
} = {}) {
    const asked: string[] = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    const wrapper = mountWithQuasar({ template: '<router-view />' } as never, {
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    tenants: {
                        detail: async () => TENANT,
                        subscriber: async (slug: string) => {
                            asked.push(slug);
                            return subscriber();
                        },
                    },
                } as never),
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => manifest,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked };
}

describe("the tenant detail shows the tenant's subscriber", () => {
    test('whom the contracts are concluded with, and the way into its record', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toEqual(['wien']);
        expect(wrapper.text()).toContain('K-10001 · Wien GmbH');
        const open = wrapper
            .findAll('a')
            .find((link) => link.text().includes('Open the subscriber record'));
        expect(open, 'no way into the record').toBeTruthy();
        expect(open?.attributes('href')).toBe('/admin/subscribers/s-1');
        expect(wrapper.text()).not.toContain('cannot be concluded');
        // The subscriber's master data is the record's, not the card's.
        expect(wrapper.text()).not.toContain('Name on the contract');
    });

    test('a warning names each reason the next contract is held back', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => ({
                subscriber: { ...SUBSCRIBER, postalCode: null, city: null },
                readiness: {
                    ready: false,
                    missing: ['postalCode', 'city'],
                    taxRefusal: 'A consumer outside Germany is not supported.',
                },
            }),
        });

        const banner = wrapper.find('.sa-banner--warning');
        expect(banner.exists(), 'no warning').toBe(true);
        expect(banner.text()).toContain('The next contract cannot be concluded like this.');
        expect(banner.findAll('li').map((item) => item.text())).toEqual([
            'The billing address lacks: Postal code, City.',
            'The tax adapter does not treat this case: A consumer outside Germany is not supported.',
        ]);
    });

    test('a tenant without a subscriber says so, and offers no record', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => ({ subscriber: null, readiness: null }),
        });

        expect(wrapper.text()).toContain('No subscriber is on record for this tenant.');
        expect(wrapper.text()).not.toContain('Open the subscriber record');
    });

    test('a read that fails says so', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => {
                throw new Error('offline');
            },
        });

        expect(wrapper.text()).toContain('The subscriber could not be loaded.');
    });

    test('without the capability, nothing is asked and no section is shown', async () => {
        const { wrapper, asked } = await mountPage({ manifest: { capabilities: {} } });

        expect(asked).toEqual([]);
        expect(wrapper.text()).not.toContain('Subscriber');
    });
});
