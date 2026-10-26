// A page that links to another standard page — the record to the catalogue,
// back to its list — resolves the link through the routes the shell's
// navigation is built from, so the two never disagree: the shell provides its
// `standardPageRoutes`, and where nothing does, every page is at its default.

// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';
import type { StandardPageKey } from '@saasicat/core';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { standardPageRouteOf } from '../../src/client/nav-builder.js';
import AdminLayout from '../../src/layouts/AdminLayout.vue';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import {
    STANDARD_PAGE_ROUTES_KEY,
    useStandardPageRoute,
} from '../../src/vue/standard-page-routes.js';
import { provideStubResources } from './support/stub-resources.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

const PAGES: StandardPageKey[] = ['tenants', 'plans', 'subscribers'];

/** Prints where three standard pages answer, as the page it stands in for resolves them. */
const LinkingPage = defineComponent({
    setup() {
        const routeOf = useStandardPageRoute();
        return () => h('p', { class: 'resolved' }, PAGES.map((page) => routeOf(page)).join(' '));
    },
});

describe('a link from one standard page to another', () => {
    test('below the shell, goes where the shell’s navigation puts the page', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/', component: LinkingPage }],
        });
        await router.push('/');
        const wrapper = mountWithQuasar(AdminLayout, {
            props: {
                standardPageRoutes: { tenants: '/admin/clubs', plans: '/admin/katalog/plaene' },
            },
            global: { plugins: [router], provide: provideStubResources({}) },
        });
        mounted.push(wrapper);
        await flushPromises();

        expect(wrapper.find('.resolved').text()).toBe(
            '/admin/clubs /admin/katalog/plaene /admin/subscribers',
        );
    });

    test('outside any shell, goes to each page’s default route', () => {
        const wrapper = mountWithQuasar(LinkingPage);
        mounted.push(wrapper);

        expect(wrapper.find('.resolved').text()).toBe(
            '/admin/tenants /admin/plans /admin/subscribers',
        );
    });
});

describe('a tenant’s page', () => {
    test('goes back to the list of tenants where the shell put it', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/admin/tenants/:slug', component: TenantDetailPage },
                { path: '/:rest(.*)', component: { template: '<div />' } },
            ],
        });
        await router.push('/admin/tenants/acme');
        await router.isReady();
        const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
            global: {
                plugins: [router],
                provide: {
                    ...provideStubResources({ tenants: { detail: async () => null } }),
                    [STANDARD_PAGE_ROUTES_KEY]: standardPageRouteOf({ tenants: '/admin/clubs' }),
                },
            },
        });
        mounted.push(wrapper);
        await flushPromises();

        await wrapper.find('header button').trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/admin/clubs');
    });
});
