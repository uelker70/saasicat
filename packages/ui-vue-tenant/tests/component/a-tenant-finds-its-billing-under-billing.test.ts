// @requirement SC-UI-025 — A tenant finds its billing in one section an application mounts where it keeps billing
// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { HttpClient } from '@saasicat/ui-vue';

import TenantBillingSection from '../../src/TenantBillingSection.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// A tenant looks for its billing under billing, not at the foot of its plan
// page. So the payment method and the billing details are one section an
// application mounts where it keeps billing, shown only to whoever the server
// lets see them, and the plan page can leave the payment method out.

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
};

const DETAILS = {
    customerNumber: 'K-1001',
    legalName: 'Meier GmbH',
    vatId: 'DE123456789',
    taxNumber: null,
    addressLine1: 'Hauptstraße 1',
    addressLine2: 'Hinterhaus',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    invoiceEmail: 'rechnung@meier.example',
};

type Answer = [number, unknown];

/** Answers by method and path; a request nobody scripted is a 404, and every one is recorded. */
function httpRouting(routes: Record<string, Answer | Answer[]>) {
    const calls: Array<{ key: string; body?: unknown }> = [];
    const http: HttpClient = async (url, init) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push({ key, body: init?.body ? JSON.parse(init.body) : undefined });
        const route = routes[key];
        const [status, body] = Array.isArray(route?.[0])
            ? ((route as Answer[]).shift() ?? [500, {}])
            : ((route as Answer | undefined) ?? [404, {}]);
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { http, calls };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountSection(http: HttpClient, props: Record<string, unknown> = {}) {
    const wrapper = mount(TenantBillingSection, { props: { http, ...props } });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const input = (wrapper: VueWrapper, field: string) =>
    wrapper.find(`.sp-billing-details__field--${field} input`);

describe('the billing section', () => {
    test('a user holding the billing permission finds the payment method and the billing details together', async () => {
        const { http } = httpRouting({
            'GET /billing/payment-method': [200, { paymentMethod: CARD }],
            'GET /billing/details': [200, { details: DETAILS }],
        });
        const wrapper = await mountSection(http);

        const headings = wrapper.findAll('h3').map((heading) => heading.text());
        expect(headings).toEqual([i18n.paymentMethodTitle, i18n.billingDetailsTitle]);
        expect(wrapper.text()).toContain('Visa ending in 4242');
        expect(wrapper.findAll('.sp-card')).toHaveLength(1);
        expect(wrapper.find('hr').exists(), 'a divider above the first part').toBe(false);
    });

    for (const [status, why] of [
        [403, 'a user without the billing permission'],
        [404, 'an installation whose billing area is not mounted'],
    ] as const) {
        test(`${why} is shown nothing at all`, async () => {
            const { http } = httpRouting({
                'GET /billing/payment-method': [status, {}],
                'GET /billing/details': [status, {}],
            });
            const wrapper = await mountSection(http);

            expect(wrapper.text()).toBe('');
            expect(wrapper.find('h3').exists()).toBe(false);
        });
    }

    test('an installation that takes no payment methods still shows the billing details', async () => {
        const { http } = httpRouting({
            'GET /billing/payment-method': [404, {}],
            'GET /billing/details': [200, { details: DETAILS }],
        });
        const wrapper = await mountSection(http);

        expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
            i18n.billingDetailsTitle,
        ]);
    });

    test('the routes are read under the prefix the application gives, and the texts it overrides are used', async () => {
        const { http, calls } = httpRouting({
            'GET /api/billing/payment-method': [200, { paymentMethod: null }],
            'GET /api/billing/details': [200, { details: DETAILS }],
        });
        const wrapper = await mountSection(http, {
            apiPrefix: '/api/billing',
            i18n: { billingDetailsTitle: 'Invoicing address' },
        });

        expect(calls.map((call) => call.key).sort()).toEqual([
            'GET /api/billing/details',
            'GET /api/billing/payment-method',
        ]);
        expect(wrapper.text()).toContain('Invoicing address');
    });
});

