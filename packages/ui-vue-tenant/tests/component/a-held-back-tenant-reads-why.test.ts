// @requirement SC-ADM-054 — A tenant's users read why it is held back

import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { TenantAccessView } from '@saasicat/core';
import { TENANT_ACCESS_POLL_MS, type HttpClient } from '@saasicat/ui-vue';

import TenantAccessBanner from '../../src/TenantAccessBanner.vue';

// Above the application, every user of a tenant held back reads why: the state,
// each reason from its day, and under an unpaid invoice either a way to pay it
// or who can.

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

const OVERDUE = { kind: 'overdue', since: '2026-11-16', invoiceNumber: 'RE-2026-0042' } as const;

/** What a user with the billing permission reads, where it is collected through a gateway. */
const toBilling = (overrides: Partial<TenantAccessView> = {}): TenantAccessView => ({
    state: 'read-only',
    reasons: [OVERDUE],
    holdsBillingPermission: true,
    mayPay: true,
    ...overrides,
});
const ACCOUNT = {
    balances: [{ currency: 'EUR', owed: 69, overdue: 69, credit: 0 }],
    directDebitCollectedOn: '2026-11-24',
};

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.useRealTimers();
});

async function mountBanner(http: HttpClient) {
    const wrapper = mount(TenantAccessBanner, {
        props: {
            http,
            // The day the instant falls on in the viewer's zone, as an application's formatter writes it.
            formatDate: (iso: string) => new Date(iso).toLocaleDateString('de-DE'),
        },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const payButton = (wrapper: VueWrapper) => wrapper.find('.sp-access-banner__actions button');
const lines = (wrapper: VueWrapper) =>
    wrapper.findAll('.sp-access-banner__reason').map((line) => line.text());

describe('the banner of a tenant held back', () => {
    test('shows nothing where the tenant is open', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, toBilling({ state: 'open', reasons: [] })]],
        });
        const wrapper = await mountBanner(http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });

    test('shows nothing where no route answers', async () => {
        const wrapper = await mountBanner(httpRouting({}).http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });

    test('to a user who may pay: the state, the invoice by number from its day, and paying with when it opens again', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[200, toBilling()]],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);

        const banner = wrapper.find('.sp-access-banner');
        expect(banner.attributes('role')).toBe('status');
        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account can be read but not changed at the moment. You can still view and export its data.',
        );
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
        ]);
        expect(payButton(wrapper).exists()).toBe(true);
        expect(wrapper.text()).toContain('once it is collected on 24.11.2026');
        expect(calls).toEqual(['GET /billing/account/access', 'GET /billing/account']);
    });

    test('paying starts the payment, says what it set going, and reads the state again', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [
                [200, toBilling()],
                [200, toBilling()],
            ],
            'GET /billing/account': [
                [200, ACCOUNT],
                [200, ACCOUNT],
            ],
            'POST /billing/account/pay': [
                [
                    200,
                    {
                        paymentMethod: true,
                        collected: 0,
                        pending: 0,
                        failed: 0,
                        announced: 1,
                        onTheirWay: 0,
                        refused: 0,
                        waiting: 0,
                        notSentYet: 0,
                    },
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        await payButton(wrapper).trigger('click');
        await flushPromises();

        expect(calls.filter((call) => call === 'POST /billing/account/pay')).toHaveLength(1);
        expect(calls.at(-1)).toBe('GET /billing/account/access');
        expect(wrapper.text()).toContain('The direct debit is announced.');
    });

    test('to a user without the billing permission: no number, nothing to press, and who can pay', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[403, {}]],
            'GET /billing/access': [
                [
                    200,
                    toBilling({
                        reasons: [{ ...OVERDUE, invoiceNumber: null }],
                        holdsBillingPermission: false,
                        mayPay: false,
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: an invoice was not paid by its due date.',
        ]);
        expect(payButton(wrapper).exists()).toBe(false);
        expect(wrapper.text()).toContain(
            'Whoever looks after billing in your organisation can pay it.',
        );
        expect(calls).not.toContain('GET /billing/account');
    });

    test('to a user with the permission where nothing is collected here: the number, and nothing to press', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, toBilling({ mayPay: false })]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)[0]).toContain('RE-2026-0042');
        expect(payButton(wrapper).exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Whoever looks after billing');
    });

    test('suspended, nothing is offered to pay, since a suspension lets no payment through', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [
                    200,
                    toBilling({
                        state: 'suspended',
                        reasons: [
                            OVERDUE,
                            { kind: 'suspended', since: '2026-11-17', invoiceNumber: null },
                        ],
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(wrapper.find('.sp-access-banner').classes()).toContain('sp-access-banner--stopped');
        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account is suspended. Please contact your provider.',
        );
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
            'Since 17.11.2026: suspended by your provider.',
        ]);
        expect(payButton(wrapper).exists()).toBe(false);
    });

    test('suspended, a user without the billing permission is not sent to somebody who cannot pay either', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[403, {}]],
            'GET /billing/access': [
                [
                    200,
                    toBilling({
                        state: 'suspended',
                        reasons: [
                            { ...OVERDUE, invoiceNumber: null },
                            { kind: 'suspended', since: '2026-11-17', invoiceNumber: null },
                        ],
                        holdsBillingPermission: false,
                        mayPay: false,
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toHaveLength(2);
        expect(wrapper.text()).not.toContain('Whoever looks after billing');
    });

    test('where an ended subscription holds it back as well, paying is offered without promising it opens again', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [
                    200,
                    toBilling({
                        reasons: [
                            { kind: 'ended', since: '2026-11-10', invoiceNumber: null },
                            OVERDUE,
                        ],
                    }),
                ],
            ],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)[0]).toBe('Since 10.11.2026: the subscription has ended.');
        expect(payButton(wrapper).exists()).toBe(true);
        expect(wrapper.text()).not.toContain('collected on');
    });

    test('a hold begun while the page is open shows on the next read, and goes once lifted', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const open = toBilling({ state: 'open', reasons: [] });
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [200, open],
                [200, toBilling()],
                [200, open],
            ],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);

        await vi.advanceTimersByTimeAsync(TENANT_ACCESS_POLL_MS);
        await flushPromises();
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
        ]);

        await vi.advanceTimersByTimeAsync(TENANT_ACCESS_POLL_MS);
        await flushPromises();
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });
});
