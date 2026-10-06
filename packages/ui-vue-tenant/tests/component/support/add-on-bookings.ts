// What the component tests of a booked add-on stand on: a booking of Seats
// version 1, the add-on store and a server that lists bookings and answers one
// request, and the confirmation dialog a switch opens.

import { mount, type VueWrapper } from '@vue/test-utils';
import type { CatalogBundle, HttpClient, SubscriptionBundleShape } from '@saasicat/ui-vue';

import TenantBundleStore from '../../../src/tenant-plan-section/TenantBundleStore.vue';

/** A booking of Seats version 1; `fields` say what else holds. */
export function seatsV1(fields: Partial<SubscriptionBundleShape> = {}): SubscriptionBundleShape {
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

/** An add-on the catalogue sells beside Seats. */
export const REPORTS: CatalogBundle = {
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

/** The day of an ISO instant, as the tests format dates. */
export const day = (iso: string): string => iso.slice(0, 10);

/** The add-on store over `booked`, kept in `mounted` for the test to unmount. */
export function storeWith(booked: SubscriptionBundleShape[], mounted: VueWrapper[]) {
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

/** A JSON answer with `status`. */
export const reply = (status: number, body: unknown) => ({
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
 * A server holding `bookings`, answering a POST to `endsWith` with `answer` —
 * and recording what was asked.
 */
export function aServer(
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

/** The confirmation open in the document, and its buttons by their words. */
export function confirmation() {
    const panel = document.body.querySelector('.sp-dialog__panel');
    const button = (words: string) =>
        [...(panel?.querySelectorAll('button') ?? [])].find(
            (candidate) => candidate.textContent?.trim() === words,
        ) as HTMLButtonElement | undefined;
    return { text: panel?.textContent ?? '', button };
}
