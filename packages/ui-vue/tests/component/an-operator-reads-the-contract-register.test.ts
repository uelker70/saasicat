// The operator reads the contract register: every contract of the
// installation, a former subscriber's and a deleted tenant's included, narrowed
// to a standing on a day, each with its subscriber leading into the record with
// that contract open, its tenant as the application still knows it or not, what
// it was concluded on, its term, its standing and its price.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is asked.

// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { AdminRegisterContract } from '@saasicat/core';

import { standardPageRouteOf } from '../../src/client/nav-builder.js';
import type { ContractRegisterRequest } from '../../src/client/resources/contracts.resource.js';
import ContractsPage from '../../src/pages/ContractsPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import {
    STANDARD_PAGE_ROUTES_KEY,
    type StandardPageRoute,
} from '../../src/vue/standard-page-routes.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { settle } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';

const contract = (
    id: string,
    overrides: Partial<AdminRegisterContract> = {},
): AdminRegisterContract => ({
    id,
    subscriber: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    tenant: { id: 't-1', known: true, name: 'Northwind', slug: 'northwind', deletedAt: null },
    plan: { key: 'PRO', title: 'Pro' },
    bundles: [],
    firstDay: '2026-01-01',
    lastDay: null,
    standing: 'in-force',
    billingCycle: 'monthly',
    currency: 'EUR',
    totalGross: 119,
    ...overrides,
});

const CONTRACTS: AdminRegisterContract[] = [
    contract('c-1', { bundles: [{ key: 'SMS', title: 'SMS' }] }),
    contract('c-2', {
        subscriber: { id: 's-2', customerNumber: 'K-10002', legalName: 'Fabrikam GmbH' },
        tenant: { id: 't-9', known: false, name: null, slug: null, deletedAt: null },
        plan: null,
        firstDay: '2025-06-01',
        lastDay: '2025-12-31',
        standing: 'ended',
        billingCycle: 'yearly',
        totalGross: 1190,
    }),
    contract('c-3', {
        tenant: {
            id: 't-3',
            known: true,
            name: 'Contoso',
            slug: 'contoso',
            deletedAt: '2026-01-20T00:00:00.000Z',
        },
        standing: 'never-in-force',
    }),
];

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function mountRegister({
    contracts = CONTRACTS,
    next = null,
    standardPageRoute = standardPageRouteOf(undefined),
}: {
    contracts?: AdminRegisterContract[];
    next?: string | null;
    standardPageRoute?: StandardPageRoute;
} = {}) {
    const asked: ContractRegisterRequest[] = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/contracts', component: ContractsPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/contracts');
    await router.isReady();
    const manifest = {
        capabilities: { 'contracts.read': true },
        navigation: { standardPages: {}, projectPages: [] },
    };
    // SAFETY: the key is the symbol the page injects its manifest under, typed
    // as Vue's injection key rather than as a symbol.
    const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        attachTo: document.body,
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    contracts: {
                        page: async (request: ContractRegisterRequest) => {
                            asked.push(request);
                            return {
                                today: '2026-02-17',
                                state: request.state ?? 'in-force',
                                day: request.day ?? '2026-02-17',
                                contracts: request.after ? [contract('c-later')] : contracts,
                                next: request.after ? null : next,
                            };
                        },
                    },
                }),
                [manifestKey]: () => manifest,
                [STANDARD_PAGE_ROUTES_KEY]: standardPageRoute,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked };
}

type Mounted = Awaited<ReturnType<typeof mountRegister>>['wrapper'];

/** The table's cells, row by row. */
const rowsOf = (wrapper: Mounted): string[][] =>
    wrapper
        .findAll('tbody tr')
        .map((row) => row.findAll('td, q-td').map((cell) => cell.text().replace(/\s+/g, ' ')));

describe('the contract register', () => {
    test('reads the contracts in force today once, and says the day it read them on', async () => {
        const { wrapper, asked } = await mountRegister();

        expect(asked).toEqual([{ state: 'in-force' }]);
        expect(wrapper.find('section h2').text()).toBe('As of 2026-02-17');
    });

    test('lists each contract with its subscriber, its tenant, what it was concluded on, its term, its standing and its price', async () => {
        const { wrapper } = await mountRegister();

        expect(rowsOf(wrapper).map((cells) => cells.slice(0, 6))).toEqual([
            [
                'K-10001 · Northwind GmbH',
                'Northwind',
                'Pro + SMS',
                'from 2026-01-01, open-ended',
                'In force',
                '€119 gross, Monthly',
            ],
            [
                'K-10002 · Fabrikam GmbH',
                'Tenant t-9, no longer in the application',
                'no plan',
                '2025-06-01 – 2025-12-31',
                'Ended',
                '€1,190 gross, Yearly',
            ],
            [
                'K-10001 · Northwind GmbH',
                'Contoso, deleted',
                'Pro',
                'Never in force — superseded before it began',
                'Never in force',
                '€119 gross, Monthly',
            ],
        ]);
    });

    test('leads into the subscriber’s record with the contract open, wherever the shell put the subscribers', async () => {
        const { wrapper } = await mountRegister({
            standardPageRoute: standardPageRouteOf({ subscribers: '/backoffice/parties' }),
        });

        expect(
            wrapper
                .find('a[aria-label="Open K-10002\'s contract in the record"]')
                .attributes('href'),
        ).toBe('/backoffice/parties/s-2?contract=c-2');
    });

    test('a standing or a day picked asks for those, from the first page', async () => {
        const { wrapper, asked } = await mountRegister();

        const select = wrapper.findComponent({ name: 'QSelect' });
        expect(select.props('options').map(({ value }: { value: string }) => value)).toEqual([
            'in-force',
            'ended',
            'scheduled',
            'never-in-force',
            'all',
        ]);
        select.vm.$emit('update:modelValue', 'ended');
        await settle();
        wrapper.findComponent({ name: 'QInput' }).vm.$emit('update:modelValue', '2026-01-15');
        await settle();

        expect(asked.slice(1)).toEqual([{ state: 'ended' }, { state: 'ended', day: '2026-01-15' }]);
    });

    test('loads the next page after the last row read', async () => {
        const { wrapper, asked } = await mountRegister({ next: 'c-3' });

        const more = wrapper.findAll('button').find((button) => button.text() === 'Load more');
        expect(more?.exists(), 'no button loads more').toBe(true);
        await more?.trigger('click');
        await settle();

        // On the day the first page was read on, so the pages are of one day.
        expect(asked.at(-1)).toEqual({ state: 'in-force', day: '2026-02-17', after: 'c-3' });
        expect(rowsOf(wrapper)).toHaveLength(4);
    });

    test('says so where no contract stands so', async () => {
        const { wrapper } = await mountRegister({ contracts: [] });

        expect(wrapper.text()).toContain('No contract in this standing.');
    });
});
