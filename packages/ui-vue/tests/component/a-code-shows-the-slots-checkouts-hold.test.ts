// A code whose remaining slots are held for checkouts refuses new ones while its
// status still reads ACTIVE. The list says why, beside the redemptions, so an
// operator does not read a full code as a code with room.

// @requirement SC-PROMO-023 — A customer at the payment form keeps the promo code the checkout started with

import { afterEach, describe, expect, test } from 'vitest';

import PromoCodesPage from '../../src/pages/PromoCodesPage.vue';
import type { PromoRow } from '../../src/pages/PromoCodesPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

// Without `heldCount`: a row an application maps from an API of its own that
// does not report it compiles and reads as holding none.
const CODE: PromoRow = {
    id: '1',
    code: 'LAST-SLOTS',
    status: 'ACTIVE',
    valueType: 'PERCENT',
    value: 10,
    redemptionsCount: 3,
    maxRedemptions: 4,
    validUntil: null,
    campaignTag: null,
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function redemptionsCell(code: PromoRow): Promise<string> {
    const wrapper = mountWithQuasar(PromoCodesPage, {
        global: {
            provide: provideStubResources({
                promoCodes: { list: () => Promise.resolve([code]) },
            }),
        },
    });
    mounted.push(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('LAST-SLOTS'));
    if (!row) throw new Error('the code is not listed');
    return row.text();
}

describe('the redemptions of a code in the list', () => {
    test('name the slots checkouts hold beside the redeemed ones', async () => {
        expect(await redemptionsCell({ ...CODE, heldCount: 1 })).toContain('3 + 1 held / 4');
    });

    test('read as before while no checkout holds one', async () => {
        const text = await redemptionsCell({ ...CODE, heldCount: 0 });

        expect(text).toContain('3 / 4');
        expect(text).not.toContain('held');
    });

    test('read as before for a row that does not report held slots', async () => {
        const text = await redemptionsCell(CODE);

        expect(text).toContain('3 / 4');
        expect(text).not.toContain('held');
    });
});
