// A detail page reached under one code and then navigated to another.
//
// Vue Router reuses a route component when only its params change, so a page
// that loads in `onMounted` alone keeps the first record on screen under the
// second URL — and a save from there writes to the wrong record. The page has
// to follow its param.

// @requirement SC-UI-002 — Mounting a shipped screen costs no wiring

import { afterEach, describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import PromoCodeDetailPage from '../../src/pages/PromoCodeDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const promo = (code: string) => ({
    promo: {
        id: `id-${code}`,
        code,
        type: 'PERCENT',
        value: 10,
        status: 'ACTIVE',
        maxRedemptions: null,
        redemptionsCount: 0,
        validFrom: null,
        validUntil: null,
        appliesToPlans: [],
    },
    redemptions: [],
});

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

describe('PromoCodeDetailPage follows the route param', () => {
    test('navigating from one code to another loads the second', async () => {
        const loaded: string[] = [];
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/admin/promo-codes/:code', component: PromoCodeDetailPage },
                { path: '/:rest(.*)', component: { template: '<div />' } },
            ],
        });
        await router.push('/admin/promo-codes/SPRING');
        await router.isReady();

        const Host = { template: '<router-view />' };
        const wrapper = mountWithQuasar(Host as never, {
            global: {
                plugins: [router],
                provide: provideStubResources({
                    promoCodes: {
                        detail: async (code: string) => {
                            loaded.push(code);
                            return promo(code);
                        },
                    },
                } as never),
            },
        });
        mounted.push(wrapper);
        await flush();
        expect(loaded).toEqual(['SPRING']);

        await router.push('/admin/promo-codes/SUMMER');
        await flush();

        // Without the watcher this stays ['SPRING']: the component is reused,
        // `onMounted` does not run again, and SPRING's data sits under SUMMER's URL.
        expect(loaded).toEqual(['SPRING', 'SUMMER']);
    });
});

async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}
