// The operator finds a subscriber on the list of subscribers — by what a
// caller gives, or among those without a live tenant — and opens its record,
// whose head names every tenant it was linked to and says so where the
// application no longer has one.
//
// Mounted through a router, the way an app mounts the pages, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is asked.

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not
// @requirement SC-ADM-021 — An operator finds everything about a subscriber in one record

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { SubscriberListRequest } from '../../src/client/resources/subscribers.resource.js';
import SubscribersPage from '../../src/pages/SubscribersPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { settle } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';
import { RECORD, mountRecord, type MountedRecord } from './support/subscriber-record.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const ROWS = [
    {
        id: 's-2',
        customerNumber: 'K-10002',
        legalName: 'Muster GmbH',
        vatId: 'DE123456789',
        city: 'Berlin',
        country: 'DE',
        liveTenant: null,
    },
    {
        id: 's-1',
        customerNumber: 'K-10001',
        legalName: 'Northwind GmbH',
        vatId: null,
        city: 'Hamburg',
        country: 'DE',
        liveTenant: { id: 't-1', slug: 'northwind', name: 'Northwind' },
    },
    {
        id: 's-0',
        customerNumber: 'K-10000',
        legalName: 'Gone AG',
        vatId: null,
        city: null,
        country: null,
        liveTenant: { id: 't-gone', slug: null, name: null },
    },
];

async function mountList(
    list: (request: SubscriberListRequest) => Promise<unknown> = async () => ({
        subscribers: ROWS,
        next: null,
    }),
) {
    const asked: SubscriberListRequest[] = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/subscribers', component: SubscribersPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/subscribers');
    await router.isReady();
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        global: {
            plugins: [router],
            provide: provideStubResources({
                subscribers: {
                    list: async (request: SubscriberListRequest) => {
                        asked.push(request);
                        return list(request);
                    },
                },
            }),
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked };
}

describe('the list of subscribers', () => {
    test('names each subscriber, leads into its record, and says which tenant it is live for', async () => {
        const { wrapper, asked } = await mountList();

        expect(asked).toEqual([{ query: '', withoutLiveTenant: false }]);
        const rows = wrapper
            .findAll('tbody tr')
            .map((row) => row.findAll('td, q-td').map((cell) => cell.text()));
        expect(rows).toEqual([
            ['K-10002', 'Muster GmbH', 'DE123456789', 'Berlin, DE', 'no tenant'],
            ['K-10001', 'Northwind GmbH', '', 'Hamburg, DE', 'Northwind'],
            ['K-10000', 'Gone AG', '', '', 'no longer known to the application'],
        ]);
        const link = wrapper.find('a[aria-label="Open the subscriber record of K-10002"]');
        expect(link.attributes('href')).toBe('/admin/subscribers/s-2');
    });

    test('asks again for what the operator types, and for those without a tenant', async () => {
        const { wrapper, asked } = await mountList();

        await wrapper.find('input[type="text"], input:not([type])').setValue('Muster');
        await new Promise((resolve) => setTimeout(resolve, 300));
        await settle();
        expect(asked.at(-1)).toEqual({ query: 'Muster', withoutLiveTenant: false });

        await wrapper.find('.q-toggle').trigger('click');
        await settle();
        expect(asked.at(-1)).toEqual({ query: 'Muster', withoutLiveTenant: true });
    });

    // @requirement SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had
    test('marks a subscriber joined into another with the one it was joined into', async () => {
        const { wrapper } = await mountList(async () => ({
            subscribers: [
                { ...ROWS[0], joinedInto: { subscriberId: 's-1', customerNumber: 'K-10001' } },
                { ...ROWS[1], joinedInto: null },
            ],
            next: null,
        }));

        const [joined, live] = wrapper.findAll('tbody tr');
        expect(joined?.text()).toContain('joined into K-10001');
        expect(live?.text()).not.toContain('joined into');
    });

    test('with nobody matching, says so', async () => {
        const { wrapper } = await mountList(async () => ({ subscribers: [], next: null }));

        expect(wrapper.text()).toContain('No subscribers match these filters.');
    });

    test('offers the next page where there is one, and reads it after the last subscriber', async () => {
        const { wrapper, asked } = await mountList(async (request) =>
            request.after
                ? {
                      subscribers: [{ ...ROWS[0], id: 's-9', customerNumber: 'K-09999' }],
                      next: null,
                  }
                : { subscribers: ROWS, next: 's-0' },
        );

        const more = wrapper.findAll('button').find((button) => button.text() === 'Load more');
        expect(more, 'no way to the next page').toBeTruthy();
        await more?.trigger('click');
        await settle();

        expect(asked.at(-1)).toEqual({ query: '', withoutLiveTenant: false, after: 's-0' });
        expect(wrapper.text()).toContain('K-09999');
        expect(wrapper.findAll('button').some((button) => button.text() === 'Load more')).toBe(
            false,
        );
    });

    test('a list that fails to load says so', async () => {
        const { wrapper } = await mountList(async () => {
            throw new Error('offline');
        });

        expect(wrapper.text()).toContain('The subscribers could not be loaded.');
    });
});

