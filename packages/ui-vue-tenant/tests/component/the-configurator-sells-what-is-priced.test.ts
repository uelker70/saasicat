import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import OnboardingConfigurator from '../../src/OnboardingConfigurator.vue';
import type { CatalogPlan } from '@saasicat/ui-vue';
import type {
    PromoPreviewRequest,
    PromoPreviewResponse,
    PublicMarketingBundle,
} from '@saasicat/core';

// What the onboarding configurator lets a tenant choose, and what its summary
// says the choice costs.
//
// A plan without a yearly price is a monthly plan: its card offers no yearly
// figure, and the order cannot be sent in that rhythm, because the plan change
// and the contract refuse it. The discount a code gives is the one the server
// previewed for the plan and rhythm on screen, so changing either asks again.

const PLANS = [
    {
        id: 'BASIC',
        name: 'Basic',
        tagline: '',
        monthlyNet: 10,
        yearlyNet: null,
        popular: false,
        quotas: {},
        features: [],
    },
    {
        id: 'PRO',
        name: 'Pro',
        tagline: '',
        monthlyNet: 20,
        yearlyNet: 200,
        popular: false,
        quotas: {},
        features: [],
    },
] satisfies CatalogPlan[];

const BUNDLE = {
    bundleKey: 'SUPPORT',
    label: 'Support',
    bundleVersionId: 'bv-support',
    monthlyNet: 5,
    yearlyNet: 50,
    description: '',
    features: ['SUPPORT'],
    quotas: {},
    promo: null,
    compatiblePlanKeys: [],
} satisfies PublicMarketingBundle;

const I18N = {
    eyebrow: 'Onboarding',
    title: 'Choose',
    subtitle: '',
    loading: 'Loading',
    back: 'Back',
    submit: 'Book',
    submitting: 'Booking',
    sections: {
        plan: { eyebrow: 'Plan', title: 'Plan', subtitle: '' },
        bundles: { eyebrow: 'Add-ons', title: 'Add-ons', subtitle: '' },
    },
    cycle: { ariaLabel: 'Rhythm', monthly: 'Monthly', yearly: 'Yearly' },
    plan: {
        popular: 'Popular',
        current: 'Current',
        perMonth: 'month',
        perYear: 'year',
        priceOnRequest: 'On request',
        notSoldInCycle: 'Not available in this rhythm',
    },
    bundles: {
        perMonth: 'month',
        perYear: 'year',
        empty: 'None',
        allPlans: 'All plans',
        priceOnRequest: 'On request',
        notSoldInCycle: 'Not available in this rhythm',
        alreadyBooked: 'Included',
        missingRequires: 'Needs',
    },
    promo: { openLabel: 'Code', placeholder: 'Code', apply: 'Apply', remove: 'Remove' },
    summary: {
        noPlan: 'No plan',
        cycleMonthly: 'Monthly',
        cycleYearly: 'Yearly',
        sectionPlan: 'Plan',
        sectionBundles: 'Add-ons',
        empty: 'No add-ons',
        subtotal: 'Subtotal',
        discount: 'Discount',
        total: 'Total',
        totalUnitMonthly: 'net/month',
        totalUnitYearly: 'net/year',
        yearSavings: 'You save {amount}',
    },
    promoReason: {},
};

/** A valid answer whose server-side net discount is `discountNet`. */
function validAnswer(discountNet: string): PromoPreviewResponse {
    return {
        valid: true,
        code: 'START',
        label: 'Start',
        discount: { valueType: 'PERCENT', value: '10', durationType: 'ONCE', durationValue: null },
        price: {
            originalGross: '0.00',
            discountGross: '0.00',
            discountNet,
            discountedGross: '0.00',
            includedVat: '0.00',
            nextRegularAmountGross: '0.00',
            regularStartsAt: null,
        },
    };
}

