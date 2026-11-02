// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, nextTick, type App } from 'vue';
import type {
    BundleVersionOfferWithDays,
    BundleVersionRetiredNoticeWithDays,
    SubscriptionBundleDays,
} from '@saasicat/core';
import {
    createSuperAdminI18n,
    type BundleAddPreviewShape,
    type BundleCancelPreviewShape,
    type HttpClient,
    type SubscriptionBundleShape,
} from '@saasicat/ui-vue';

import BundlePreviewDialog from '../../src/tenant-plan-section/BundlePreviewDialog.vue';
import MySubscriptionBundlesPage from '../../src/MySubscriptionBundlesPage.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n';
import {
    aServer,
    confirmation,
    seatsV1,
    storeWith as storeKeptIn,
} from './support/add-on-bookings.js';

// Every day the add-on pages write is a day the server named beside the
// moment, and the side of it the sentence means: what ends shows the last day
// it covers (`until`), what begins shows its first (`from`). The days here are
// set apart from each other and from the moment's own UTC date on purpose — a
// page that wrote the moment, or the other side, writes a day that appears
// nowhere in the answer as the right one.

/** A moment whose UTC date is neither of the days named beside it. */
const MOMENT = '2026-06-15T12:00:00.000Z';
const UNTIL = '2026-12-30';
const FROM = '2026-12-31';
const DAYS = { until: UNTIL, from: FROM };

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

/** What a page shows, as text. */
const text = (wrapper: { element: Element }) => wrapper.element.textContent ?? '';

/** Shows `expected` and neither the other side nor the moment's date. */
function showsOnly(shown: string, expected: string, written = (day: string) => day) {
    const other = expected === UNTIL ? FROM : UNTIL;
    expect(shown).toContain(written(expected));
    expect(shown).not.toContain(written(other));
    expect(shown).not.toContain(written(MOMENT.slice(0, 10)));
}

describe('a booking in the add-on store', () => {
    const store = (fields: Parameters<typeof seatsV1>[0], days: Partial<SubscriptionBundleDays>) =>
        storeKeptIn([{ ...seatsV1(fields), ...days }], mounted);

    test('runs its minimum term until the last day the server named', () => {
        const wrapper = store({ minimumTermEndsAt: MOMENT }, { minimumTermEndsDays: DAYS });
        showsOnly(text(wrapper), UNTIL);
    });

    test('a cancelled one runs until the last day of its cancellation', () => {
        const wrapper = store(
            { canceledAt: MOMENT, canceledEffectiveAt: MOMENT, minimumTermEndsAt: null },
            {
                canceledDays: { until: '2026-01-01', from: '2026-01-02' },
                canceledEffectiveDays: DAYS,
            },
        );
        showsOnly(text(wrapper), UNTIL);
    });

    test('a switch taken for the end of its term is said from the first day it applies', () => {
        const wrapper = store(
            {
                minimumTermEndsAt: null,
                pendingVersion: 2,
                pendingBundleVersionId: 'bv-2',
                pendingVersionEffectiveAt: MOMENT,
            },
            { pendingVersionEffectiveDays: DAYS },
        );
        showsOnly(text(wrapper), FROM);
    });
});

/** An add-on version's side of an offer or a retirement, priced and with its seats. */
const SEATS_SIDE = {
    bundleKey: 'SEATS',
    label: 'Seats',
    features: ['SEATS'],
    quotas: { seats: 5 },
    monthlyNet: 9,
    yearlyNet: 90,
};

