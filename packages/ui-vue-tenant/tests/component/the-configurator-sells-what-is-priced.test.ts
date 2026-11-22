import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import OnboardingConfigurator from '../../src/OnboardingConfigurator.vue';
import { dayAsInstant } from '../../src/day-as-instant.js';
import { createSuperAdminI18n, type CatalogPlan } from '@saasicat/ui-vue';
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
    // As the catalogue names it: BASIC is not sold yearly, so neither is the add-on beside it.
    planPrices: [
        {
            planKey: 'BASIC',
            monthlyNet: 5,
            yearlyNet: null,
            discountedMonthlyNet: null,
            discountedYearlyNet: null,
        },
        {
            planKey: 'PRO',
            monthlyNet: 5,
            yearlyNet: 50,
            discountedMonthlyNet: null,
            discountedYearlyNet: null,
        },
    ],
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
        notSoldInCycle: 'Not available in this rhythm',
        alreadyBooked: 'Included',
        missingRequires: 'Needs',
        dependsOnPlan: 'Depends on the plan',
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

    test('is not sent when the summary emits without its button', async () => {
        // A page replacing the summary's call-to-action slot emits `submit`
        // without the button's disabled state.
        const submit = vi.fn(async () => ({}));
        const wrapper = mountConfigurator({ initialPlan: 'BASIC', initialCycle: 'YEARLY', submit });
        wrapper.findComponent({ name: 'PriceSummary' }).vm.$emit('submit');
        await flushPromises();
        expect(submit).not.toHaveBeenCalled();

        await chooseCycle(wrapper, 'MONTHLY');
        wrapper.findComponent({ name: 'PriceSummary' }).vm.$emit('submit');
        await flushPromises();
        expect(submit).toHaveBeenCalledTimes(1);
    });

    test('becomes a plan again in the rhythm it is priced for', async () => {
        const wrapper = mountConfigurator({ initialPlan: 'BASIC', initialCycle: 'YEARLY' });
        await chooseCycle(wrapper, 'MONTHLY');

        expect(card(wrapper, 'Basic').text()).toContain('10.00 EUR');
        expect(card(wrapper, 'Basic').attributes('disabled')).toBeUndefined();
        expect(cta(wrapper).attributes('disabled')).toBeUndefined();
    });

    test('an add-on priced in the other rhythm only says so and cannot be chosen', () => {
        const monthlyAddOn = {
            ...BUNDLE,
            yearlyNet: null,
            planPrices: BUNDLE.planPrices.map((entry) => ({ ...entry, yearlyNet: null })),
        };
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

    /**
     * Applies a code on monthly, switches to yearly while that preview is out,
     * and releases the two answers in `order` (0 is the monthly question).
     */
    async function discountAfterAnswersLand(order: number[]) {
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
        return discountRow(wrapper).text();
    }

    test('the answer to the earlier question landing last does not replace the latest', async () => {
        expect(await discountAfterAnswersLand([1, 0])).toContain('20.00 EUR');
    });

    test('the answer to the earlier question landing first does not stand', async () => {
        expect(await discountAfterAnswersLand([0, 1])).toContain('20.00 EUR');
    });

    test('a code refused outright is not asked about again, a restricted one is', async () => {
        const refused = vi.fn(async () => ({
            valid: false as const,
            reason: 'NOT_FOUND' as const,
        }));
        const wrongRhythm = vi.fn(async () => ({
            valid: false as const,
            reason: 'BILLING_MISMATCH' as const,
        }));
        for (const [previewPromo, calls] of [
            [refused, 1],
            [wrongRhythm, 2],
        ] as const) {
            const wrapper = mountConfigurator({
                initialPlan: 'PRO',
                initialCycle: 'MONTHLY',
                previewPromo,
            });
            await applyCode(wrapper, 'NOPE');
            await chooseCycle(wrapper, 'YEARLY');
            expect(previewPromo).toHaveBeenCalledTimes(calls);
        }
    });

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

/** One plan's entry in the catalogue; a rhythm left out is not sold beside it. */
function besidePlan(planKey: string, monthlyNet: number, yearlyNet: number | null = null) {
    return {
        planKey,
        monthlyNet,
        yearlyNet,
        discountedMonthlyNet: null,
        discountedYearlyNet: null,
    };
}

// "More storage" from #525: 10.00 on its own, 15.00 beside BASIC.
const STORAGE = {
    ...BUNDLE,
    bundleKey: 'STORAGE',
    label: 'More storage',
    bundleVersionId: 'bv-storage',
    monthlyNet: 10,
    yearlyNet: 100,
    planPrices: [besidePlan('BASIC', 15), besidePlan('PRO', 10, 100)],
    features: ['STORAGE'],
} satisfies PublicMarketingBundle;

// Priced only through PRO's override, which the catalogue allows.
const VIDEO = {
    ...BUNDLE,
    bundleKey: 'VIDEO',
    label: 'Video',
    bundleVersionId: 'bv-video',
    monthlyNet: null,
    yearlyNet: null,
    planPrices: [besidePlan('PRO', 8, 80)],
    features: ['VIDEO'],
} satisfies PublicMarketingBundle;

const addOnCard = (wrapper: VueWrapper, label: string) =>
    wrapper
        .findAll('.sp-public-bundle')
        .find((c) => c.find('.sp-public-bundle__name').text() === label);
const summaryLine = (wrapper: VueWrapper, label: string) =>
    wrapper.findAll('.sp-summary__line').find((line) => line.text().includes(label));

async function choosePlan(wrapper: VueWrapper, planKey: string) {
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', planKey);
    await flushPromises();
}

async function toggleAddOn(wrapper: VueWrapper, bundleVersionId: string) {
    wrapper.findComponent({ name: 'PublicBundleGrid' }).vm.$emit('toggle', bundleVersionId);
    await flushPromises();
}

// @requirement SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in
// @requirement SC-PRIC-007 — An amount a tenant sees is the amount that is charged
describe('an add-on beside the plan a prospect has chosen', () => {
    test("shows and sums the plan's price, not its own", async () => {
        const wrapper = mountConfigurator({
            initialPlan: 'BASIC',
            initialCycle: 'MONTHLY',
            availableBundles: [STORAGE],
        });
        await toggleAddOn(wrapper, 'bv-storage');

        expect(
            addOnCard(wrapper, 'More storage')!.find('.sp-public-bundle__foot').text(),
        ).toContain('15.00 EUR');
        expect(summaryLine(wrapper, 'More storage')!.text()).toContain('15.00 EUR');
        expect(wrapper.find('.sp-summary__total-r').text()).toBe('25.00 EUR');
    });

    test('follows the plan when the prospect changes it', async () => {
        const wrapper = mountConfigurator({
            initialPlan: 'BASIC',
            initialCycle: 'MONTHLY',
            availableBundles: [STORAGE],
        });
        await toggleAddOn(wrapper, 'bv-storage');
        await choosePlan(wrapper, 'PRO');

        expect(
            addOnCard(wrapper, 'More storage')!.find('.sp-public-bundle__foot').text(),
        ).toContain('10.00 EUR');
        expect(summaryLine(wrapper, 'More storage')!.text()).toContain('10.00 EUR');
    });

    test('with no price beside the plan in the rhythm is not available, rather than free', () => {
        const monthlyBesidePro = { ...STORAGE, planPrices: [besidePlan('PRO', 10)] };
        const wrapper = mountConfigurator({
            initialPlan: 'PRO',
            initialCycle: 'YEARLY',
            availableBundles: [monthlyBesidePro],
        });
        const addOn = addOnCard(wrapper, 'More storage')!;

        expect(addOn.text()).toContain('Not available in this rhythm');
        expect(addOn.find('.sp-public-bundle__foot').exists()).toBe(false);
        expect(addOn.attributes('disabled')).toBeDefined();
    });

    test('priced through one plan only is offered beside that plan, and not beside another', async () => {
        const wrapper = mountConfigurator({
            initialPlan: 'PRO',
            initialCycle: 'MONTHLY',
            availableBundles: [STORAGE, VIDEO],
        });
        const video = addOnCard(wrapper, 'Video')!;
        expect(video.find('.sp-public-bundle__foot').text()).toContain('8.00 EUR');
        expect(video.text()).not.toContain('All plans');
        expect(addOnCard(wrapper, 'More storage')!.text()).toContain('All plans');

        await choosePlan(wrapper, 'BASIC');
        expect(addOnCard(wrapper, 'Video')).toBeUndefined();
    });
});

// @requirement SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in
describe('an add-on before a plan is chosen', () => {
    test('shows its own price, marked as depending on the plan', () => {
        const wrapper = mountConfigurator({
            initialPlan: null,
            initialCycle: 'MONTHLY',
            availableBundles: [STORAGE, VIDEO],
        });
        const storage = addOnCard(wrapper, 'More storage')!;
        expect(storage.find('.sp-public-bundle__foot').text()).toContain('10.00 EUR');
        expect(storage.text()).toContain('Depends on the plan');

        // Priced only beside one plan: offered, with no figure of its own.
        const video = addOnCard(wrapper, 'Video')!;
        expect(video.text()).toContain('Depends on the plan');
        expect(video.find('.sp-public-bundle__foot').exists()).toBe(false);
    });

    test('loses the mark once a plan is chosen', async () => {
        const wrapper = mountConfigurator({
            initialPlan: null,
            initialCycle: 'MONTHLY',
            availableBundles: [STORAGE],
        });
        await choosePlan(wrapper, 'BASIC');

        expect(addOnCard(wrapper, 'More storage')!.text()).not.toContain('Depends on the plan');
    });
});

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server
describe('a withdrawn feature beside an add-on', () => {
    test('is marked with the first day the server names, written as the configurator writes days', () => {
        const effectiveFrom = '2099-06-15T12:00:00.000Z';
        const wrapper = mountConfigurator({
            featureRegistry: {
                SUPPORT: {
                    label: 'Support',
                    description: '',
                    icon: '',
                    withdrawn: [
                        {
                            reason: 'Law',
                            effectiveFrom,
                            effectiveFromDays: { until: '2099-12-30', from: '2099-12-31' },
                            liftedFrom: null,
                            liftedFromDays: null,
                        },
                    ],
                },
            },
        });
        // The configurator writes a day in the language the platform's catalogue is in.
        const { intlLocale } = createSuperAdminI18n({ persist: false });
        const written = (day: string) =>
            new Date(dayAsInstant(day)).toLocaleDateString(intlLocale.value);

        const mark = wrapper.find('.sp-withdrawn-mark').text();
        expect(mark).toContain(written('2099-12-31'));
        expect(mark).not.toContain(written('2099-12-30'));
        expect(mark).not.toContain(new Date(effectiveFrom).toLocaleDateString(intlLocale.value));
    });
});
