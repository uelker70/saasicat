// A newer version of the tenant's plan, offered beside it: both versions side
// by side, the kind of offer and when a switch would take effect — and the
// switch, by one click for an improvement and after a question for anything
// that costs more or takes something away. A refusal says why in the app's
// language, and an offer that moved is replaced by the one that stands.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { CatalogPlan, HttpClient } from '@saasicat/ui-vue';
import { ERROR_MESSAGES_DE, type VersionOfferView } from '@saasicat/core';

import TenantPlanSection from '../../src/TenantPlanSection.vue';
import { DEFAULT_I18N_DE } from '../../src/default-i18n.js';

const CATALOGUE_STANDARD: CatalogPlan = {
    id: 'STANDARD',
    name: 'Standard',
    tagline: '',
    monthlyNet: 49,
    yearlyNet: 490,
    popular: false,
    quotas: { users: 5, vehicles: 100 },
    features: ['DASHBOARD', 'EXPORT'],
};

const BOUND_SIDE = {
    planVersionId: 'pv-1',
    version: 1,
    features: ['DASHBOARD', 'EXPORT'],
    quotas: { users: 5, vehicles: 100 },
    monthlyNet: 49,
    yearlyNet: 490,
    validUntil: null,
    endsAt: null,
};

function anOffer(
    kind: VersionOfferView['class'],
    offered: Partial<VersionOfferView['offered']> = {},
    takesEffectAt = '2026-10-15T09:00:00.000Z',
): VersionOfferView {
    return {
        plan: 'STANDARD',
        bound: BOUND_SIDE,
        offered: { ...BOUND_SIDE, planVersionId: 'pv-2', version: 2, ...offered },
        class: kind,
        changes: [],
        takesEffectAt,
    };
}

const IMPROVEMENT = anOffer('improvement', {
    features: ['DASHBOARD', 'EXPORT', 'API'],
    quotas: { users: 5, vehicles: 150 },
});
const MORE_FOR_MORE = anOffer('more-for-more', {
    monthlyNet: 59,
    quotas: { users: 8, vehicles: 200 },
});
const TAKES_AWAY = anOffer(
    'takes-something-away',
    { features: ['DASHBOARD'], monthlyNet: 45, quotas: { users: 3, vehicles: 200 } },
    '2027-01-01T00:00:00.000Z',
);

function aSubscription(overrides: Record<string, unknown> = {}) {
    return {
        plan: 'STANDARD',
        effectivePlan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        currentPeriodStart: '2026-10-01T00:00:00.000Z',
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv-1',
            planId: 'STANDARD',
            version: 1,
            publishedAt: '2026-01-01T00:00:00.000Z',
            supersededAt: null,
            changeNote: null,
        },
        planPriceNet: 49,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: null,
        limits: { plan: 'STANDARD', quotas: { users: 5, vehicles: 100 }, features: ['DASHBOARD'] },
        usage: { users: 3 },
        packageSnapshot: null,
        retirement: null,
        retirementSwitch: null,
        checkoutOfferId: null,
        ...overrides,
    };
}

type Answer = { status: number; body: unknown };

/**
 * The tenant billing routes of one subscription. Taking the offer moves the
 * subscription the way the server does — bound to the version at once, or with
 * the change scheduled — and the offer read afterwards answers accordingly.
 */
function aServer(options: {
    offer: VersionOfferView | null;
    /** What the offer read answers instead of the offer, where it fails. */
    offerRead?: Answer;
    accept?: Answer;
    subscription?: Record<string, unknown>;
    /** What another administrator changed while this one was deciding. */
    movedMeanwhile?: Record<string, unknown>;
}) {
    // Widened to what the server may answer, since taking the offer moves it.
    const state: { offer: VersionOfferView | null; subscription: Record<string, unknown> } = {
        offer: options.offer,
        subscription: aSubscription(options.subscription),
    };
    const calls: { method: string; url: string; body: unknown }[] = [];
    const reply = ({ status, body }: Answer) => ({
        status,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    const http: HttpClient = async (url, init) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/version-offer/accept')) {
            if (options.movedMeanwhile) {
                state.subscription = { ...state.subscription, ...options.movedMeanwhile };
            }
            if (options.accept) return reply(options.accept);
            const taken = state.offer!;
            const immediate = taken.class !== 'takes-something-away';
            state.subscription = immediate
                ? {
                      ...state.subscription,
                      planVersion: {
                          ...(state.subscription.planVersion as Record<string, unknown>),
                          id: 'pv-2',
                          version: 2,
                      },
                  }
                : {
                      ...state.subscription,
                      pendingPlan: 'STANDARD',
                      pendingBillingCycle: 'MONTHLY',
                      pendingEffectiveAt: taken.takesEffectAt,
                  };
            state.offer = null;
            return reply({
                status: 201,
                body: {
                    class: taken.class,
                    fromPlanVersionId: 'pv-1',
                    planVersionId: 'pv-2',
                    immediate,
                    takesEffectAt: immediate ? '2026-10-15T09:00:00.000Z' : taken.takesEffectAt,
                },
            });
        }
        if (url.endsWith('/version-offer')) {
            return reply(options.offerRead ?? { status: 200, body: { offer: state.offer } });
        }
        if (url.endsWith('/usage')) return reply({ status: 200, body: state.subscription });
        if (url.endsWith('/plans')) return reply({ status: 200, body: [CATALOGUE_STANDARD] });
        return reply({ status: 200, body: [] });
    };
    return { http, calls };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

async function aSection(server: ReturnType<typeof aServer>) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: server.http,
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
            i18n: DEFAULT_I18N_DE,
        },
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const card = () => document.body.querySelector<HTMLElement>('.sp-version-offer');
const dialog = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel');
const takeButton = () =>
    card()!.querySelector<HTMLButtonElement>('.sp-version-offer__actions button')!;
