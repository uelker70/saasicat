// The tenant detail shows whom the tenant's contracts are concluded with, and
// where a tax adapter decides, what holds the next one back.
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

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

/** The subscriber section, as label → value. */
function shownDetails(wrapper: Mounted): Record<string, string> {
    return Object.fromEntries(
        wrapper
            .findAll('.kv')
            .map((block) => [block.find('.kv__label').text(), block.find('.kv__value').text()]),
    );
}

describe("the tenant detail shows the tenant's subscriber", () => {
    test('whom the contracts are concluded with, and nothing held back', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toEqual(['wien']);
        expect(wrapper.text()).toContain('K-10001 · Wien GmbH');
        expect(shownDetails(wrapper)).toMatchObject({
            'Customer number': 'K-10001',
            'Name on the contract': 'Wien GmbH',
            'Billing address': 'Ringstraße 1, 1010 Wien',
            Country: 'AT',
            'Acts as': 'Business',
            'VAT ID': 'ATU12345678 (validated)',
            'Tax number': 'not stated',
            Origin: 'Entered at sign-up',
        });
        expect(wrapper.text()).not.toContain('cannot be concluded');
    });

    test('a warning names each reason the next contract is held back', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => ({
                subscriber: {
                    ...SUBSCRIBER,
                    postalCode: null,
                    city: null,
                    business: false,
                    vatIdValidated: false,
                    migrated: true,
                },
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
        expect(shownDetails(wrapper)).toMatchObject({
            'Billing address': 'Ringstraße 1',
            'Acts as': 'Consumer',
            'VAT ID': 'ATU12345678 (not validated)',
            Origin: "Taken over from the tenant's record",
        });
    });

    test('without a tax adapter there is no standing, and no warning', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => ({
                subscriber: { ...SUBSCRIBER, business: null, vatId: null },
                readiness: null,
            }),
        });

        expect(wrapper.find('.sa-banner--warning').exists()).toBe(false);
        expect(shownDetails(wrapper)).toMatchObject({
            'Acts as': 'not stated',
            'VAT ID': 'not stated',
        });
    });

    test('a tenant without a subscriber says so', async () => {
        const { wrapper } = await mountPage({
            subscriber: async () => ({ subscriber: null, readiness: null }),
        });

        expect(wrapper.text()).toContain('No subscriber is on record for this tenant.');
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
