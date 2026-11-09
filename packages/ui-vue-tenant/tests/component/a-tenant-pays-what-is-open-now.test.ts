// @requirement SC-PRIC-100 — A subscriber pays what is open now

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { TenantPaymentStarted } from '@saasicat/core';
import type { HttpClient } from '@saasicat/ui-vue';

import TenantAccountCard from '../../src/tenant-billing-section/TenantAccountCard.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// Where something is open, the account offers to pay it now, and says before
// it is pressed when the account opens again by card and by direct debit;
// afterwards it says what was set going.

const i18n = defaultTenantPlanSectionI18n('en');

type Answer = [number, unknown];

/** A client answering each `METHOD url` in turn with the answers listed for it. */
function httpRouting(routes: Record<string, Answer[]>) {
    const calls: string[] = [];
    const http: HttpClient = async (url, init) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push(key);
        const [status, body] = routes[key]?.shift() ?? [404, {}];
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { http, calls };
}

const OWING = {
    balances: [{ currency: 'EUR', owed: 69, overdue: 69, credit: 0 }],
    directDebitCollectedOn: '2026-11-24',
};
const NOTHING_OPEN = { balances: [], directDebitCollectedOn: '2026-11-24' };

/** What paying now set going, nothing but `counts`. */
const started = (counts: Partial<TenantPaymentStarted>): TenantPaymentStarted => ({
    paymentMethod: true,
    collected: 0,
    pending: 0,
    failed: 0,
    announced: 0,
    onTheirWay: 0,
    refused: 0,
    waiting: 0,
    ...counts,
});

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountAccount(http: HttpClient) {
    const wrapper = mount(TenantAccountCard, {
        props: {
            http,
            formatCurrency: (amount: number) => `€${amount.toFixed(2)}`,
            // The day the instant falls on in the viewer's zone, as an application's formatter writes it.
            formatDate: (iso: string) => new Date(iso).toLocaleDateString('en-CA'),
        },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const payButton = (wrapper: VueWrapper) => wrapper.find('.sp-account__actions button');

describe('paying now, on the account', () => {
    test('is offered where something is open, with when the account opens again said beside it', async () => {
        const { http } = httpRouting({ 'GET /billing/account': [[200, OWING]] });
        const wrapper = await mountAccount(http);

        expect(payButton(wrapper).text()).toBe(i18n.accountPayNow);
        const hint = wrapper.find('.sp-account__hint').text();
        expect(hint).toBe(i18n.accountPayNowHint.replace('{date}', '2026-11-24'));
        expect(hint).toContain('2026-11-24');
    });

    test('is not offered where nothing is open, a credit included', async () => {
        const { http } = httpRouting({
            'GET /billing/account': [
                [200, { balances: [{ currency: 'EUR', owed: 0, overdue: 0, credit: 12 }] }],
            ],
        });
        const wrapper = await mountAccount(http);

        expect(payButton(wrapper).exists()).toBe(false);
        expect(wrapper.find('.sp-account__hint').exists()).toBe(false);
    });

    test('pays, reads the account again, and says it is paid', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account': [
                [200, OWING],
                [200, NOTHING_OPEN],
            ],
            'POST /billing/account/pay': [[200, started({ collected: 1 })]],
        });
        const wrapper = await mountAccount(http);

        await payButton(wrapper).trigger('click');
        await flushPromises();

        expect(calls).toEqual([
            'GET /billing/account',
            'POST /billing/account/pay',
            'GET /billing/account',
        ]);
        expect(wrapper.find('.sp-account__started').text()).toBe(i18n.accountPaidNow);
        expect(payButton(wrapper).exists()).toBe(false);
    });

    for (const [what, counts, message] of [
        ['a direct debit announced', { announced: 1 }, i18n.accountPayAnnounced],
        ['a payment on its way', { pending: 1 }, i18n.accountPayPending],
        ['a refusal', { failed: 1 }, i18n.accountPayRefused],
        ['a payment method a payment was taken back on', { refused: 1 }, i18n.accountPayRefused],
        ['a mandate missing', { waiting: 1 }, i18n.accountPayWaiting],
        ['a payment already on its way', { onTheirWay: 1 }, i18n.accountPayOnItsWay],
        ['no payment method', { paymentMethod: false }, i18n.accountPayNoMethod],
    ] as const) {
        test(`says what follows ${what}`, async () => {
            const { http } = httpRouting({
                'GET /billing/account': [
                    [200, OWING],
                    [200, OWING],
                ],
                'POST /billing/account/pay': [[200, started(counts)]],
            });
            const wrapper = await mountAccount(http);

            await payButton(wrapper).trigger('click');
            await flushPromises();

            expect(wrapper.find('.sp-account__started').text()).toBe(message);
        });
    }

    test('that could not be started says so', async () => {
        const { http } = httpRouting({
            'GET /billing/account': [[200, OWING]],
            'POST /billing/account/pay': [[409, { code: 'PAYMENTS_NOT_CONFIGURED' }]],
        });
        const wrapper = await mountAccount(http);

        await payButton(wrapper).trigger('click');
        await flushPromises();

        expect(wrapper.find('.sp-account__error').text()).toBe(i18n.accountPayFailed);
    });
});