describe('beside a booking in the add-on store', () => {
    const side = (bundleVersionId: string, version: number) => ({
        bundleVersionId,
        bundleKey: 'SEATS',
        label: 'Seats',
        version,
        features: ['SEATS'],
        quotas: { seats: version * 5 },
        monthlyNet: 9,
        yearlyNet: 90,
    });

    test('a retirement says from the first day the server named that the booking moves on', () => {
        const retirement: BundleVersionRetiredNoticeWithDays = {
            kind: 'bundle-version-retired',
            tenantId: 't-1',
            subscriptionId: 'sub-1',
            subscriptionBundleId: 'sb-1',
            retirementId: 'r-1',
            planKey: 'STANDARD',
            retired: side('bv-1', 1),
            replacement: side('bv-2', 2),
            changes: [],
            billingCycle: 'MONTHLY',
            effectiveAt: MOMENT,
            effectiveDays: DAYS,
            lastDayToCancel: '2026-01-31',
        };
        const wrapper = storeKeptIn([seatsV1({ minimumTermEndsAt: null, retirement })], mounted);
        showsOnly(wrapper.find('.sp-bundle-retired').text(), FROM);
    });

    test('a newer version that takes something away takes effect from the first day named', () => {
        const offer: BundleVersionOfferWithDays = {
            subscriptionBundleId: 'sb-1',
            planKey: 'STANDARD',
            billingCycle: 'MONTHLY',
            bound: side('bv-1', 1),
            offered: side('bv-2', 2),
            class: 'takes-something-away',
            changes: [],
            takesEffectAt: MOMENT,
            takesEffectDays: DAYS,
        };
        const wrapper = storeKeptIn([seatsV1({ minimumTermEndsAt: null, offer })], mounted);
        showsOnly(wrapper.find('.sp-version-offer').text(), FROM);
    });
});

describe('the preview of a booking and of its cancellation', () => {
    /** The tenant's English catalogue, provided the way the plan section provides it. */
    const inEnglish = {
        install: (app: App) =>
            app.provide(
                TENANT_I18N_KEY,
                computed(() => defaultTenantPlanSectionI18n('en')),
            ),
    };
    function mountPreview(preview: BundleAddPreviewShape | BundleCancelPreviewShape) {
        const wrapper = mount(BundlePreviewDialog, {
            attachTo: document.body,
            global: { plugins: [inEnglish] },
            props: {
                modelValue: true,
                preview,
                loading: false,
                error: null,
                submitting: false,
                subscriptionStatus: 'ACTIVE',
                formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
                formatDate: (iso: string) => iso.slice(0, 10),
                featureLabel: (key: string) => key,
            },
        });
        mounted.push(wrapper);
    }
    const panel = () => document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
    const BUNDLE = {
        bundleVersionId: 'bv-1',
        bundleKey: 'ANALYTICS',
        label: 'Analytics',
        features: [],
        quotas: {},
    };
    const ADD: BundleAddPreviewShape = {
        action: 'add',
        bundle: BUNDLE,
        billingCycle: 'MONTHLY',
        blockers: [],
        warnings: [],
        proration: null,
        nextPeriodPriceNet: 900,
        minimumTermMonths: 0,
        minimumTermEndsAt: null,
        minimumTermEndsDays: null,
        firstPeriodEnd: null,
        firstPeriodEndDays: null,
        endsWithPlanAt: null,
        endsWithPlanDays: null,
        missingRequires: [],
        redundantFeatures: [],
    };

    for (const [what, fields] of [
        ['the first period', { firstPeriodEnd: MOMENT, firstPeriodEndDays: DAYS }],
        [
            'the minimum term',
            { minimumTermMonths: 12, minimumTermEndsAt: MOMENT, minimumTermEndsDays: DAYS },
        ],
        ['the end with the plan', { endsWithPlanAt: MOMENT, endsWithPlanDays: DAYS }],
    ] as const) {
        test(`names the last day of ${what}`, async () => {
            mountPreview({ ...ADD, ...fields });
            await nextTick();
            showsOnly(panel(), UNTIL);
        });
    }

    test('names the last day before a cancellation takes effect', async () => {
        mountPreview({
            action: 'cancel',
            subscriptionBundleId: 'sb-1',
            bundle: BUNDLE,
            billingCycle: 'MONTHLY',
            effectiveAt: MOMENT,
            effectiveDays: DAYS,
            nextPeriodSavingsNet: 900,
            blockers: [],
            warnings: [],
        });
        await nextTick();
        showsOnly(panel(), UNTIL);
        // An ending day is the last one the booking still runs, so the sentence
        // says it ends with that day rather than "as of" it.
        expect(panel()).toContain('Cancellation takes effect at the end of');
    });
});

