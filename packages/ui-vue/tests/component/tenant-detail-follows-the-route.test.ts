// The tenant detail reached under one slug and then navigated to another.
//
// Same property as `promo-code-detail-follows-the-route`: Vue Router reuses
// the component when only the param changes, and a mount-only load keeps the
// first tenant under the second URL — whose hero actions would then suspend
// or reactivate the wrong one.

import { afterEach, describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

describe('TenantDetailPage follows the route param', () => {
    test('navigating from one slug to another loads the second', async () => {
        const loaded: string[] = [];
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/admin/tenants/:slug', component: TenantDetailPage },
                { path: '/:rest(.*)', component: { template: '<div />' } },
            ],
        });
        await router.push('/admin/tenants/acme');
        await router.isReady();

        const wrapper = mountWithQuasar({ template: '<router-view />' } as never, {
            global: {
                plugins: [router],
                provide: provideStubResources({
                    tenants: {
                        detail: async (slug: string) => {
                            loaded.push(slug);
                            return null;
                        },
                    },
                } as never),
            },
        });
        mounted.push(wrapper);
        await flush();
        expect(loaded).toEqual(['acme']);

        await router.push('/admin/tenants/globex');
        await flush();

        expect(loaded).toEqual(['acme', 'globex']);
    });
});

async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}
