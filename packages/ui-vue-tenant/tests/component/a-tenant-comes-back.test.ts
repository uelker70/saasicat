// A tenant whose subscription ended subscribes again before its deletion day:
// offered where the server says this user may, from the banner and from the
// plan section, told before confirming what the new subscription costs, from
// which day, how it can be cancelled and that the deletion is lifted — each day
// the one the server named —, and told why where it cannot.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { TenantAccessView } from '@saasicat/core';
import type { HttpClient } from '@saasicat/ui-vue';

import TenantAccessBanner from '../../src/TenantAccessBanner.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import { aRunningSubscription } from './support/running-subscription.js';

type Answer = [number, unknown];

/** A client answering each `METHOD url` in turn with the answers listed for it, the last one again once the list runs out. */
function httpRouting(routes: Record<string, Answer[]>) {
    const calls: Array<{ key: string; body: unknown }> = [];
    const http: HttpClient = async (url, init) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push({
            key,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const listed = routes[key];
        const [status, body] = (listed && listed.length > 1 ? listed.shift() : listed?.[0]) ?? [
            404,
            {},
        ];
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
            bytes: async () => new TextEncoder().encode(JSON.stringify(body)),
        };
    };
    return { http, calls };
}

/** The subscription ended on 30 September; read until the 29th of October, deleted on the 30th. */
const ENDED = {
    kind: 'ended',
    since: '2026-09-30',
    invoiceNumber: null,
    readOnlyUntil: '2026-10-29',
    deletesOn: '2026-10-30',
    deletionDue: false,
} as const;
const OVERDUE = {
    kind: 'overdue',
    since: '2026-09-15',
    invoiceNumber: 'RE-2026-0042',
    readOnlyUntil: null,
    deletesOn: null,
    deletionDue: null,
} as const;

/** What the tenant's administrator reads of it: they may subscribe again. */
const toAdministrator = (overrides: Partial<TenantAccessView> = {}): TenantAccessView => ({
    state: 'read-only',
    reasons: [ENDED],
    holdsBillingPermission: true,
    mayPay: false,
    mayExport: false,
    exportDeliveredBy: null,
    mayReturn: true,
    ...overrides,
});
const OPEN = toAdministrator({ state: 'open', reasons: [], mayReturn: false });

const PLANS = [
    {
        id: 'STANDARD',
        name: 'Standard',
        tagline: 'For a small team',
        monthlyNet: 59,
        yearlyNet: 590,
        popular: false,
        quotas: { users: 10 },
        features: [],
    },
];

/**
 * STANDARD at today's version. The moments fall on days no zone names as the
 * days beside them, so a sentence that wrote the moment instead of the
 * server's day would show.
 */
const TERMS = {
    plan: 'STANDARD',
    billingCycle: 'MONTHLY',
    planVersionId: 'standard-v3',
    periodStart: '2026-10-17T12:00:00.000Z',
    periodEnd: '2026-11-15T12:00:00.000Z',
    periodStartDays: { until: '2026-10-19', from: '2026-10-20' },
    periodEndDays: { until: '2026-11-19', from: '2026-11-20' },
    refusal: null,
    deletesOn: '2026-10-30',
    blockers: [],
    price: {
        currency: 'EUR',
        billingCycle: 'monthly',
        subtotalNet: 59,
        discountNet: 0,
        totalNet: 59,
        vatRate: 19,
        totalGross: 70.21,
    },
    cancellationNoticeDays: 0,
    paymentMethodRequired: false,
};
const RETURNED = {
    plan: 'STANDARD',
    billingCycle: 'MONTHLY',
    planVersionId: 'standard-v3',
    periodStart: TERMS.periodStart,
    periodEnd: TERMS.periodEnd,
    periodStartDays: TERMS.periodStartDays,
    periodEndDays: TERMS.periodEndDays,
};
const DAY_REACHED = {
    code: 'TENANT_RETURN_DELETION_DAY_REACHED',
    message: 'The deletion day of this account, 2026-10-30, has come.',
    params: { deletesOn: '2026-10-30' },
    dayParams: ['deletesOn'],
};

const PREVIEW = 'POST /billing/subscription/return/preview';
const TAKE_OUT = 'POST /billing/subscription/return';

