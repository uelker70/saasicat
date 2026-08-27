import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import TenantBundleStore from '../../src/tenant-plan-section/TenantBundleStore.vue';
import type { CatalogBundle } from '@saasicat/ui-vue';

// Which rhythm a tenant buys an add-on in, and what the card says it costs.
//
// A bundle may not outlast the plan it hangs on, so a yearly add-on beside a
// monthly plan is refused — which leaves a real choice only on a yearly plan,
// and none at all on a monthly one. Until this control existed the tenant got
// the plan's rhythm silently while every card said "per month", so on a yearly
// plan the price they compared by was not the price they were charged.

const PRICED_BOTH: CatalogBundle = {
    bundleVersionId: 'bv-both',
    bundleKey: 'ANALYTICS',
    label: 'Analytics',
    description: null,
    features: ['ANALYTICS'],
    quotas: {},
    monthlyNet: 10,
    yearlyNet: 100,
    requiresFeatures: [],
    priceTag: null,
};

const MONTHLY_ONLY: CatalogBundle = {
    ...PRICED_BOTH,
    bundleVersionId: 'bv-monthly',
    bundleKey: 'SUPPORT',
    label: 'Support',
    features: ['SUPPORT'],
    yearlyNet: null,
};

const mounted: VueWrapper[] = [];

function mountStore(overrides: Record<string, unknown> = {}) {
    const options: Record<string, unknown> = {
        props: {
            booked: [],
            available: [PRICED_BOTH],
            planFeatures: [],
            planCycle: 'MONTHLY',
            formatCurrency: (n: number) => `${n.toFixed(2)} EUR`,
            formatDate: (iso: string) => iso,
            featureLabel: (key: string) => key,
            buyingId: null,
            cancelingId: null,
            reactivatingId: null,
            error: null,
            ...overrides,
        },
    };
    const wrapper = mount(TenantBundleStore as never, options as never);
    mounted.push(wrapper);
    return wrapper;
}

afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

const toggle = (w: VueWrapper) => w.find('.sp-bundle-store__cycle');
const cardPrice = (w: VueWrapper) => w.find('.sp-bundle-store__card-price').text();
const bookButton = (w: VueWrapper) => w.find('.sp-bundle-store__card-action');

describe('a monthly plan offers no choice', () => {
    test('no control appears, because there is one legal answer', () => {
        // A yearly add-on would still be committed on every day the plan could
        // end, so it is refused. A control with one option is a question with
        // one answer.
        expect(toggle(mountStore()).exists()).toBe(false);
    });

    test('the card quotes the monthly price with the monthly unit', () => {
        expect(cardPrice(mountStore())).toContain('10.00 EUR');
        expect(cardPrice(mountStore())).toContain('net/month');
    });

    test('buying sends the rhythm rather than leaving it to be guessed', async () => {
        const wrapper = mountStore();
        await bookButton(wrapper).trigger('click');
        expect(wrapper.emitted('buy')?.[0]).toEqual(['bv-both', 'MONTHLY']);
    });
});

describe('a yearly plan offers both', () => {
    test('the control appears, preselected to the plan — nobody is repriced by an upgrade', () => {
        const wrapper = mountStore({ planCycle: 'YEARLY' });
        expect(toggle(wrapper).exists()).toBe(true);
        expect(cardPrice(wrapper)).toContain('100.00 EUR');
        expect(cardPrice(wrapper)).toContain('net/year');
    });

    test('switching moves the price and the unit together', async () => {
        const wrapper = mountStore({ planCycle: 'YEARLY' });
        wrapper.findComponent({ name: 'PlanCycleToggle' }).vm.$emit('update:modelValue', 'MONTHLY');
        await nextTick();
        expect(cardPrice(wrapper)).toContain('10.00 EUR');
        expect(cardPrice(wrapper)).toContain('net/month');
    });

    test('buying sends what was chosen, not what the plan is', async () => {
        const wrapper = mountStore({ planCycle: 'YEARLY' });
        wrapper.findComponent({ name: 'PlanCycleToggle' }).vm.$emit('update:modelValue', 'MONTHLY');
        await nextTick();
        await bookButton(wrapper).trigger('click');
        expect(wrapper.emitted('buy')?.[0]).toEqual(['bv-both', 'MONTHLY']);
    });
});

