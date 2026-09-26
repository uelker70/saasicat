// The tenant detail shows the charges of the tenant's subscriber, where the
// platform serves them.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown — whose account it is, each charge in the order served, and the
// empty and failed states.

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'northwind', name: 'Northwind', isActive: true, users: [] };

const charge = (overrides: Record<string, unknown>) => ({
    id: 'c-1',
    subscriberId: 's-1',
    tenantId: 't-1',
    subscriptionId: 'sub-1',
    contractId: 'k-1',
    contractLineItemId: 'l-1',
    origin: 'renewal',
    source: 'plan',
    sourceRef: 'sub-1',
    periodStart: '2026-02-01T00:00:00.000Z',
    periodEnd: '2026-03-01T00:00:00.000Z',
    currency: 'EUR',
    amountNet: 49,
    bookedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
});

const ACCOUNT = {
    holder: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    entries: [
        { charge: charge({}), title: 'Standard' },
        {
            charge: charge({ id: 'c-2', source: 'discount', amountNet: -9.8 }),
            title: 'Welcome 20 %',
        },
        {
            charge: charge({
                id: 'c-3',
                origin: 'activation',
                periodStart: '2026-01-01T00:00:00.000Z',
                periodEnd: '2026-02-01T00:00:00.000Z',
                bookedAt: '2026-01-01T00:00:00.000Z',
            }),
            title: null,
        },
    ],
};

const SERVING = { capabilities: { 'charges.read': true } };

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
    optionsManifest = undefined as unknown,
    charges = async (): Promise<unknown> => ACCOUNT,
} = {}) {
    const asked: string[] = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/admin/tenants/:slug',
                component: TenantDetailPage,
                props: optionsManifest ? { options: { manifest: optionsManifest } } : undefined,
            },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/northwind');
    await router.isReady();
    const wrapper = mountWithQuasar({ template: '<router-view />' } as never, {
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    tenants: {
                        detail: async () => TENANT,
                        charges: async (slug: string) => {
                            asked.push(slug);
                            return charges();
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

/** The rows of the charges table, cell by cell. */
function chargeRows(wrapper: Mounted): string[][] {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === 'Charges');
    expect(section, 'no charges section').toBeTruthy();
    return (section?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td').map((cell) => cell.text()),
    );
}

describe("the tenant detail shows the subscriber's account", () => {
    test('whose account it is, and each charge in the order the platform serves them', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toEqual(['northwind']);
        expect(wrapper.text()).toContain('Account of K-10001 · Northwind GmbH');
        expect(chargeRows(wrapper)).toEqual([
            ['2026-02-01', '2026-02-01 – 2026-03-01', 'Standard', 'Plan', 'Renewal', '€49'],
            [
                '2026-02-01',
                '2026-02-01 – 2026-03-01',
                'Welcome 20 %',
                'Discount',
                'Renewal',
                '-€9.80',
            ],
            ['2026-01-01', '2026-01-01 – 2026-02-01', 'Plan', 'Plan', 'Activation', '€49'],
        ]);
    });

    test('an amount is shown in the currency it was charged in', async () => {
        const { wrapper } = await mountPage({
            charges: async () => ({
                holder: ACCOUNT.holder,
                entries: [
                    { charge: charge({ currency: 'CHF', amountNet: 10 }), title: 'Standard' },
                ],
            }),
        });

        // Intl puts a no-break space between the code and the figure.
        expect(chargeRows(wrapper)[0].at(-1)).toMatch(/^CHF\s10$/);
    });

    test('a tenant without a subscriber says so', async () => {
        const { wrapper } = await mountPage({
            charges: async () => ({ holder: null, entries: [] }),
        });

        expect(wrapper.text()).toContain('No customer is on record for this tenant.');
        expect(wrapper.text()).toContain('No charges yet.');
    });

    test('a read that fails says so, and a retry asks again', async () => {
        let attempts = 0;
        const { wrapper, asked } = await mountPage({
            charges: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('offline');
                return ACCOUNT;
            },
        });

        expect(wrapper.text()).toContain('The charges could not be loaded.');
        const retry = wrapper.findAll('button').find((button) => /retry/i.test(button.text()));
        expect(retry, 'no retry button').toBeTruthy();
        await retry?.trigger('click');
        await settle();

        expect(asked).toEqual(['northwind', 'northwind']);
        expect(wrapper.text()).not.toContain('The charges could not be loaded.');
        expect(wrapper.text()).toContain('Account of K-10001 · Northwind GmbH');
    });

    test('without the capability, nothing is asked and no section is shown', async () => {
        const { wrapper, asked } = await mountPage({ manifest: { capabilities: {} } });

        expect(asked).toEqual([]);
        expect(wrapper.text()).not.toContain('Charges');
    });

    test('a manifest the app passes in its options is the one asked', async () => {
        const { wrapper, asked } = await mountPage({
            manifest: { capabilities: {} },
            optionsManifest: SERVING,
        });

        expect(asked).toEqual(['northwind']);
        expect(wrapper.text()).toContain('Account of K-10001 · Northwind GmbH');
    });
});
