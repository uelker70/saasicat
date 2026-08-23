// The shipped Playwright suite (`testing/admin-pages-suite`) asserts a
// consumer's dashboard by selector. The selector and the page live in the
// same package and drift apart silently: phase 4 replaced the hand-rolled
// `.sa-dashboard__row-head` with `AdminSection`, the suite kept asking for the
// old heading, and the first run that noticed was vereinsfux's, against
// 1.0.0-rc.2. This test mounts the page with distributions and asks the
// suite's own question of it.
import { describe, expect, test } from 'vitest';

import DashboardPage from '../../src/pages/DashboardPage.vue';
import { DASHBOARD_DISTRIBUTION_TITLE } from '../../src/testing/admin-pages-suite.js';
import {
    SUPER_ADMIN_RESOURCES_KEY,
    createResourceRegistry,
    platformResources,
} from '../../src/index.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const CTX = { apiBase: '/api/v1/admin', projectKey: 'demo', locale: 'en' };

/** A shell whose registry never reaches the network: the manifest lists no KPI cards. */
function shell(): Record<symbol, unknown> {
    const http = async () => ({
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
    });
    return {
        [SUPER_ADMIN_RESOURCES_KEY]: createResourceRegistry({
            http: http as never,
            context: CTX,
            resources: platformResources,
        }),
    };
}

const MANIFEST = { schemaVersion: 1 as const, dashboard: { kpiCards: [] } };

describe('the page suite finds the dashboard distributions where the page renders them', () => {
    test('every distribution title answers the selector the suite ships', () => {
        const wrapper = mountWithQuasar(DashboardPage, {
            props: {
                manifest: MANIFEST,
                options: {
                    distributions: [
                        {
                            id: 'subs-by-plan',
                            label: 'Subscriptions per plan',
                            total: 3,
                            entries: [{ label: 'STARTER', value: 3 }],
                            maxValue: 3,
                        },
                        {
                            id: 'promo-by-status',
                            label: 'Promo codes by status',
                            total: 1,
                            entries: [{ label: 'active', value: 1 }],
                            maxValue: 3,
                        },
                    ],
                },
            },
            global: { provide: shell() },
        });
        const titles = wrapper
            .findAll(DASHBOARD_DISTRIBUTION_TITLE)
            .map((node) => node.text().trim());
        expect(titles).toEqual(['Subscriptions per plan', 'Promo codes by status']);
        wrapper.unmount();
    });
});
