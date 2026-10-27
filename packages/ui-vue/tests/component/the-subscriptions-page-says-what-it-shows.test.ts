// The subscriptions page says what it shows: the current state per tenant as
// the application keeps it, and — where the contract register is served — that
// every contract concluded is there. An application's own subtitle wins.

// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { afterEach, describe, expect, test } from 'vitest';

import SubscriptionsPage from '../../src/pages/SubscriptionsPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const REGISTER = {
    capabilities: { 'contracts.read': true },
    navigation: {
        standardPages: { contracts: { enabled: true, requiredCapability: 'contracts.read' } },
        projectPages: [],
    },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

async function mountPage(manifest: unknown, props: { subtitle?: string } = {}) {
    const wrapper = mountWithQuasar(SubscriptionsPage, {
        props,
        global: {
            provide: {
                ...provideStubResources({
                    subscriptions: { list: async () => [] },
                    // The page asks which tenants hold their subscriber back only where a tax adapter decides.
                    tenants: {},
                }),
                // SAFETY: the key is the symbol the page injects its manifest
                // under, typed as Vue's injection key rather than as a symbol.
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => manifest,
            },
        },
    });
    mounted.push(wrapper);
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return wrapper;
}

describe('the subscriptions page', () => {
    test('points to the contract register where that is served', async () => {
        const wrapper = await mountPage(REGISTER);

        expect(wrapper.text()).toContain(
            "The current state per tenant, as the application keeps it. Every contract concluded, former subscribers' and deleted tenants' included, is on the Contracts page.",
        );
    });

    test('says only what it shows where the register is not served', async () => {
        const wrapper = await mountPage({ capabilities: {} });

        expect(wrapper.text()).toContain(
            'The current state per tenant, as the application keeps it.',
        );
        expect(wrapper.text()).not.toContain('Contracts page');
    });

    test('shows an application’s own subtitle instead', async () => {
        const wrapper = await mountPage(REGISTER, { subtitle: 'What our customers book' });

        expect(wrapper.text()).toContain('What our customers book');
        expect(wrapper.text()).not.toContain('Contracts page');
    });
});