describe('the billing details', () => {
    async function detailsOf(patch?: Answer | Answer[]) {
        const routing = httpRouting({
            'GET /billing/payment-method': [404, {}],
            'GET /billing/details': [200, { details: DETAILS }],
            ...(patch ? { 'PATCH /billing/details': patch } : {}),
        });
        return { ...routing, wrapper: await mountSection(routing.http) };
    }

    test('show the legal identity as it stands, with no field to change it, and say who changes it', async () => {
        const { wrapper } = await detailsOf();
        const identity = wrapper.find('dl').text();

        expect(identity).toContain('K-1001');
        expect(identity).toContain('Meier GmbH');
        expect(identity).toContain('DE123456789');
        expect(identity).toContain(
            `${i18n.billingDetailsTaxNumber}${i18n.billingDetailsNotStated}`,
        );
        expect(wrapper.text()).toContain(i18n.billingDetailsIdentityNote);
        const values = wrapper.findAll('input').map((field) => field.element.value);
        expect(values).not.toContain('Meier GmbH');
        expect(values).not.toContain('DE123456789');
    });

    test('offer the contact details as fields, each named by its label', async () => {
        const { wrapper } = await detailsOf();

        expect((input(wrapper, 'city').element as HTMLInputElement).value).toBe('Berlin');
        expect(input(wrapper, 'city').element.closest('label')?.textContent).toContain(
            i18n.billingDetailsCity,
        );
        expect(input(wrapper, 'invoiceEmail').attributes('type')).toBe('email');
        expect(input(wrapper, 'addressLine2').attributes('required')).toBeUndefined();
        expect(input(wrapper, 'addressLine1').attributes('required')).toBeDefined();
    });

    test('save only once something changed, send only what changed, and say it was saved', async () => {
        const saved = { ...DETAILS, city: 'Potsdam', postalCode: '14467', addressLine2: null };
        const { wrapper, calls } = await detailsOf([200, { details: saved }]);
        const button = wrapper.find('.sp-billing-details__actions button');
        expect(button.attributes('disabled')).toBeDefined();

        await input(wrapper, 'city').setValue(' Potsdam ');
        await input(wrapper, 'postalCode').setValue('14467');
        await input(wrapper, 'addressLine2').setValue('');
        await button.trigger('click');
        await flushPromises();

        expect(calls.find((call) => call.key === 'PATCH /billing/details')?.body).toEqual({
            city: 'Potsdam',
            postalCode: '14467',
            addressLine2: null,
        });
        expect(wrapper.find('[role="status"]').text()).toBe(i18n.billingDetailsSaved);
        expect((input(wrapper, 'city').element as HTMLInputElement).value).toBe('Potsdam');
        expect(button.attributes('disabled'), 'nothing left to save').toBeDefined();

        await input(wrapper, 'city').setValue('Potsdam-Babelsberg');
        expect(
            wrapper.find('[role="status"]').exists(),
            'saved, said of an edit made after it',
        ).toBe(false);
    });

    test('a field the server refuses is named by its label and marked, and nothing claims it was saved', async () => {
        const { wrapper } = await detailsOf([
            422,
            { code: 'SUBSCRIBER_DETAIL_INVALID', params: { field: 'invoiceEmail' }, message: 'x' },
        ]);

        await input(wrapper, 'invoiceEmail').setValue('no address');
        await wrapper.find('.sp-billing-details__actions button').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe(
            `${i18n.billingDetailsInvoiceEmail} is not valid.`,
        );
        expect(input(wrapper, 'invoiceEmail').attributes('aria-invalid')).toBe('true');
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        expect((input(wrapper, 'invoiceEmail').element as HTMLInputElement).value).toBe(
            'no address',
        );
    });

    test('any other failure says the details were not saved', async () => {
        const { wrapper } = await detailsOf([500, { message: 'down' }]);

        await input(wrapper, 'city').setValue('Potsdam');
        await wrapper.find('.sp-billing-details__actions button').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.billingDetailsSaveFailed);
    });

    test('a failure to load is said, with no form to fill', async () => {
        const { http } = httpRouting({
            'GET /billing/payment-method': [404, {}],
            'GET /billing/details': [500, {}],
        });
        const wrapper = await mountSection(http);

        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.billingDetailsLoadFailed);
        expect(wrapper.find('input').exists()).toBe(false);
    });
});

describe('the plan page', () => {
    const USAGE = {
        plan: 'PRO',
        effectivePlan: 'PRO',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: '2026-09-01T00:00:00.000Z',
        currentPeriodEnd: '2099-10-01T00:00:00.000Z',
        limits: { plan: 'PRO', quotas: {}, features: [] },
        usage: {},
    };

    async function planPage(props: Record<string, unknown> = {}) {
        const calls: string[] = [];
        const http: HttpClient = async (url) => {
            calls.push(url);
            const payload = url.includes('/usage')
                ? USAGE
                : url.includes('/payment-method')
                  ? { paymentMethod: CARD }
                  : [];
            return {
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => payload,
                text: async () => JSON.stringify(payload),
            };
        };
        const wrapper = mount(TenantPlanSection, {
            props: {
                http,
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate: (value: string | Date) => String(value).slice(0, 10),
                ...props,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();
        return { wrapper, calls };
    }

    test('shows the payment method at its foot unless told otherwise', async () => {
        const { wrapper } = await planPage();
        expect(wrapper.text()).toContain(i18n.paymentMethodTitle);
    });

    test('leaves it out, and does not ask for it, where the application keeps billing elsewhere', async () => {
        const { wrapper, calls } = await planPage({ showPaymentMethod: false });

        expect(wrapper.text()).not.toContain(i18n.paymentMethodTitle);
        expect(calls.some((url) => url.includes('/payment-method'))).toBe(false);
        expect(wrapper.text(), 'the rest of the page is still there').toContain(i18n.activePlan);
    });
});