const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function mountConfigurator(props: Record<string, unknown> = {}) {
    const wrapper = mount(OnboardingConfigurator, {
        props: {
            plans: PLANS,
            availableBundles: [BUNDLE],
            catalogQuotaKeys: [],
            enablePromo: true,
            formatCurrency: (n: number) => `${n.toFixed(2)} EUR`,
            formatQuotaValue: (_key: string, value: number) => String(value),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            submit: vi.fn(),
            i18n: I18N,
            ...props,
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

const card = (wrapper: VueWrapper, name: string) =>
    wrapper.findAll('.sp-model').find((c) => c.find('.sp-model__name').text() === name)!;
const cta = (wrapper: VueWrapper) => wrapper.find('.sp-summary__cta');
const discountRow = (wrapper: VueWrapper) => wrapper.find('.sp-summary__row--discount');

async function chooseCycle(wrapper: VueWrapper, cycle: 'MONTHLY' | 'YEARLY') {
    wrapper.findComponent({ name: 'PlanCycleToggle' }).vm.$emit('update:modelValue', cycle);
    await flushPromises();
}

async function applyCode(wrapper: VueWrapper, code: string) {
    const input = wrapper.findComponent({ name: 'PromoCodeInput' });
    input.vm.$emit('update:modelValue', code);
    input.vm.$emit('apply');
    await flushPromises();
}

// @requirement SC-CHG-019 — A plan is booked only in a rhythm it carries a price for
// @requirement SC-PRIC-010 — A yearly price is a price per year, not a monthly price with a discount attached
describe('a plan without a price for the chosen rhythm', () => {
    test('says so on its card, cannot be chosen, and the order cannot be sent', async () => {
        const wrapper = mountConfigurator({ initialPlan: 'BASIC', initialCycle: 'YEARLY' });
        // An add-on priced yearly, so the order is not empty and only the plan
        // stands in the way of sending it.
        wrapper.findComponent({ name: 'PublicBundleGrid' }).vm.$emit('toggle', 'bv-support');
        await flushPromises();

        expect(card(wrapper, 'Basic').text()).toContain('Not available in this rhythm');
        expect(card(wrapper, 'Basic').text()).not.toContain('100.00');
        expect(card(wrapper, 'Basic').attributes('disabled')).toBeDefined();
        expect(card(wrapper, 'Pro').attributes('disabled')).toBeUndefined();
        expect(cta(wrapper).attributes('disabled')).toBeDefined();
    });

    test('becomes a plan again in the rhythm it is priced for', async () => {
        const wrapper = mountConfigurator({ initialPlan: 'BASIC', initialCycle: 'YEARLY' });
        await chooseCycle(wrapper, 'MONTHLY');

        expect(card(wrapper, 'Basic').text()).toContain('10.00 EUR');
        expect(card(wrapper, 'Basic').attributes('disabled')).toBeUndefined();
        expect(cta(wrapper).attributes('disabled')).toBeUndefined();
    });

    test('an add-on priced in the other rhythm only says so and cannot be chosen', () => {
        const monthlyAddOn = { ...BUNDLE, yearlyNet: null };
        const wrapper = mountConfigurator({
            initialPlan: 'PRO',
            initialCycle: 'YEARLY',
            availableBundles: [monthlyAddOn],
        });
        const addOn = wrapper.find('.sp-public-bundle');

        expect(addOn.text()).toContain('Not available in this rhythm');
        expect(addOn.text()).not.toContain('50.00');
        expect(addOn.attributes('disabled')).toBeDefined();
    });
});

// @requirement SC-PRIC-007 — An amount a tenant sees is the amount that is charged
describe('a promo code applied before the plan or rhythm changes', () => {
    test('is asked about again, and the summary shows the new answer', async () => {
        const previewPromo = vi.fn(async (req: PromoPreviewRequest) =>
            validAnswer(req.billingCycle === 'YEARLY' ? '20.00' : '2.00'),
        );
        const wrapper = mountConfigurator({
            initialPlan: 'PRO',
            initialCycle: 'MONTHLY',
            previewPromo,
        });

        await applyCode(wrapper, 'START');
        expect(discountRow(wrapper).text()).toContain('2.00 EUR');

        await chooseCycle(wrapper, 'YEARLY');
        expect(previewPromo).toHaveBeenLastCalledWith({
            code: 'START',
            plan: 'PRO',
            billingCycle: 'YEARLY',
        });
        expect(discountRow(wrapper).text()).toContain('20.00 EUR');
    });

    // Both orders: the earlier answer landing last must not replace the later
    // one, and landing first must not stand once the later one is out.
    for (const order of [
        [1, 0],
        [0, 1],
    ]) {
        test(`only the latest question's answer stands, answers landing ${order.join(' then ')}`, async () => {
            const releases: Array<() => void> = [];
            const previewPromo = (req: PromoPreviewRequest) =>
                new Promise<PromoPreviewResponse>((resolve) => {
                    releases.push(() =>
                        resolve(validAnswer(req.billingCycle === 'YEARLY' ? '20.00' : '2.00')),
                    );
                });
            const wrapper = mountConfigurator({
                initialPlan: 'PRO',
                initialCycle: 'MONTHLY',
                previewPromo,
            });

            await applyCode(wrapper, 'START');
            await chooseCycle(wrapper, 'YEARLY');
            for (const question of order) {
                releases[question]();
                await flushPromises();
            }

            expect(discountRow(wrapper).text()).toContain('20.00 EUR');
        });
    }

    test('a code removed while its preview is out gives no discount when the answer lands', async () => {
        const releases: Array<() => void> = [];
        const previewPromo = () =>
            new Promise<PromoPreviewResponse>((resolve) => {
                releases.push(() => resolve(validAnswer('2.00')));
            });
        const wrapper = mountConfigurator({
            initialPlan: 'PRO',
            initialCycle: 'MONTHLY',
            previewPromo,
        });

        await applyCode(wrapper, 'START');
        wrapper.findComponent({ name: 'PromoCodeInput' }).vm.$emit('remove');
        await flushPromises();
        releases[0]();
        await flushPromises();

        expect(discountRow(wrapper).exists()).toBe(false);
    });
});