const rowOf = (label: string) =>
    [...card()!.querySelectorAll('tbody tr')].find(
        (row) => row.querySelector('th')!.textContent!.trim() === label,
    );
const cellsOf = (label: string) =>
    [...rowOf(label)!.querySelectorAll('td')].map((cell) => cell.textContent!.trim());
const accepts = (server: ReturnType<typeof aServer>) =>
    server.calls.filter((call) => call.url.endsWith('/version-offer/accept'));

// @requirement SC-SUB-020 — A newer version is offered, classified against the version bound
describe('the offer beside the plan', () => {
    test('is not there where nothing is offered', async () => {
        await aSection(aServer({ offer: null }));
        expect(card()).toBeNull();
    });

    test('shows both versions side by side, with what is added and when a switch takes effect', async () => {
        await aSection(aServer({ offer: IMPROVEMENT }));

        const offer = card()!;
        const heading = offer.querySelector('h2')!;
        expect(heading.textContent!.trim()).toBe('Version 2 Ihres Pakets');
        expect(offer.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(offer.querySelector('.sp-badge')!.textContent!.trim()).toBe('Verbesserung');
        expect(offer.querySelector('caption')!.textContent!.trim()).toBe(
            'Ihre Version und die neue im Vergleich',
        );
        expect([...offer.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(
            ['Leistung', 'Ihre Version (1)', 'Neue Version (2)'],
        );
        expect(cellsOf('Preis monatlich (netto)')).toEqual(['€ 49.00', '€ 49.00']);
        expect(cellsOf('vehicles')).toEqual(['100', '150']);
        expect(offer.textContent).toContain('Kommt hinzu: API');
        expect(offer.textContent).not.toContain('Fällt weg');
        expect(offer.textContent).toContain('Wirksam: sofort nach dem Wechsel');
        expect(offer.textContent).toContain(
            'Sie müssen nichts tun: Ihre jetzige Version bleibt, solange Sie nicht wechseln.',
        );
    });

    test('says a rhythm the new version is not sold in, and an unlimited quota', async () => {
        const offer = anOffer('more-for-more', {
            yearlyNet: null,
            quotas: { users: -1, vehicles: 100 },
        });
        await aSection(aServer({ offer }));

        expect(cellsOf('Preis jährlich (netto)')).toEqual(['€ 490.00', 'nicht angeboten']);
        expect(cellsOf('users')).toEqual(['5', '∞']);
    });

    test('says what one that takes something away removes, and the date it would take effect', async () => {
        await aSection(aServer({ offer: TAKES_AWAY }));

        expect(card()!.querySelector('.sp-badge')!.textContent!.trim()).toBe('Schränkt ein');
        expect(card()!.textContent).toContain('Fällt weg: EXPORT');
        expect(card()!.textContent).toContain('Wirksam: zum 2027-01-01');
    });

    test('says so where the offer could not be read, rather than showing nothing', async () => {
        await aSection(
            aServer({
                offer: null,
                offerRead: { status: 503, body: { code: 'SUBSCRIPTION_CHANGED', message: 'x' } },
            }),
        );
        expect(card()).toBeNull();
        expect(document.body.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
            ERROR_MESSAGES_DE.SUBSCRIPTION_CHANGED,
        );
    });

    test('is not shown on a subscription that has ended', async () => {
        await aSection(
            aServer({
                offer: IMPROVEMENT,
                subscription: {
                    canceledAt: '2026-01-01T00:00:00.000Z',
                    canceledEffectiveAt: '2026-02-01T00:00:00.000Z',
                },
            }),
        );
        expect(card()).toBeNull();
    });
});

// @requirement SC-SUB-021 — A newer version is taken by naming it, the way its kind says
describe('taking it', () => {
    test('an improvement is taken by one click, and the page says so', async () => {
        const server = aServer({ offer: IMPROVEMENT });
        await aSection(server);

        takeButton().click();
        await flushPromises();

        expect(dialog()).toBeNull();
        expect(accepts(server).map((call) => [call.method, call.body])).toEqual([
            ['POST', { planVersionId: 'pv-2' }],
        ]);
        expect(document.body.querySelector('[role="status"]')!.textContent!.trim()).toBe(
            'Sie nutzen jetzt Version 2.',
        );
        expect(card()).toBeNull();
    });

    test('more for more asks first, and closing the question takes nothing', async () => {
        const server = aServer({ offer: MORE_FOR_MORE });
        await aSection(server);

        takeButton().click();
        await flushPromises();

        expect(dialog()!.textContent).toContain('Zu Version 2 wechseln?');
        expect(dialog()!.textContent).toContain('die anteilige Differenz berechnet');
        const [close] = [...dialog()!.querySelectorAll('button')].filter(
            (button) => button.textContent!.trim() === DEFAULT_I18N_DE.bundlePreviewClose,
        );
        close!.click();
        await flushPromises();
        expect(accepts(server)).toEqual([]);
    });

    test('one that takes something away asks first with the date, and is recorded for the term end', async () => {
        const server = aServer({ offer: TAKES_AWAY });
        await aSection(server);

        takeButton().click();
        await flushPromises();
        expect(dialog()!.textContent).toContain('Der Wechsel gilt zum 2027-01-01.');
        const confirm = [...dialog()!.querySelectorAll('button')].find(
            (button) => button.textContent!.trim() === 'Wechsel bestätigen',
        )!;
        confirm.click();
        await flushPromises();

        expect(accepts(server)).toHaveLength(1);
        expect(document.body.querySelector('[role="status"]')!.textContent!.trim()).toBe(
            'Der Wechsel zu Version 2 ist zum 2027-01-01 vorgemerkt.',
        );
        expect(document.body.textContent).toContain('Neue Version vorgemerkt');
        expect(document.body.textContent).not.toContain('Wechsel zu STANDARD');
    });

    test('an offer that moved is replaced by the one that stands, and the refusal is in the app language', async () => {
        const standing = anOffer('improvement', {
            planVersionId: 'pv-3',
            version: 3,
            quotas: { users: 5, vehicles: 300 },
        });
        const server = aServer({
            offer: IMPROVEMENT,
            accept: {
                status: 409,
                body: {
                    code: 'VERSION_OFFER_CHANGED',
                    message: 'The offer changed since it was shown.',
                    params: { planVersionId: 'pv-2' },
                    offer: standing,
                },
            },
        });
        await aSection(server);

        takeButton().click();
        await flushPromises();

        expect(card()!.querySelector('h2')!.textContent!.trim()).toBe('Version 3 Ihres Pakets');
        expect(document.body.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
            ERROR_MESSAGES_DE.VERSION_OFFER_CHANGED,
        );
    });

    test('after a refusal the page shows the subscription as it now stands, not as it was read', async () => {
        const standing = anOffer('improvement', { yearlyNet: 470 });
        const server = aServer({
            offer: IMPROVEMENT,
            movedMeanwhile: { billingCycle: 'YEARLY' },
            accept: {
                status: 409,
                body: {
                    code: 'VERSION_OFFER_CHANGED',
                    message: 'The offer changed since it was shown.',
                    offer: standing,
                },
            },
        });
        const wrapper = await aSection(server);
        expect(wrapper.find('.sp-plan-section__cycle').text()).toBe('Monatlich');

        takeButton().click();
        await flushPromises();

        const accepted = server.calls.findIndex((call) =>
            call.url.endsWith('/version-offer/accept'),
        );
        expect(server.calls.slice(accepted + 1).some((call) => call.url.endsWith('/usage'))).toBe(
            true,
        );
        expect(wrapper.find('.sp-plan-section__cycle').text()).toBe('Jährlich');
        // And it still says why the click did nothing: the offer read again
        // after the reload succeeds, and must not clear the refusal.
        expect(document.body.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
            ERROR_MESSAGES_DE.VERSION_OFFER_CHANGED,
        );
    });

    test('a refusal with no offer to show still says why', async () => {
        const server = aServer({
            offer: IMPROVEMENT,
            accept: {
                status: 403,
                body: {
                    code: 'TENANT_ADMIN_REQUIRED',
                    message: 'This action requires the TENANT_ADMIN role.',
                },
            },
        });
        await aSection(server);

        takeButton().click();
        await flushPromises();

        expect(document.body.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
            ERROR_MESSAGES_DE.TENANT_ADMIN_REQUIRED,
        );
        expect(card()).not.toBeNull();
    });
});
