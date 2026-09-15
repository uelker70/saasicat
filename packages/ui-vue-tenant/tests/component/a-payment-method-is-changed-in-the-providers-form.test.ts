// @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission

import { describe, expect, test } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { HttpClient } from '@saasicat/ui-vue';

import TenantPaymentMethodCard from '../../src/tenant-plan-section/TenantPaymentMethodCard.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { paymentMethodSummary } from '../../src/tenant-plan-section/payment-method-summary';

// The card shows what the subscriber pays with to whoever the server lets see
// it, and nobody else. A change opens the payment provider's form: the card
// never asks for a card number or an IBAN itself, and the payment method in
// use stays on it until the provider confirms the new one.

const i18n = defaultTenantPlanSectionI18n('en');

const CARD = {
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 3,
    expiryYear: 2030,
    country: 'DE',
    mandateReference: null,
    confirmedAt: '2026-09-15T10:00:00.000Z',
} as const;

const SEPA = {
    ...CARD,
    type: 'sepa_debit',
    brand: null,
    last4: '3000',
    expiryMonth: null,
    expiryYear: null,
    mandateReference: 'MANDATE-7',
} as const;

function httpAnswering(...answers: Array<[number, unknown]>) {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const http: HttpClient = async (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(init.body) : undefined,
        });
        const [status, body] = answers.shift() ?? [500, {}];
        return {
            status,
            headers: { get: () => null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { http, calls };
}

async function mountCard(http: HttpClient, extra: Record<string, unknown> = {}) {
    const wrapper = mount(TenantPaymentMethodCard, { props: { http, ...extra } });
    await flushPromises();
    return wrapper;
}

describe('who sees the card', () => {
    test('a user holding the billing permission sees the payment method in use', async () => {
        const { http } = httpAnswering([200, { paymentMethod: CARD }]);
        const wrapper = await mountCard(http);

        expect(wrapper.text()).toContain(i18n.paymentMethodTitle);
        expect(wrapper.text()).toContain('Visa ending in 4242, valid until 03/2030');
        expect(wrapper.find('section').attributes('aria-labelledby')).toBe(
            wrapper.find('h3').attributes('id'),
        );
    });

    test('a user without it sees nothing at all, not even the heading', async () => {
        const { http } = httpAnswering([403, { code: 'BILLING_PERMISSION_REQUIRED' }]);
        const wrapper = await mountCard(http);

        expect(wrapper.text()).toBe('');
        expect(wrapper.find('hr').exists()).toBe(false);
    });

    test('nor does anyone where the installation takes no payment methods', async () => {
        const { http } = httpAnswering([404, {}]);
        expect((await mountCard(http)).text()).toBe('');
    });

    test('a failure to load is said, and offers no change it could not show the result of', async () => {
        const { http } = httpAnswering([500, { message: 'down' }]);
        const wrapper = await mountCard(http);

        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.paymentMethodLoadFailed);
        expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });
});

describe('what the card says', () => {
    test('a subscriber without a payment method is offered to add one', async () => {
        const { http } = httpAnswering([200, { paymentMethod: null }]);
        const wrapper = await mountCard(http);

        expect(wrapper.text()).toContain(i18n.paymentMethodNone);
        expect(wrapper.find('button').text()).toBe(i18n.paymentMethodAdd);
    });

    test('a direct debit names its account and the mandate it is collected under', async () => {
        const { http } = httpAnswering([200, { paymentMethod: SEPA }]);
        const wrapper = await mountCard(http);

        expect(wrapper.text()).toContain('SEPA Direct Debit from the account ending in 3000');
        expect(wrapper.text()).toContain('Mandate reference MANDATE-7');
        expect(wrapper.find('button').text()).toBe(i18n.paymentMethodChange);
    });

    test('in German too, and a card whose network the provider did not name', () => {
        const de = defaultTenantPlanSectionI18n('de');
        expect(paymentMethodSummary({ ...CARD, brand: null }, de)).toBe(
            'Karte mit Endziffern 4242, gültig bis 03/2030',
        );
    });
});

describe('changing it', () => {
    test("opens the provider's form and sends the person there, back to this page", async () => {
        const { http, calls } = httpAnswering(
            [200, { paymentMethod: CARD }],
            [200, { redirectUrl: 'https://gateway.example/form/cs_1' }],
        );
        const sentTo: string[] = [];
        const wrapper = await mountCard(http, {
            returnUrl: 'https://app.example/settings/plan',
            navigate: (url: string) => sentTo.push(url),
        });

        await wrapper.find('button').trigger('click');
        await flushPromises();

        expect(calls[1]).toEqual({
            url: '/billing/payment-method/setup',
            method: 'POST',
            body: {
                successUrl: 'https://app.example/settings/plan',
                cancelUrl: 'https://app.example/settings/plan',
            },
        });
        expect(sentTo).toEqual(['https://gateway.example/form/cs_1']);
        // The payment method in use stays until the provider confirms the new one.
        expect(wrapper.text()).toContain('Visa ending in 4242');
    });

    test('a form that could not be opened is said on the card, and nobody is sent anywhere', async () => {
        const { http } = httpAnswering(
            [200, { paymentMethod: CARD }],
            [409, { code: 'PAYMENTS_NOT_CONFIGURED' }],
        );
        const sentTo: string[] = [];
        const wrapper = await mountCard(http, { navigate: (url: string) => sentTo.push(url) });

        await wrapper.find('button').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.paymentMethodChangeFailed);
        expect(sentTo).toEqual([]);
    });
});
