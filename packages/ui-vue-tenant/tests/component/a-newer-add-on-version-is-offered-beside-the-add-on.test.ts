// A newer version of a booked add-on, offered beside the booking in both
// places that list the tenant's add-ons: both versions side by side, the kind
// of offer and when a switch would take effect — and the switch, by one click
// for an improvement and after a question for anything that costs more or
// takes something away. A switch taken for the end of the term is said beside
// the booking until it is made.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { SubscriptionBundleShape } from '@saasicat/ui-vue';
import { ERROR_MESSAGES_DE, type BundleVersionOfferView } from '@saasicat/core';

import MySubscriptionBundlesPage from '../../src/MySubscriptionBundlesPage.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import { DEFAULT_I18N_DE, DEFAULT_I18N_EN } from '../../src/default-i18n.js';
import {
    aServer,
    confirmation,
    seatsV1,
    storeWith as storeKeptIn,
} from './support/add-on-bookings.js';

const sideOf = (bundleVersionId: string, version: number, monthlyNet: number, seats: number) => ({
    bundleVersionId,
    bundleKey: 'SEATS',
    label: 'Seats',
    version,
    features: ['SEATS'],
    quotas: { seats },
    monthlyNet,
    yearlyNet: 90,
});

function anOffer(
    kind: BundleVersionOfferView['class'],
    offered: { monthlyNet: number; seats: number },
    takesEffectAt = '2026-10-15T09:00:00.000Z',
): BundleVersionOfferView {
    return {
        subscriptionBundleId: 'sb-1',
        planKey: 'STANDARD',
        billingCycle: 'MONTHLY',
        bound: sideOf('bv-1', 1, 9, 5),
        offered: sideOf('bv-2', 2, offered.monthlyNet, offered.seats),
        class: kind,
        changes: [],
        takesEffectAt,
    };
}

const IMPROVEMENT = anOffer('improvement', { monthlyNet: 9, seats: 10 });
const MORE_FOR_MORE = anOffer('more-for-more', { monthlyNet: 11, seats: 10 });
const TAKES_AWAY = anOffer(
    'takes-something-away',
    { monthlyNet: 9, seats: 3 },
    '2026-11-01T00:00:00.000Z',
);

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

const storeWith = (booked: SubscriptionBundleShape[]) => storeKeptIn(booked, mounted);

const offerCards = (root: ParentNode) => [...root.querySelectorAll('.sp-version-offer')];

const tableRows = (card: Element) =>
    [...card.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
    );

/** The card's take button. */
const takeButton = (wrapper: VueWrapper, i18n = DEFAULT_I18N_EN) =>
    wrapper
        .findAll('.sp-version-offer button')
        .find(
            (candidate) =>
                candidate.text() === i18n.versionOfferTakeAction.replace('{version}', '2'),
        );

