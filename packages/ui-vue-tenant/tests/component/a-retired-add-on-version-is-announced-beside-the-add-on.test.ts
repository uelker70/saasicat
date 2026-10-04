// The version of an add-on a tenant has booked is being retired, and both
// places that list the tenant's add-ons say so beside the add-on: when the
// booking continues on the replacement, what changes at the prices for its
// plan, and until when it may be cancelled without its minimum term. What it
// says is the notice the subscriber was told, read off the bookings the server
// answers. A booking whose reinstatement the platform refuses is told why in
// the reader's language.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { CatalogBundle, HttpClient, SubscriptionBundleShape } from '@saasicat/ui-vue';

import MySubscriptionBundlesPage from '../../src/MySubscriptionBundlesPage.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import TenantBundleStore from '../../src/tenant-plan-section/TenantBundleStore.vue';
import { DEFAULT_I18N_DE, DEFAULT_I18N_EN } from '../../src/default-i18n.js';

const side = (bundleVersionId: string, version: number, monthlyNet: number, seats: number) => ({
    bundleVersionId,
    bundleKey: 'SEATS',
    label: 'Seats',
    version,
    features: ['SEATS'],
    quotas: { seats },
    monthlyNet,
    yearlyNet: 90,
});

const RETIREMENT = {
    kind: 'bundle-version-retired' as const,
    tenantId: 't-1',
    subscriptionId: 'sub-1',
    subscriptionBundleId: 'sb-1',
    retirementId: 'r-1',
    planKey: 'STANDARD',
    retired: side('bv-1', 1, 9, 5),
    replacement: side('bv-2', 2, 11, 10),
    changes: [],
    billingCycle: 'MONTHLY',
    effectiveAt: '2027-02-01T00:00:00.000Z',
    lastDayToCancel: '2027-01-31',
};

/** A booking of Seats version 1; `fields` say what else holds. */
function seatsV1(fields: Partial<SubscriptionBundleShape> = {}): SubscriptionBundleShape {
    return {
        id: 'sb-1',
        subscriptionId: 'sub-1',
        bundleVersionId: 'bv-1',
        bundleKey: 'SEATS',
        label: 'Seats',
        priceNet: 9,
        billingCycle: 'MONTHLY',
        startedAt: '2026-01-10T00:00:00.000Z',
        minimumTermEndsAt: '2027-12-31T00:00:00.000Z',
        canceledAt: null,
        canceledEffectiveAt: null,
        ...fields,
    };
}