/** The routes a banner of a tenant that can come back reads, with `extra` beside them. */
function aTenantThatCanComeBack(extra: Record<string, Answer[]> = {}) {
    return httpRouting({
        'GET /billing/access': [[200, toAdministrator()]],
        'GET /billing/access/keep': [[200, { keep: [] }]],
        'GET /billing/plans': [[200, PLANS]],
        'GET /billing/feature-registry': [[200, { features: [] }]],
        [PREVIEW]: [[200, TERMS]],
        ...extra,
    });
}

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const formatDate = (iso: string | Date) => new Date(iso).toLocaleDateString('de-DE');
const formatCurrency = (amount: number) => `${amount.toFixed(2)} €`;

async function mountBanner(http: HttpClient) {
    const wrapper = mount(TenantAccessBanner, {
        props: { http, formatDate, formatCurrency },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

/** The dialog is teleported to the body, so it is read from the document. */
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonIn = (root: ParentNode | null, label: string) =>
    [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (button) => button.textContent?.trim() === label,
    );
const SUBSCRIBE_AGAIN = 'Subscribe again';
const CONFIRM = 'Subscribe and pay';

async function click(button: HTMLButtonElement | undefined) {
    expect(button, 'the button is there').toBeDefined();
    button!.click();
    await flushPromises();
}

/** Opens the dialog from the banner and chooses STANDARD. */
async function openAndChoose(wrapper: VueWrapper) {
    await click(buttonIn(wrapper.element, SUBSCRIBE_AGAIN));
    const card = [...(dialog()?.querySelectorAll<HTMLButtonElement>('.sp-model') ?? [])].find(
        (button) => button.textContent?.includes('Standard'),
    );
    await click(card);
}

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the banner offers to subscribe again', () => {
    test('to whoever the server says may, and to nobody else', async () => {
        const offered = await mountBanner(aTenantThatCanComeBack().http);
        expect(buttonIn(offered.element, SUBSCRIBE_AGAIN)).toBeDefined();

        const notOffered = await mountBanner(
            httpRouting({ 'GET /billing/access': [[200, toAdministrator({ mayReturn: false })]] })
                .http,
        );
        expect(buttonIn(notOffered.element, SUBSCRIBE_AGAIN)).toBeUndefined();
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('before confirming, the tenant reads what it comes back on', () => {
    test("the price, the first period, the notice and the deletion lifted, each day the server's", async () => {
        const { http, calls } = aTenantThatCanComeBack();
        await openAndChoose(await mountBanner(http));

        expect(calls.find((call) => call.key === PREVIEW)?.body).toEqual({
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
        });
        const text = dialog()?.textContent ?? '';
        expect(text).toContain('59.00 € net/month, 70.21 € including 19 % VAT');
        expect(text).toContain(
            'Starts on 20.10.2026; the first period runs to the end of 19.11.2026.',
        );
        expect(text).toContain('Can be cancelled to the end of any period.');
        expect(text).toContain(
            'Your data is then no longer deleted on 30.10.2026. The account can be changed again at once.',
        );
        expect(buttonIn(dialog(), CONFIRM)?.disabled).toBe(false);
    });

    test('with an invoice still unpaid, that it keeps the account read-only until it is paid', async () => {
        const { http } = aTenantThatCanComeBack({
            'GET /billing/access': [[200, toAdministrator({ reasons: [OVERDUE, ENDED] })]],
        });
        await openAndChoose(await mountBanner(http));

        expect(dialog()?.textContent).toContain(
            'An invoice still unpaid keeps the account read-only until it is paid.',
        );
        expect(dialog()?.textContent).not.toContain('The account can be changed again at once.');
    });

    test('what stands in the way of the plan, which keeps the confirmation locked', async () => {
        const blocker = {
            code: 'QUOTA_OVER_TARGET',
            message: 'You use 30 of users, and the plan allows 10.',
            params: { quota: 'users', used: 30, targetMax: 10 },
        };
        const { http } = aTenantThatCanComeBack({
            [PREVIEW]: [[200, { ...TERMS, blockers: [blocker], price: null }]],
        });
        await openAndChoose(await mountBanner(http));

        expect(dialog()?.querySelector('.sp-return__blockers')?.textContent).toContain('30');
        expect(buttonIn(dialog(), CONFIRM)?.disabled).toBe(true);
    });

    test('where the server says it cannot come back, why, naming the day', async () => {
        const { http } = aTenantThatCanComeBack({
            [PREVIEW]: [[200, { refusal: 'deletion-day-reached', deletesOn: '2026-10-30' }]],
        });
        await openAndChoose(await mountBanner(http));

        expect(dialog()?.textContent).toContain(
            'The deletion day of this account, 30.10.2026, has come',
        );
        expect(buttonIn(dialog(), CONFIRM)?.disabled).toBe(true);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('without a payment method, it is entered first', () => {
    test('by a user holding the billing permission, here, and the confirmation stays locked until then', async () => {
        const { http, calls } = aTenantThatCanComeBack({
            [PREVIEW]: [[200, { ...TERMS, paymentMethodRequired: true }]],
            'GET /billing/payment-method': [[200, { paymentMethod: null }]],
        });
        await openAndChoose(await mountBanner(http));

        expect(dialog()?.textContent).toContain('Please enter a payment method first');
        expect(dialog()?.querySelector('.sp-payment-method')).not.toBeNull();
        expect(calls.some((call) => call.key === 'GET /billing/payment-method')).toBe(true);
        expect(buttonIn(dialog(), CONFIRM)?.disabled).toBe(true);
    });

    test('by whoever looks after billing, which a user without the permission is told', async () => {
        const { http, calls } = aTenantThatCanComeBack({
            'GET /billing/access': [[200, toAdministrator({ holdsBillingPermission: false })]],
            [PREVIEW]: [[200, { ...TERMS, paymentMethodRequired: true }]],
        });
        await openAndChoose(await mountBanner(http));

        expect(dialog()?.textContent).toContain(
            'Whoever looks after billing in your organisation can enter it.',
        );
        expect(calls.some((call) => call.key === 'GET /billing/payment-method')).toBe(false);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('confirming', () => {
    test('sends the version and the deletion day shown, closes the dialog, and the banner goes', async () => {
        const { http, calls } = aTenantThatCanComeBack({
            'GET /billing/access': [
                [200, toAdministrator()],
                [200, OPEN],
            ],
            [TAKE_OUT]: [[201, RETURNED]],
        });
        const wrapper = await mountBanner(http);
        await openAndChoose(wrapper);

        await click(buttonIn(dialog(), CONFIRM));

        expect(calls.find((call) => call.key === TAKE_OUT)?.body).toEqual({
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            planVersionId: 'standard-v3',
            expectedDeletesOn: '2026-10-30',
        });
        expect(dialog()).toBeNull();
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });

    test('with an invoice still unpaid, the banner stays for it alone', async () => {
        const { http } = aTenantThatCanComeBack({
            'GET /billing/access': [
                [200, toAdministrator({ reasons: [OVERDUE, ENDED] })],
                [200, toAdministrator({ reasons: [OVERDUE], mayReturn: false })],
            ],
            [TAKE_OUT]: [[201, RETURNED]],
        });
        const wrapper = await mountBanner(http);
        await openAndChoose(wrapper);

        await click(buttonIn(dialog(), CONFIRM));

        const lines = wrapper.findAll('.sp-access-banner__reason').map((line) => line.text());
        expect(lines).toEqual([
            'Since 15.9.2026: invoice RE-2026-0042 was not paid by its due date.',
        ]);
        expect(buttonIn(wrapper.element, SUBSCRIBE_AGAIN)).toBeUndefined();
    });

    test('refused because the deletion day came after it was opened: says why with the day, and the state is read again', async () => {
        const { http, calls } = aTenantThatCanComeBack({
            'GET /billing/access': [
                [200, toAdministrator()],
                [
                    200,
                    toAdministrator({
                        reasons: [{ ...ENDED, deletionDue: true }],
                        mayReturn: false,
                    }),
                ],
            ],
            [PREVIEW]: [
                [200, TERMS],
                [200, { refusal: 'deletion-day-reached', deletesOn: '2026-10-30' }],
            ],
            [TAKE_OUT]: [[409, DAY_REACHED]],
        });
        const wrapper = await mountBanner(http);
        await openAndChoose(wrapper);

        await click(buttonIn(dialog(), CONFIRM));

        expect(dialog()?.textContent).toContain(
            'The deletion day of this account, 30.10.2026, has come',
        );
        expect(calls.filter((call) => call.key === PREVIEW)).toHaveLength(2);
        expect(calls.filter((call) => call.key === 'GET /billing/access')).toHaveLength(2);
        expect(buttonIn(wrapper.element, SUBSCRIBE_AGAIN)).toBeUndefined();
    });

    test('refused because the plan changed since: shows it as it stands, and the next confirmation sends its version', async () => {
        const now = {
            ...TERMS,
            planVersionId: 'standard-v4',
            price: { ...TERMS.price, subtotalNet: 64, totalNet: 64, totalGross: 76.16 },
        };
        const { http, calls } = aTenantThatCanComeBack({
            [TAKE_OUT]: [
                [409, { code: 'PLAN_CHANGE_QUOTE_CHANGED', message: '…', preview: now }],
                [201, { ...RETURNED, planVersionId: 'standard-v4' }],
            ],
        });
        await openAndChoose(await mountBanner(http));

        await click(buttonIn(dialog(), CONFIRM));

        const text = dialog()?.textContent ?? '';
        expect(text).toContain('This plan changed since it was shown.');
        expect(text).toContain('64.00 € net/month, 76.16 € including 19 % VAT');
        await click(buttonIn(dialog(), CONFIRM));
        expect(calls.filter((call) => call.key === TAKE_OUT).map((call) => call.body)).toEqual([
            expect.objectContaining({ planVersionId: 'standard-v3' }),
            expect.objectContaining({ planVersionId: 'standard-v4' }),
        ]);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the dialog, by keyboard', () => {
    test('is named by its title, takes the focus, and Escape closes it and gives the focus back', async () => {
        const wrapper = await mountBanner(aTenantThatCanComeBack().http);
        const opener = buttonIn(wrapper.element, SUBSCRIBE_AGAIN);
        opener?.focus();
        await click(opener);

        const panel = dialog();
        const title = document.getElementById(panel?.getAttribute('aria-labelledby') ?? '');
        expect(title?.textContent).toBe(SUBSCRIBE_AGAIN);
        expect(panel?.contains(document.activeElement)).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flushPromises();

        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(opener);
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('the plan section of an ended subscription', () => {
    const ended = aRunningSubscription({
        canceledAt: '2026-08-01T00:00:00.000Z',
        canceledEffectiveAt: '2026-09-30T00:00:00.000Z',
    });

    async function section(view: TenantAccessView) {
        const routes = httpRouting({
            'GET /billing/usage': [[200, ended]],
            'GET /billing/access': [[200, view]],
            'GET /billing/plans': [[200, PLANS]],
            'GET /billing/feature-registry': [[200, { features: [] }]],
            [PREVIEW]: [[200, TERMS]],
        });
        const wrapper = mount(TenantPlanSection, {
            props: { http: routes.http, apiPrefix: '/billing', formatDate, formatCurrency },
            attachTo: document.body,
        });
        mounted.push(wrapper);
        await flushPromises();
        return { wrapper, calls: routes.calls };
    }

    test('offers it where the server says this reader may, and opens the dialog on the plans it read', async () => {
        const { wrapper, calls } = await section(toAdministrator());

        await click(buttonIn(wrapper.element, SUBSCRIBE_AGAIN));

        expect(dialog()?.textContent).toContain('Standard');
        expect(calls.filter((call) => call.key === 'GET /billing/plans')).toHaveLength(1);
    });

    test('does not offer it where the server says not', async () => {
        const { wrapper } = await section(toAdministrator({ mayReturn: false }));

        expect(buttonIn(wrapper.element, SUBSCRIBE_AGAIN)).toBeUndefined();
    });

    test('a header told nothing offers nothing', () => {
        const header = mount(TenantPlanCardHeader, {
            props: {
                usage: ended,
                currentPlanName: 'Pro',
                statusTone: 'negative' as const,
                statusLabel: 'Ended',
                cycleLabel: 'Monthly',
                currentPriceEur: null,
                currentPriceUnit: '',
                billsAgain: false,
                formatCurrency,
                formatDate,
            },
        });
        mounted.push(header);

        expect(buttonIn(header.element, SUBSCRIBE_AGAIN)).toBeUndefined();
    });
});