/** The entries of the record's tenants section, as text. */
function tenantEntries(wrapper: MountedRecord): string[] {
    return wrapper.findAll('.sa-subscriber-tenants__entry').map((entry) => entry.text());
}

describe("the head of a subscriber's record", () => {
    test('names the subscriber, its master data with its invoice email, and its live tenant', async () => {
        const { wrapper } = await mountRecord();

        expect(wrapper.find('h1').text()).toContain('K-10001 · Northwind GmbH');
        expect(wrapper.text()).toContain('invoices@northwind.example');
        const [live] = tenantEntries(wrapper);
        expect(live).toContain('Northwind');
        expect(live).toContain('Linked since 01/05/2026');
        const link = wrapper.find('a[aria-label="Open tenant Northwind"]');
        expect(link.attributes('href')).toBe('/admin/tenants/northwind');
    });

    test('names a tenant whose link was closed, from when until when', async () => {
        const { wrapper } = await mountRecord({
            subscribers: {
                record: async () => ({
                    ...RECORD,
                    tenants: [
                        {
                            ...RECORD.tenants[0],
                            unlinkedAt: '2026-06-30T10:00:00.000Z',
                            deletedAt: '2026-06-30T10:00:00.000Z',
                        },
                    ],
                }),
            },
        });

        const [closed] = tenantEntries(wrapper);
        expect(closed).toContain('Linked from 01/05/2026 until 06/30/2026');
        expect(closed).toContain('Deleted in the application on 06/30/2026');
        expect(wrapper.find('.sa-subscriber-tenants .sa-banner--warning').exists()).toBe(false);
    });

    test('warns where the application no longer has a tenant whose link is still open', async () => {
        const { wrapper } = await mountRecord({
            subscribers: {
                record: async () => ({
                    ...RECORD,
                    tenants: [
                        {
                            ...RECORD.tenants[0],
                            tenantId: 't-gone',
                            known: false,
                            slug: null,
                            name: null,
                        },
                    ],
                }),
            },
        });

        const warning = wrapper.find('.sa-subscriber-tenants .sa-banner--warning');
        expect(warning.text()).toContain(
            'The application no longer knows tenant t-gone, but its link is not closed.',
        );
        expect(wrapper.find('.sa-subscriber-tenants a').exists()).toBe(false);
    });

    test('says so where the subscriber is linked to no tenant', async () => {
        const { wrapper } = await mountRecord({
            subscribers: { record: async () => ({ ...RECORD, tenants: [] }) },
        });

        expect(wrapper.text()).toContain('Linked to no tenant.');
    });

    test('a record that fails to load says so, and shows none of its sections', async () => {
        const { wrapper } = await mountRecord({
            subscribers: {
                record: async () => {
                    throw new Error('offline');
                },
            },
        });

        expect(wrapper.text()).toContain('The subscriber record could not be loaded.');
        expect(wrapper.text()).not.toContain('Master data');
    });
});
