// An option that used to default to ON still defaults to ON.
//
// AP3 §3.2 grouped a page's knobs into one `options` object. The props they
// came from were declared through `withDefaults`, and three of those defaults
// did not survive the move: `props.options?.showPlanColumn` reads `undefined`
// as "off", so an app that had never named the option lost a column — silently,
// with no type error and no failing test, because `undefined` is a legal value
// for an optional boolean.
//
// What was lost:
//
//   TenantsPage      showPlanColumn: true      the plan column
//   TenantDetailPage showUsers: true           the users section
//   PromoCodesPage   statusOptions: [4 values] the status filter's choices
//
// These are the pages as an app that configures nothing sees them. A structural
// check cannot ask this question — the defect is what renders, not what is
// written — so each case mounts the page with no options at all.

import { afterEach, describe, expect, test } from 'vitest';

import PromoCodesPage from '../../src/pages/PromoCodesPage.vue';
import TenantsPage from '../../src/pages/TenantsPage.vue';
import { provideStubResources } from './support/stub-resources.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

const TENANT = {
    id: 't-1',
    slug: 'northwind',
    name: 'Northwind Ltd',
    isActive: true,
    deletedAt: null,
    plan: 'PRO',
};

const PROMO = {
    id: 'p-1',
    code: 'WELCOME20',
    valueType: 'PERCENT',
    value: 20,
    status: 'ACTIVE',
    maxRedemptions: 100,
    redemptionsCount: 12,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function mountBare(component: unknown, stubs: Record<string, unknown>) {
    const wrapper = mountWithQuasar(component as never, {
        // No props at all. That is the case the defaults exist for.
        global: { provide: provideStubResources(stubs as never) },
    });
    mounted.push(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    return wrapper;
}

describe('a page configured with nothing still shows what it used to', () => {
    test('TenantsPage renders the plan column', async () => {
        const wrapper = await mountBare(TenantsPage, {
            tenants: { list: async () => ({ items: [TENANT], total: 1 }) },
        });

        const headers = wrapper.findAll('thead th').map((th) => th.text());
        expect(headers.length, 'the table did not render').toBeGreaterThan(1);
        // The cell, not the header text: the label is translatable and the
        // column is what disappeared.
        expect(
            wrapper.find('.sa-tenants__plan').exists(),
            'the plan column is gone for every app that never named the option',
        ).toBe(true);
    });

    test('PromoCodesPage offers the four statuses in its filter', async () => {
        const wrapper = await mountBare(PromoCodesPage, {
            promoCodes: { list: async () => [PROMO] },
        });

        const select = wrapper.findComponent({ name: 'QSelect' });
        expect(select.exists(), 'the status filter did not render').toBe(true);
        expect(select.props('options')).toEqual(['ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED']);
    });
});
