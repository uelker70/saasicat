// The status tiles on the promo codes page count the tenant's full set, not
// whatever the filter left over.
//
// They used to count the fetched rows while a tile click also narrowed the
// server query, so selecting "active" reloaded to just the active codes and
// every other tile read 0 — the counts destroyed themselves on first use.

import { describe, expect, test } from 'vitest';

import PromoCodesPage from '../src/pages/PromoCodesPage.vue';
import { mountWithQuasar } from './support/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const ROWS = [
    { id: '1', code: 'SPRING', status: 'ACTIVE' },
    { id: '2', code: 'SUMMER', status: 'ACTIVE' },
    { id: '3', code: 'OLD', status: 'EXPIRED' },
    { id: '4', code: 'HOLD', status: 'PAUSED' },
].map((r) => ({
    ...r,
    valueType: 'PERCENT',
    value: 10,
    redemptionsCount: 0,
    maxRedemptions: null,
    validUntil: null,
    campaignTag: null,
}));

/** Tile counts in render order: all, active, scheduled, paused, expired. */
function tileCounts(wrapper: ReturnType<typeof mountWithQuasar>): string[] {
    return wrapper.findAll('.sa-kpi__value').map((n) => n.text());
}

async function mountPage() {
    const wrapper = mountWithQuasar(PromoCodesPage, {
        global: {
            provide: provideStubResources({
                promoCodes: { list: () => Promise.resolve(ROWS) },
            }),
        },
    });
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    return wrapper;
}

describe('promo code status tiles', () => {
    test('count every row the tenant has', async () => {
        const wrapper = await mountPage();

        expect(tileCounts(wrapper)).toEqual(['4', '2', '0', '1', '1']);
    });

    test('keep their counts when a tile narrows the table', async () => {
        const wrapper = await mountPage();
        const before = tileCounts(wrapper);

        const activeTile = wrapper.findAll('button.sa-kpi')[1]!;
        await activeTile.trigger('click');

        expect(tileCounts(wrapper)).toEqual(before);
    });

    test('keep their counts while the search narrows the table', async () => {
        const wrapper = await mountPage();
        const before = tileCounts(wrapper);

        await wrapper.find('input').setValue('SPRING');

        expect(tileCounts(wrapper)).toEqual(before);
    });
});