// @requirement SC-BUN-057 — A newer version of a booked add-on is offered beside the booking
describe('a newer add-on version, in the add-on store', () => {
    test('shows both versions side by side beside the booking, with its kind and when it takes effect', () => {
        const wrapper = storeWith([seatsV1({ offer: MORE_FOR_MORE })]);

        const [card] = offerCards(wrapper.element);
        expect(card, 'no offer beside the booking').toBeTruthy();
        const text = card!.textContent ?? '';
        expect(text).toContain('Version 2 of Seats');
        expect(text).toContain(DEFAULT_I18N_EN.versionOfferKindMoreForMore);
        expect(text).toContain(
            'This version of Seats offers more and costs more. A switch applies at once',
        );
        expect(text).toContain(DEFAULT_I18N_EN.versionOfferEffectiveNow);
        expect(tableRows(card!)).toEqual([
            [DEFAULT_I18N_EN.versionOfferPriceMonthly, '9.00 EUR', '11.00 EUR'],
            [DEFAULT_I18N_EN.versionOfferPriceYearly, '90.00 EUR', '90.00 EUR'],
            ['seats', '5', '10'],
        ]);
    });

    test('one that takes something away says the day it would take effect', () => {
        const wrapper = storeWith([seatsV1({ offer: TAKES_AWAY })]);

        const text = offerCards(wrapper.element)[0]!.textContent ?? '';
        expect(text).toContain(DEFAULT_I18N_EN.versionOfferKindTakesAway);
        expect(text).toContain('Takes effect: on 2026-11-01');
    });

    test('sits beside the booking it is about, after its retirement where one is told', () => {
        const retirement = {
            kind: 'bundle-version-retired' as const,
            tenantId: 't-1',
            subscriptionId: 'sub-1',
            subscriptionBundleId: 'sb-1',
            retirementId: 'r-1',
            planKey: 'STANDARD',
            retired: sideOf('bv-1', 1, 9, 5),
            replacement: sideOf('bv-2', 2, 11, 10),
            changes: [],
            billingCycle: 'MONTHLY',
            effectiveAt: '2027-02-01T00:00:00.000Z',
            lastDayToCancel: '2027-01-31',
        };
        // The replacement is the early switch's to offer; a version newer
        // than it, on sale since, stands beside the notice.
        const newerThanTheReplacement = { ...IMPROVEMENT, offered: sideOf('bv-3', 3, 9, 12) };
        const wrapper = storeWith([
            seatsV1({ retirement, offer: newerThanTheReplacement }),
            seatsV1({ id: 'sb-2', bundleVersionId: 'bv-r1', label: 'Reports' }),
        ]);

        const items = [...wrapper.element.querySelectorAll('.sp-bundle-store__booked li')];
        expect(items.map((item) => item.className.trim())).toEqual([
            'sp-plan-section__item',
            'sp-bundle-store__retired',
            'sp-bundle-store__offer',
            'sp-plan-section__item',
        ]);
    });

    test('is not shown where nothing newer is offered', () => {
        const wrapper = storeWith([seatsV1(), seatsV1({ id: 'sb-2', offer: null })]);

        expect(offerCards(wrapper.element)).toEqual([]);
    });

    test('a switch taken for the end of the term is said beside the booking', () => {
        const wrapper = storeWith([
            seatsV1({
                pendingBundleVersionId: 'bv-2',
                pendingVersionEffectiveAt: '2026-11-01T00:00:00.000Z',
                pendingVersion: 2,
            }),
        ]);

        expect(wrapper.find('.sp-bundle-store__pending').text()).toBe(
            'Seats switches to version 2 on 2026-11-01.',
        );
    });
});

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('taking a newer add-on version', () => {
    test('an improvement is taken by one click, naming the version shown', async () => {
        const wrapper = storeWith([seatsV1({ offer: IMPROVEMENT })]);

        await takeButton(wrapper as VueWrapper)!.trigger('click');

        expect(wrapper.emitted('takeOffer')).toEqual([['sb-1', 'bv-2']]);
    });

    test('more for more asks first, and closing the question takes nothing', async () => {
        const store = storeWith([seatsV1({ offer: MORE_FOR_MORE })]);

        await takeButton(store as VueWrapper)!.trigger('click');
        await flushPromises();
        const asked = confirmation();
        expect(asked.text).toContain(
            'The switch applies at once. For the rest of the booking’s current billing period the prorated difference is charged',
        );
        asked.button(DEFAULT_I18N_EN.bundlePreviewClose)!.click();
        await flushPromises();
        expect(store.emitted('takeOffer')).toBeUndefined();

        await takeButton(store as VueWrapper)!.trigger('click');
        await flushPromises();
        confirmation().button(DEFAULT_I18N_EN.versionOfferConfirmAction)!.click();
        await flushPromises();
        expect(store.emitted('takeOffer')).toEqual([['sb-1', 'bv-2']]);
    });

    test('one that takes something away asks first, with the add-on and the date', async () => {
        const store = storeWith([seatsV1({ offer: TAKES_AWAY })]);

        await takeButton(store as VueWrapper)!.trigger('click');
        await flushPromises();

        expect(confirmation().text).toContain(
            'The switch applies on 2026-11-01. From then Seats includes what the “New version” column shows',
        );
    });

    test('is written from the plan section, which says it went through', async () => {
        let taken = false;
        const http = aServer(
            () => [taken ? seatsV1({ bundleVersionId: 'bv-2' }) : seatsV1({ offer: IMPROVEMENT })],
            '/sb-1/version-offer/accept',
            () => {
                taken = true;
                return {
                    status: 200,
                    body: {
                        class: 'improvement',
                        subscriptionBundleId: 'sb-1',
                        fromBundleVersionId: 'bv-1',
                        bundleVersionId: 'bv-2',
                        immediate: true,
                        takesEffectAt: '2026-10-15T09:00:00.000Z',
                    },
                };
            },
        );
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http,
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate: (value: string | Date) => String(value).slice(0, 10),
                showBundleStore: true,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        await takeButton(wrapper as VueWrapper)!.trigger('click');
        await flushPromises();

        expect(http.asked).toContain(
            'POST /billing/subscription-bundles/sb-1/version-offer/accept {"bundleVersionId":"bv-2"}',
        );
        expect(wrapper.text()).toContain('Seats runs on version 2 now.');
        expect(offerCards(wrapper.element)).toEqual([]);
    });

    test('a switch for the end of the term is said with its date', async () => {
        const http = aServer(
            () => [seatsV1({ offer: TAKES_AWAY })],
            '/sb-1/version-offer/accept',
            () => ({
                status: 200,
                body: {
                    class: 'takes-something-away',
                    subscriptionBundleId: 'sb-1',
                    fromBundleVersionId: 'bv-1',
                    bundleVersionId: 'bv-2',
                    immediate: false,
                    takesEffectAt: '2026-11-01T00:00:00.000Z',
                },
            }),
        );
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http,
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate: (value: string | Date) => String(value).slice(0, 10),
                showBundleStore: true,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        await takeButton(wrapper as VueWrapper)!.trigger('click');
        await flushPromises();
        confirmation().button(DEFAULT_I18N_EN.versionOfferConfirmAction)!.click();
        await flushPromises();

        expect(wrapper.text()).toContain('Seats switches to version 2 on 2026-11-01.');
    });

    test('an offer that moved is refused in the reader’s language', async () => {
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http: aServer(
                    () => [seatsV1({ offer: IMPROVEMENT })],
                    '/sb-1/version-offer/accept',
                    () => ({
                        status: 409,
                        body: {
                            code: 'BUNDLE_VERSION_OFFER_CHANGED',
                            message: 'The offer changed since it was shown.',
                            params: { bundleVersionId: 'bv-2' },
                            offer: null,
                        },
                    }),
                ),
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate: (value: string | Date) => String(value).slice(0, 10),
                i18n: DEFAULT_I18N_DE,
                showBundleStore: true,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        await takeButton(wrapper as VueWrapper, DEFAULT_I18N_DE)!.trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain(ERROR_MESSAGES_DE.BUNDLE_VERSION_OFFER_CHANGED);
    });

    test('is written from the page of the tenant’s add-ons too', async () => {
        let taken = false;
        const http = aServer(
            () => [taken ? seatsV1({ bundleVersionId: 'bv-2' }) : seatsV1({ offer: IMPROVEMENT })],
            '/sb-1/version-offer/accept',
            () => {
                taken = true;
                return {
                    status: 200,
                    body: {
                        class: 'improvement',
                        subscriptionBundleId: 'sb-1',
                        fromBundleVersionId: 'bv-1',
                        bundleVersionId: 'bv-2',
                        immediate: true,
                        takesEffectAt: '2026-10-15T09:00:00.000Z',
                    },
                };
            },
        );
        const wrapper = mount(MySubscriptionBundlesPage, {
            attachTo: document.body,
            props: { billingEndpoint: '/api', http },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        expect(offerCards(wrapper.element)[0]!.closest('.msb-card')).not.toBeNull();
        await takeButton(wrapper as VueWrapper)!.trigger('click');
        await flushPromises();

        expect(http.asked).toContain(
            'POST /api/billing/subscription-bundles/sb-1/version-offer/accept {"bundleVersionId":"bv-2"}',
        );
        expect(wrapper.text()).toContain('runs on version 2 now.');
    });
});
