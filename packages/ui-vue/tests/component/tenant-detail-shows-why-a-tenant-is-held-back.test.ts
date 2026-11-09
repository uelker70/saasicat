// The tenant detail names every reason the tenant is held back for, the oldest
// first: what it is, since when in the installation's days, the operator's note
// on a suspension, and an invoice unpaid on its due date by its number, linked
// to the record that lists it.
//
// Mounted through a router against a stubbed registry, as an app mounts it.

// @requirement SC-ADM-053 — The operator sees every reason a tenant is held back for

import type { AdminTenantAccessReason } from '@saasicat/core';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { TenantDetailData } from '../../src/internal/tenant-detail/types.js';
import TenantAccessReasons from '../../src/internal/tenant-detail/TenantAccessReasons.vue';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: false, users: [] };

const OVERDUE: AdminTenantAccessReason = {
    id: 'hold-1',
    kind: 'overdue',
    since: '2026-02-15T23:00:00.000Z',
    note: null,
    invoice: { id: 'invoice-7', number: 'AHP-2026-000007', subscriberId: 's-1' },
    subscriptionId: null,
};
const SUSPENDED: AdminTenantAccessReason = {
    id: 'hold-2',
    kind: 'suspended',
    since: '2026-03-02T09:00:00.000Z',
    note: 'chargeback under review',
    invoice: null,
    subscriptionId: null,
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountPage(detail: Partial<TenantDetailData>) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    // SAFETY: the key is the symbol the page injects its manifest under, typed
    // as Vue's injection key rather than as a symbol.
    const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    tenants: {
                        detail: async () => ({ ...TENANT, ...detail }),
                        subscriber: async () => ({ subscriber: null, readiness: null }),
                    },
                }),
                [manifestKey]: () => ({
                    capabilities: {},
                    timeZone: 'Europe/Berlin',
                }),
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return wrapper;
}

describe("the tenant detail's access section", () => {
    test('names each reason, the oldest first, with its day in the installation, the note and the invoice linked to its record', async () => {
        const wrapper = await mountPage({
            access: 'suspended',
            accessReasons: [OVERDUE, SUSPENDED],
        });

        const reasons = wrapper.findAll('.sa-tenant-access__reason');
        expect(reasons.map((reason) => reason.find('.sa-tenant-access__what').text())).toEqual([
            'Unpaid on its due date AHP-2026-000007',
            'Suspended by the operator',
        ]);
        // 23:00 UTC on the 15th is the 16th in Berlin.
        expect(reasons[0]!.find('.sa-tenant-access__since').text()).toContain('16');
        expect(reasons[1]!.find('.sa-tenant-access__note').text()).toBe(
            'Note: chargeback under review',
        );
        expect(reasons[0]!.find('a').attributes('href')).toBe('/admin/subscribers/s-1');
    });

    test('an invoice the server could not name is still a reason', async () => {
        const wrapper = await mountPage({
            access: 'read-only',
            accessReasons: [{ ...OVERDUE, invoice: null }],
        });

        expect(wrapper.find('.sa-tenant-access__what').text()).toBe(
            'An invoice unpaid on its due date',
        );
        expect(wrapper.find('.sa-tenant-access__reason a').exists()).toBe(false);
    });

    test('a tenant held back by nothing says so', async () => {
        const wrapper = await mountPage({ access: 'open', accessReasons: [] });

        expect(wrapper.find('.sa-tenant-access__open').text()).toBe('Not held back.');
    });

    test('is not shown where the server names no reasons', async () => {
        const wrapper = await mountPage({ access: 'open' });

        expect(wrapper.find('.sa-tenant-access__open').exists()).toBe(false);
        expect(wrapper.find('.sa-tenant-access__reasons').exists()).toBe(false);
    });
});

describe('two reasons of one kind that began at the same moment', () => {
    test('stay two rows when the list is read again, each by its own reason', async () => {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const second = {
            ...OVERDUE,
            id: 'hold-3',
            invoice: { id: 'invoice-8', number: 'AHP-2026-000008', subscriberId: 's-1' },
        };
        const wrapper = mount(TenantAccessReasons, {
            props: {
                reasons: [SUSPENDED, OVERDUE, second],
                labels: {
                    open: 'Not held back.',
                    since: 'since {day}',
                    suspended: 'Suspended',
                    overdue: 'Unpaid on its due date',
                    overdueUnnamed: 'An invoice unpaid on its due date',
                    ended: 'Ended',
                    deleting: 'Deleting',
                    note: 'Note: {note}',
                },
                dayOf: (iso: string) => iso.slice(0, 10),
                recordRoute: (subscriberId: string) => `/admin/subscribers/${subscriberId}`,
            },
            global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
        });

        // A move Vue resolves by key: the suspension from the front to the end.
        await wrapper.setProps({ reasons: [OVERDUE, second, SUSPENDED] });

        expect(wrapper.findAll('.sa-tenant-access__invoice').map((link) => link.text())).toEqual([
            'AHP-2026-000007',
            'AHP-2026-000008',
        ]);
        expect(
            warned.mock.calls.some((call) => String(call[0]).includes('Duplicate keys')),
            'two rows shared one key',
        ).toBe(false);
        warned.mockRestore();
    });
});
