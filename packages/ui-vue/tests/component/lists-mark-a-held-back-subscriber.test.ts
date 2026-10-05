// The tenant list and the subscription list mark a tenant whose subscriber is
// held back from its next contract — asked once per list, and only where the
// platform says a tax adapter decides.

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';

import SubscriptionsPage from '../../src/pages/SubscriptionsPage.vue';
import TenantsPage from '../../src/pages/TenantsPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const tenant = (id: string, name: string) => ({
    id,
    slug: id,
    name,
    isActive: true,
    deletedAt: null,
    plan: 'PRO',
});
const TENANTS = [
    tenant('t-1', 'Northwind'),
    tenant('t-2', 'Fabrikam'),
    tenant('t-3', 'Contoso'),
    tenant('t-4', 'Initech'),
];

const ATTENTION = [
    { tenantId: 't-2', readiness: { ready: false, missing: ['city'], taxRefusal: null } },
    {
        tenantId: 't-3',
        readiness: {
            ready: false,
            missing: [],
            taxRefusal: 'A consumer outside Germany is not supported.',
        },
    },
    {
        tenantId: 't-4',
        readiness: { ready: false, missing: ['country'], taxRefusal: 'No country is stated.' },
    },
];

const DECIDING = {
    capabilities: { 'subscribers.read': true, 'subscribers.attention': true },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountList(
    component: unknown,
    { manifest = DECIDING as unknown, subscriptions = [] as unknown[] } = {},
) {
    const asked: string[][] = [];
    const wrapper = mountWithQuasar(component as never, {
        global: {
            provide: {
                ...provideStubResources({
                    tenants: {
                        list: async () => ({ items: TENANTS, total: TENANTS.length }),
                        subscriberAttention: async (ids: readonly string[]) => {
                            asked.push([...ids]);
                            return ATTENTION.filter(({ tenantId }) => ids.includes(tenantId));
                        },
                    },
                    subscriptions: { list: async () => subscriptions },
                } as never),
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => manifest,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked };
}

type Mounted = Awaited<ReturnType<typeof mountList>>['wrapper'];

/** The rows of the list, each as its text. */
function rowTexts(wrapper: Mounted): string[] {
    return wrapper.findAll('tbody tr').map((row) => row.text());
}

describe('the tenant list', () => {
    test('marks the tenants held back, each with its reason, and asks once for the page', async () => {
        const { wrapper, asked } = await mountList(TenantsPage);

        expect(asked).toEqual([['t-1', 't-2', 't-3', 't-4']]);
        const [northwind, fabrikam, contoso, initech] = rowTexts(wrapper);
        expect(northwind).not.toMatch(/Address incomplete|Tax case open/);
        expect(fabrikam).toContain('Address incomplete');
        expect(contoso).toContain('Tax case open');
        // Both hold it back: the address is named, which the tenant puts right itself.
        expect(initech).toContain('Address incomplete');
        expect(initech).not.toContain('Tax case open');
    });

    test('without a tax adapter it asks nothing and marks nobody', async () => {
        const { wrapper, asked } = await mountList(TenantsPage, {
            manifest: { capabilities: { 'subscribers.read': true } },
        });

        expect(asked).toEqual([]);
        expect(wrapper.text()).not.toMatch(/Address incomplete|Tax case open/);
    });
});

describe('the subscription list', () => {
    const subscription = (id: string, tenantRow: (typeof TENANTS)[number]) => ({
        id,
        tenant: { id: tenantRow.id, slug: tenantRow.slug, name: tenantRow.name },
        plan: 'PRO',
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        periodEndsAt: null,
        monthlyNet: null,
    });

    test('marks the tenant of each subscription held back, beside its name', async () => {
        const { wrapper, asked } = await mountList(SubscriptionsPage, {
            subscriptions: [subscription('sub-1', TENANTS[0]), subscription('sub-2', TENANTS[1])],
        });

        expect(asked).toEqual([['t-1', 't-2']]);
        const [northwind, fabrikam] = rowTexts(wrapper);
        expect(northwind).toContain('Northwind');
        expect(northwind).not.toContain('Address incomplete');
        expect(fabrikam).toContain('Fabrikam');
        expect(fabrikam).toContain('Address incomplete');
    });
});