const REPORTS: CatalogBundle = {
    bundleVersionId: 'bv-r1',
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

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

const day = (iso: string) => iso.slice(0, 10);

function storeWith(booked: SubscriptionBundleShape[]) {
    const wrapper = mount(TenantBundleStore, {
        props: {
            booked,
            available: [REPORTS],
            planFeatures: [],
            planCycle: 'MONTHLY',
            formatCurrency: (n: number) => `${n.toFixed(2)} EUR`,
            formatDate: day,
            featureLabel: (key: string) => key,
            quotaLabel: (key: string) => key,
            formatQuotaValue: (_key: string, value: number) => String(value),
            buyingId: null,
            cancelingId: null,
            reactivatingId: null,
            error: null,
        },
    });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

const notices = (root: ParentNode) => [...root.querySelectorAll('.sp-bundle-retired')];

const tableRows = (notice: Element) =>
    [...notice.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
    );

// @requirement SC-BUN-046 — A tenant sees the retirement of an add-on's version beside the add-on
describe('a retired add-on version, in the add-on store', () => {
    test('says when the booking moves on, to which version, at what price, and until when it may go', () => {
        const wrapper = storeWith([seatsV1({ retirement: RETIREMENT })]);

        const [notice] = notices(wrapper.element);
        expect(notice, 'no notice beside the booking').toBeTruthy();
        const text = notice!.textContent ?? '';
        expect(text).toContain('Version 1 of Seats is being retired');
        expect(text).toContain('From 2027-02-01, Seats continues on version 2');
        expect(tableRows(notice!)).toEqual([
            [DEFAULT_I18N_EN.versionOfferPriceMonthly, '9.00 EUR', '11.00 EUR'],
            [DEFAULT_I18N_EN.versionOfferPriceYearly, '90.00 EUR', '90.00 EUR'],
            ['seats', '5', '10'],
        ]);
        expect(text).toContain(
            'Up to and including 2027-01-31, you may cancel Seats without its minimum term',
        );
    });

    test('sits directly after the booking it is about', () => {
        const wrapper = storeWith([
            seatsV1({ retirement: RETIREMENT }),
            seatsV1({ id: 'sb-2', bundleVersionId: 'bv-r1', label: 'Reports', retirement: null }),
        ]);

        const items = [...wrapper.element.querySelectorAll('.sp-bundle-store__booked li')];
        expect(items.map((item) => item.classList.contains('sp-bundle-store__retired'))).toEqual([
            false,
            true,
            false,
        ]);
        expect(items[0]!.textContent).toContain('Seats');
        expect(items[2]!.textContent).toContain('Reports');
    });

    test('is not shown where the version booked is not being retired', () => {
        const wrapper = storeWith([seatsV1(), seatsV1({ id: 'sb-2', retirement: null })]);

        expect(notices(wrapper.element)).toEqual([]);
    });
});

/** A server answering the tenant's bookings list with `bookings`. */
function aBookingsServer(bookings: unknown[]): HttpClient {
    return async () => ({
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => bookings,
        text: async () => JSON.stringify(bookings),
    });
}

// @requirement SC-BUN-046 — A tenant sees the retirement of an add-on's version beside the add-on
describe('a retired add-on version, on the page of the tenant’s add-ons', () => {
    test('is said on the booking it is about, in the app’s money where the app gives it', async () => {
        const wrapper = mount(MySubscriptionBundlesPage, {
            props: {
                billingEndpoint: '/api',
                http: aBookingsServer([{ ...seatsV1(), retirement: RETIREMENT }]),
                formatCurrency: (n: number) => `${n.toFixed(2)} CHF`,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        const [notice] = notices(wrapper.element);
        expect(notice, 'no notice on the booking').toBeTruthy();
        expect(notice!.closest('.msb-card')).not.toBeNull();
        expect(tableRows(notice!)[0]!.slice(1)).toEqual(['9.00 CHF', '11.00 CHF']);
    });

    test('guesses no currency where the app gives no formatter', async () => {
        const wrapper = mount(MySubscriptionBundlesPage, {
            props: {
                billingEndpoint: '/api',
                http: aBookingsServer([{ ...seatsV1(), retirement: RETIREMENT }]),
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        const [notice] = notices(wrapper.element);
        const [, retired, replacement] = tableRows(notice!)[0]!;
        expect(retired).toMatch(/^9[.,]00$/);
        expect(replacement).toMatch(/^11[.,]00$/);
    });

    test('is not shown on a booking whose version is not being retired', async () => {
        const wrapper = mount(MySubscriptionBundlesPage, {
            props: { billingEndpoint: '/api', http: aBookingsServer([seatsV1()]) },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        expect(wrapper.element.querySelector('.msb-card')).not.toBeNull();
        expect(notices(wrapper.element)).toEqual([]);
    });
});

/** A JSON answer with `status`. */
const reply = (status: number, body: unknown) => ({
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
});

const USAGE = {
    plan: 'STANDARD',
    effectivePlan: 'STANDARD',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    limits: { plan: 'STANDARD', quotas: {}, features: [] },
    usage: {},
};

/**
 * A server holding `bookings`, answering a request to `endsWith` with
 * `answer` — and recording what was asked.
 */
function aServer(
    bookings: () => unknown[],
    endsWith: string,
    answer: () => { status: number; body: unknown },
): HttpClient & { asked: string[] } {
    const asked: string[] = [];
    const client = async (url: string, init?: { method?: string; body?: string }) => {
        asked.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
        if (url.endsWith(endsWith) && init?.method === 'POST') {
            const { status, body } = answer();
            return reply(status, body);
        }
        if (url.endsWith('/subscription-bundles')) return reply(200, bookings());
        if (url.endsWith('/bundles')) return reply(200, [REPORTS]);
        if (url.endsWith('/usage')) return reply(200, USAGE);
        return reply(200, []);
    };
    return Object.assign(client, { asked }) as HttpClient & { asked: string[] };
}

/**
 * The plan section of a subscription holding a cancelled booking of Seats
 * version 1, whose reinstatement the server refuses with `refusal`.
 */
function aRefusingServer(refusal: { code: string; message: string; params: object }): HttpClient {
    return aServer(
        () => [
            seatsV1({
                canceledAt: '2026-10-01T00:00:00.000Z',
                canceledEffectiveAt: '2026-11-01T00:00:00.000Z',
            }),
        ],
        '/reactivate',
        () => ({ status: 422, body: refusal }),
    );
}

describe('a booking the platform will not reinstate', () => {
    // @requirement SC-BUN-048 — A booking a retirement did not reach is not reinstated on the retired version
    test('is told why in the reader’s language', async () => {
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http: aRefusingServer({
                    code: 'BUNDLE_RETIREMENT_REINSTATE_REFUSED',
                    message: 'Version 1 of SEATS is being retired.',
                    params: {
                        bundleKey: 'SEATS',
                        version: 1,
                        replacementVersion: 2,
                        bookableFrom: '2026-11-01',
                    },
                }),
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate: (value: string | Date) => String(value).slice(0, 10),
                i18n: DEFAULT_I18N_DE,
                showBundleStore: true,
            },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        const reactivate = wrapper
            .findAll('button')
            .find((button) => button.text() === DEFAULT_I18N_DE.bundleReactivateAction);
        expect(reactivate, 'no reactivate button on the cancelled booking').toBeTruthy();
        await reactivate!.trigger('click');
        await flushPromises();
        const confirm = [...document.body.querySelectorAll('.sp-dialog__panel button')].find(
            (button) => button.textContent?.trim() === DEFAULT_I18N_DE.bundleReactivateAction,
        ) as HTMLButtonElement | undefined;
        expect(confirm, 'no confirmation').toBeTruthy();
        confirm!.click();
        await flushPromises();

        expect(wrapper.text()).toContain(
            'Version 1 von SEATS wird stillgelegt, und diese Buchung endet, bevor sie umziehen würde. Buchen Sie Version 2 ab dem 2026-11-01, wenn diese Buchung beendet ist.',
        );
    });
});

/** What switching Seats now costs: 9 a month held until 31 January, 11 from 1 February. */
const HELD = {
    priceNet: 11,
    held: { priceNet: 9, amountNet: 2, lastDay: '2027-01-31' },
    billingCycle: 'MONTHLY',
};

/** The booking of Seats version 1, told of its retirement, as the server lists it while it may switch. */
const switchable = (fields: Partial<SubscriptionBundleShape> = {}) =>
    seatsV1({ retirement: RETIREMENT, retirementSwitch: HELD, ...fields });

/** The confirmation open in the document, and its buttons by their words. */
function confirmation() {
    const panel = document.body.querySelector('.sp-dialog__panel');
    const button = (words: string) =>
        [...(panel?.querySelectorAll('button') ?? [])].find(
            (candidate) => candidate.textContent?.trim() === words,
        ) as HTMLButtonElement | undefined;
    return { text: panel?.textContent ?? '', button };
}

/** Clicks the notice's switch, and the confirmation's. */
async function switchAndConfirm(wrapper: VueWrapper, i18n = DEFAULT_I18N_EN) {
    const button = wrapper
        .findAll('.sp-bundle-retired button')
        .find((candidate) => candidate.text() === i18n.versionRetiredSwitch);
    expect(button, 'no switch beside the notice').toBeTruthy();
    await button!.trigger('click');
    await flushPromises();
    const confirm = confirmation().button(i18n.versionRetiredSwitchConfirm);
    expect(confirm, 'no confirmation').toBeTruthy();
    confirm!.click();
    await flushPromises();
}

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('the switch beside a retired add-on version', () => {
    test('says before it is taken what it holds until the day, and what it gives up', async () => {
        const wrapper = storeWith([switchable()]);

        const button = wrapper
            .findAll('.sp-bundle-retired button')
            .find((candidate) => candidate.text() === DEFAULT_I18N_EN.versionRetiredSwitch);
        await button!.trigger('click');
        await flushPromises();
        const { text } = confirmation();

        const unit = DEFAULT_I18N_EN.wizardPriceUnitMonthly;
        expect(text).toContain(
            `Seats runs on version 2 from now on. Up to and including 2027-01-31 you keep paying 9.00 EUR ${unit} for it, from 2027-02-01 11.00 EUR ${unit}.`,
        );
        expect(text).toContain(DEFAULT_I18N_EN.bundleRetiredSwitchCancelLapses);
    });

    test('names the next period where nothing is held, and switches to the version shown', async () => {
        const wrapper = storeWith([
            switchable({
                retirementSwitch: { priceNet: 8, held: null, billingCycle: 'MONTHLY' },
                currentPeriodEnd: '2026-11-01T00:00:00.000Z',
            }),
        ]);

        const button = wrapper
            .findAll('.sp-bundle-retired button')
            .find((candidate) => candidate.text() === DEFAULT_I18N_EN.versionRetiredSwitch);
        await button!.trigger('click');
        await flushPromises();
        expect(confirmation().text).toContain(
            `From its next billing period on 2026-11-01, you pay 8.00 EUR ${DEFAULT_I18N_EN.wizardPriceUnitMonthly} for it.`,
        );
        confirmation().button(DEFAULT_I18N_EN.versionRetiredSwitchConfirm)!.click();
        await flushPromises();

        expect(wrapper.emitted('switch')).toEqual([['sb-1', 'bv-2']]);
    });

    test('names the rhythm the booking is billed in now, where its notice was told in another', async () => {
        const wrapper = storeWith([
            switchable({ retirementSwitch: { ...HELD, billingCycle: 'YEARLY' } }),
        ]);

        const button = wrapper
            .findAll('.sp-bundle-retired button')
            .find((candidate) => candidate.text() === DEFAULT_I18N_EN.versionRetiredSwitch);
        await button!.trigger('click');
        await flushPromises();

        const unit = DEFAULT_I18N_EN.wizardPriceUnitYearly;
        expect(confirmation().text).toContain(
            `you keep paying 9.00 EUR ${unit} for it, from 2027-02-01 11.00 EUR ${unit}.`,
        );
    });

    test('is not offered where the booking may not switch', () => {
        const wrapper = storeWith([switchable({ retirementSwitch: null })]);

        expect(notices(wrapper.element)).toHaveLength(1);
        expect(
            wrapper
                .findAll('.sp-bundle-retired button')
                .some((candidate) => candidate.text() === DEFAULT_I18N_EN.versionRetiredSwitch),
        ).toBe(false);
    });

    test('is written from the plan section, which says it went through', async () => {
        let switched = false;
        const http = aServer(
            () => [switched ? seatsV1({ bundleVersionId: 'bv-2' }) : switchable()],
            '/sb-1/retirement/switch',
            () => {
                switched = true;
                return { status: 200, body: { heldUntilDay: '2027-01-31' } };
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

        await switchAndConfirm(wrapper as VueWrapper);

        expect(http.asked).toContain(
            'POST /billing/subscription-bundles/sb-1/retirement/switch {"bundleVersionId":"bv-2"}',
        );
        expect(wrapper.text()).toContain('Seats runs on version 2 now.');
        expect(notices(wrapper.element)).toEqual([]);
    });

    test('is refused in the reader’s language where the plan changes before the date', async () => {
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http: aServer(
                    () => [switchable()],
                    '/sb-1/retirement/switch',
                    () => ({
                        status: 422,
                        body: {
                            code: 'BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES',
                            message: 'Seats moves to its new version on 2027-02-01.',
                            params: { bundleName: 'Seats', date: '2027-02-01' },
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

        await switchAndConfirm(wrapper as VueWrapper, DEFAULT_I18N_DE);

        expect(wrapper.text()).toContain(
            'Seats zieht am 2027-02-01 auf seine neue Version um, und Ihr Paket ändert sich vorher.',
        );
    });

    test('is written from the page of the tenant’s add-ons too', async () => {
        let switched = false;
        const http = aServer(
            () => [switched ? seatsV1({ bundleVersionId: 'bv-2' }) : switchable()],
            '/sb-1/retirement/switch',
            () => {
                switched = true;
                return { status: 200, body: { heldUntilDay: '2027-01-31' } };
            },
        );
        const wrapper = mount(MySubscriptionBundlesPage, {
            attachTo: document.body,
            props: { billingEndpoint: '/api', http },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        await switchAndConfirm(wrapper as VueWrapper);

        expect(http.asked).toContain(
            'POST /api/billing/subscription-bundles/sb-1/retirement/switch {"bundleVersionId":"bv-2"}',
        );
        expect(wrapper.text()).toContain('runs on version 2 now.');
    });
});