describe('a bundle that is not sold in the chosen rhythm', () => {
    test('is not offered, and says why instead of showing a price', () => {
        // The server answers the same way — `BUNDLE_NOT_PRICED_FOR_THIS_PLAN` —
        // so a button here would put a tenant in front of something that
        // cannot work.
        const wrapper = mountStore({ planCycle: 'YEARLY', available: [MONTHLY_ONLY] });
        expect(wrapper.text()).toContain('Not available in this rhythm');
        expect(wrapper.find('.sp-bundle-store__card-price').exists()).toBe(false);
        expect(bookButton(wrapper).exists()).toBe(false);
    });

    test('becomes bookable again when the other rhythm is chosen', async () => {
        const wrapper = mountStore({ planCycle: 'YEARLY', available: [MONTHLY_ONLY] });
        wrapper.findComponent({ name: 'PlanCycleToggle' }).vm.$emit('update:modelValue', 'MONTHLY');
        await nextTick();
        expect(wrapper.text()).not.toContain('Not available in this rhythm');
        expect(bookButton(wrapper).exists()).toBe(true);
    });

    test('keeps the reason that actually explains it when it is already booked', () => {
        // A booked bundle reads as booked even in a rhythm it is not sold in.
        // "Not available" would be true and useless.
        const wrapper = mountStore({
            planCycle: 'YEARLY',
            available: [MONTHLY_ONLY],
            booked: [
                {
                    id: 'sb-1',
                    subscriptionId: 'sub-1',
                    bundleVersionId: MONTHLY_ONLY.bundleVersionId,
                    priceNet: 10,
                    billingCycle: 'MONTHLY',
                    startedAt: '2026-01-01T00:00:00.000Z',
                    minimumTermEndsAt: null,
                    canceledAt: null,
                    canceledEffectiveAt: null,
                },
            ],
        });
        expect(wrapper.text()).not.toContain('Not available in this rhythm');
    });
});

describe('a plan whose rhythm changes underneath the section', () => {
    test('drops a selection the plan no longer offers', async () => {
        // A plan change lands and the usage reloads. A yearly selection left
        // standing on a monthly plan would price every card at a figure the
        // booking would refuse.
        const wrapper = mountStore({ planCycle: 'YEARLY' });
        expect(cardPrice(wrapper)).toContain('net/year');
        await wrapper.setProps({ planCycle: 'MONTHLY' } as never);
        expect(toggle(wrapper).exists()).toBe(false);
        expect(cardPrice(wrapper)).toContain('10.00 EUR');
        expect(cardPrice(wrapper)).toContain('net/month');
    });
});

describe('what a booked bundle says it costs', () => {
    // `priceNet` is what the server resolved for the rhythm the booking is in,
    // with the plan's override applied. It is deliberately a figure the
    // catalogue does not carry, so a test cannot pass by falling back to it.
    const booking = (billingCycle: string | null, priceNet: number | null) => ({
        id: 'sb-1',
        subscriptionId: 'sub-1',
        bundleVersionId: PRICED_BOTH.bundleVersionId,
        label: 'Analytics',
        priceNet,
        billingCycle,
        startedAt: '2026-01-01T00:00:00.000Z',
        minimumTermEndsAt: null,
        canceledAt: null,
        canceledEffectiveAt: null,
    });

    const bookedPrice = (w: VueWrapper) => w.find('.sp-plan-section__item-price').text();

    test('a yearly booking states the yearly charge, not a monthly figure', () => {
        // The regression this pins: the wire used to carry the bundle's base
        // monthly price whatever the booking was, so a bundle at 10 monthly
        // and 100 yearly read "10.00 EUR net/year" once booked.
        const wrapper = mountStore({ planCycle: 'YEARLY', booked: [booking('YEARLY', 100)] });
        expect(bookedPrice(wrapper)).toContain('100.00 EUR');
        expect(bookedPrice(wrapper)).toContain('net/year');
    });

    test('a monthly booking beside a yearly plan reads as monthly', () => {
        const wrapper = mountStore({ planCycle: 'YEARLY', booked: [booking('MONTHLY', 10)] });
        expect(bookedPrice(wrapper)).toContain('10.00 EUR');
        expect(bookedPrice(wrapper)).toContain('net/month');
    });

    test('a price only an override supplies is shown, though no catalogue price exists', () => {
        // The server resolved it against the plan; the catalogue cannot. A
        // reader falling back to the catalogue would show 100, or nothing.
        const wrapper = mountStore({ planCycle: 'YEARLY', booked: [booking('YEARLY', 77)] });
        expect(bookedPrice(wrapper)).toContain('77.00 EUR');
    });

    test("a booking from before the rhythm was recorded takes the plan's", () => {
        // Absent is not monthly: such a booking took the plan's rhythm, because
        // that was the only rhythm it could take.
        const wrapper = mountStore({ planCycle: 'YEARLY', booked: [booking(null, null)] });
        expect(bookedPrice(wrapper)).toContain('net/year');
        expect(bookedPrice(wrapper)).toContain('100.00 EUR');
    });

    test("a price the server did not send is joined from the catalogue in the booking's rhythm", () => {
        const wrapper = mountStore({ planCycle: 'YEARLY', booked: [booking('MONTHLY', null)] });
        expect(bookedPrice(wrapper)).toContain('10.00 EUR');
    });
});