describe('a booking on the page of the tenant’s add-ons', () => {
    const intlLocale = createSuperAdminI18n().intlLocale.value;
    /** A day as the page writes it, in the language it shows. */
    const written = (day: string) => {
        const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
        return new Date(year, month - 1, date, 12).toLocaleDateString(intlLocale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    };

    async function pageOver(booking: SubscriptionBundleShape) {
        const http: HttpClient = async () => ({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => [booking],
            text: async () => JSON.stringify([booking]),
        });
        const wrapper = mount(MySubscriptionBundlesPage, {
            props: { billingEndpoint: '/api', http },
        });
        mounted.push(wrapper);
        await flushPromises();
        return text(wrapper);
    }

    test('is booked since the first day the server named', async () => {
        const shown = await pageOver({
            ...seatsV1({ startedAt: MOMENT, minimumTermEndsAt: null }),
            startedDays: DAYS,
        });
        showsOnly(shown, FROM, written);
    });

    test('runs its minimum term until the last day the server named', async () => {
        const shown = await pageOver({
            ...seatsV1({ minimumTermEndsAt: MOMENT }),
            startedDays: { until: '2026-01-01', from: '2026-01-02' },
            minimumTermEndsDays: DAYS,
        });
        showsOnly(shown, UNTIL, written);
    });

    test('a cancelled one was cancelled on its day, and runs until the last day of it', async () => {
        const shown = await pageOver({
            ...seatsV1({
                canceledAt: MOMENT,
                canceledEffectiveAt: MOMENT,
                minimumTermEndsAt: null,
            }),
            startedDays: { until: '2026-01-01', from: '2026-01-02' },
            canceledDays: { until: '2026-07-01', from: '2026-07-02' },
            canceledEffectiveDays: DAYS,
        });
        expect(shown).toContain(written('2026-07-02'));
        showsOnly(shown, UNTIL, written);
    });
});

describe('an answer from a server that names no days yet', () => {
    test('a switch it took is said as taken, with a dash for the day it does not name', async () => {
        const offer: BundleVersionOfferWithDays = {
            subscriptionBundleId: 'sb-1',
            planKey: 'STANDARD',
            billingCycle: 'MONTHLY',
            bound: { ...SEATS_SIDE, bundleVersionId: 'bv-1', version: 1 },
            offered: { ...SEATS_SIDE, bundleVersionId: 'bv-2', version: 2 },
            class: 'takes-something-away',
            changes: [],
            takesEffectAt: MOMENT,
            takesEffectDays: DAYS,
        };
        // What a server from before the days answers once the switch is written.
        const http = aServer(
            () => [seatsV1({ minimumTermEndsAt: null, offer })],
            '/sb-1/version-offer/accept',
            () => ({
                status: 200,
                body: {
                    class: 'takes-something-away',
                    subscriptionBundleId: 'sb-1',
                    fromBundleVersionId: 'bv-1',
                    bundleVersionId: 'bv-2',
                    immediate: false,
                    takesEffectAt: MOMENT,
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
        mounted.push(wrapper);
        await flushPromises();

        const take = wrapper
            .findAll('.sp-version-offer button')
            .find((button) => button.text() === 'Switch to version 2');
        await take!.trigger('click');
        await flushPromises();
        confirmation().button('Confirm the switch')!.click();
        await flushPromises();

        expect(wrapper.text()).toContain('Seats switches to version 2 on —.');
    });
});
