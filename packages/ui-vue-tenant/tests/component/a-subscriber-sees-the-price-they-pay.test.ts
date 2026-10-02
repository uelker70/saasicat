// @requirement SC-SUB-019 — A subscriber is shown the price of the version they are bound to

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { CatalogPlan, HttpClient } from '@saasicat/ui-vue';

import TenantPlanSection from '../../src/TenantPlanSection.vue';

// The card states what the subscriber pays, and the catalogue states what a new
// customer pays. After a new version of the plan those are two numbers: the
// subscriber bought PRO at 39 € a month, the catalogue now sells it at 49 €. A
// card that read the catalogue would tell them they had been moved without
// being asked, and the next invoice would then look like a mistake.

const CATALOGUE_PRO: CatalogPlan = {
    id: 'PRO',
    name: 'Pro',
    tagline: 'For growing teams',
    monthlyNet: 49,
    yearlyNet: 490,
    popular: false,
    quotas: { users: 50 },
    features: [],
};

function usageAt(planPriceNet: number | null) {
    return {
        plan: 'PRO',
        effectivePlan: 'PRO',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        currentPeriodStart: '2026-09-01T00:00:00.000Z',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv-1',
            planId: 'PRO',
            version: 1,
            publishedAt: '2026-01-01T00:00:00.000Z',
            supersededAt: '2026-08-01T00:00:00.000Z',
            changeNote: null,
        },
        planPriceNet,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: {
            effectiveAt: '2026-10-01T00:00:00.000Z',
            termEndsAt: '2026-10-01T00:00:00.000Z',
            noticeDeadline: null,
            afterNoticeDeadline: false,
        },
        limits: { plan: 'PRO', quotas: { users: 50 }, features: [] },
        usage: { users: 3 },
        packageSnapshot: null,
        retirement: null,
        checkoutOfferId: null,
    };
}

/** The usage read answers with the subscription, the plan list with the catalogue, and every other read with nothing. */
function answering(usage: ReturnType<typeof usageAt>): HttpClient {
    return async (url) => {
        const body = url.endsWith('/usage') ? usage : url.endsWith('/plans') ? [CATALOGUE_PRO] : [];
        return {
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function cardPrice(planPriceNet: number | null) {
    const wrapper = mount(TenantPlanSection, {
        props: {
            http: answering(usageAt(planPriceNet)),
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
        },
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    // The premise: the section has loaded, so an absent price is the card's
    // decision and not a page still waiting for its reads.
    expect(wrapper.text()).toContain('Pro');
    return wrapper.find('.sp-plan-section__price');
}

describe('the plan card', () => {
    test("shows the price of the version the subscription is bound to, not the catalogue's", async () => {
        const price = await cardPrice(39);

        expect(price.text()).toContain('€ 39.00');
        expect(price.text()).not.toContain('€ 49.00');
    });

    test('shows no price where the version bound has none in this rhythm, whatever the catalogue lists', async () => {
        expect((await cardPrice(null)).exists()).toBe(false);
    });
});
