// @requirement SC-BUN-027 — The same add-on cannot be booked twice on one subscription

import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

import TenantBundleStore from '../../src/tenant-plan-section/TenantBundleStore.vue';
import type { CatalogBundle, SubscriptionBundleShape } from '@saasicat/ui-vue';

// A tenant holds version 1 of Reports, and the catalogue now sells version 2.
// The server refuses a second booking of an add-on while the first one runs,
// so the store says Reports is booked rather than offering a button that
// cannot work. A booking cancelled for a day still to come runs until then.

const REPORTS_V2: CatalogBundle = {
    bundleVersionId: 'bv-r2',
    bundleKey: 'REPORTS',
    label: 'Reports',
    description: null,
    features: ['REPORTS'],
    quotas: {},
    monthlyNet: 10,
    yearlyNet: 100,
    requiresFeatures: [],
    priceTag: null,
};

const EXPORTS_V1: CatalogBundle = {
    ...REPORTS_V2,
    bundleVersionId: 'bv-e1',
    bundleKey: 'EXPORTS',
    label: 'Exports',
    features: ['EXPORTS'],
};

const PAST = '2026-01-31T00:00:00.000Z';
const TO_COME = '2099-01-01T00:00:00.000Z';

/** A booking of Reports version 1, running unless `fields` say otherwise. */
function reportsV1(fields: Partial<SubscriptionBundleShape> = {}): SubscriptionBundleShape {
    return {
        id: 'sb-1',
        subscriptionId: 'sub-1',
        bundleVersionId: 'bv-r1',
        bundleKey: 'REPORTS',
        label: 'Reports',
        priceNet: 10,
        billingCycle: 'MONTHLY',
        startedAt: '2026-01-10T00:00:00.000Z',
        minimumTermEndsAt: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        ...fields,
    };
}

const mounted: VueWrapper[] = [];

function storeWith(booked: SubscriptionBundleShape[], available = [REPORTS_V2]) {
    const wrapper = mount(
        TenantBundleStore as never,
        {
            props: {
                booked,
                available,
                planFeatures: [],
                planCycle: 'MONTHLY',
                formatCurrency: (n: number) => `${n.toFixed(2)} EUR`,
                formatDate: (iso: string) => iso,
                featureLabel: (key: string) => key,
                buyingId: null,
                cancelingId: null,
                reactivatingId: null,
                error: null,
            },
        } as never,
    );
    mounted.push(wrapper);
    return wrapper;
}

afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

/** The catalogue card of the add-on labelled `label`. */
function card(wrapper: VueWrapper, label: string) {
    const found = wrapper
        .findAll('.sp-bundle-store__card')
        .find((c) => c.find('.sp-bundle-store__card-name').text() === label);
    if (!found) throw new Error(`no card for ${label}`);
    return found;
}

const offered = (wrapper: VueWrapper, label: string) =>
    card(wrapper, label).find('.sp-bundle-store__card-action').exists();

const saysBooked = (wrapper: VueWrapper, label: string) =>
    card(wrapper, label).find('.sp-bundle-store__card-badge').text() === 'Already booked';

describe('the store, while a version of an add-on is held', () => {
    test('says a newer version of it is booked, and offers no button', () => {
        const wrapper = storeWith([reportsV1()]);
        expect(offered(wrapper, 'Reports')).toBe(false);
        expect(saysBooked(wrapper, 'Reports')).toBe(true);
    });

    test('still says so while the booking is cancelled for a day to come', () => {
        const wrapper = storeWith([reportsV1({ canceledAt: PAST, canceledEffectiveAt: TO_COME })]);
        expect(offered(wrapper, 'Reports')).toBe(false);
    });

    test('offers it again once the cancellation has taken effect', () => {
        const wrapper = storeWith([reportsV1({ canceledAt: PAST, canceledEffectiveAt: PAST })]);
        expect(offered(wrapper, 'Reports')).toBe(true);
    });

    test('offers a different add-on beside it', () => {
        const wrapper = storeWith([reportsV1()], [REPORTS_V2, EXPORTS_V1]);
        expect(offered(wrapper, 'Exports')).toBe(true);
    });

    test('knows the add-on of a booking whose key the server did not send, from the catalogue', () => {
        const wrapper = storeWith([reportsV1({ bundleVersionId: 'bv-r2', bundleKey: null })]);
        expect(offered(wrapper, 'Reports')).toBe(false);
    });
});
