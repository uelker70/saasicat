// A feature the subscription holds is withdrawn for a reason outside the
// platform, and the plan section says so beside the plan: why, from when, what
// each line is reduced by, and — while it is missing — that the subscription
// or an add-on may end at once, with what that credits read before the click.
// Wherever the section names the feature as part of what a plan includes, it
// marks it as not available for the time being rather than as not included.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { HttpClient } from '@saasicat/ui-vue';

import MySubscriptionBundlesPage from '../../src/MySubscriptionBundlesPage.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import WithdrawnFeatureMark from '../../src/WithdrawnFeatureMark.vue';
import { DEFAULT_I18N_DE, DEFAULT_I18N_EN } from '../../src/default-i18n.js';
import { provideWithdrawnFeatures } from '../../src/withdrawn-features.js';

const i18n = DEFAULT_I18N_DE;
const REASON = 'Der Exportdienst wurde abgeschaltet.';

const WITHDRAWAL = {
    withdrawalId: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Datenexport',
    reason: REASON,
    effectiveFrom: '2026-07-01T00:00:00.000Z',
    liftedFrom: null,
    inEffect: true,
    lines: [
        {
            line: 'plan',
            key: 'STANDARD',
            label: 'Standard',
            subscriptionBundleId: null,
            billingCycle: 'MONTHLY',
            reductionNet: 5,
            reduced: true,
        },
        {
            line: 'bundle',
            key: 'EXPORT_PLUS',
            label: 'Export plus',
            subscriptionBundleId: 'sb-1',
            billingCycle: 'YEARLY',
            reductionNet: null,
            reduced: true,
        },
    ],
    specialTerms: false,
    endable: { subscription: true, subscriptionBundleIds: ['sb-1'] },
};

function aSubscription() {
    return {
        plan: 'STANDARD',
        effectivePlan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        currentPeriodStart: '2026-07-01T00:00:00.000Z',
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: null,
        planPriceNet: 49,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: null,
        // The platform grants a withdrawn feature to nobody.
        limits: { plan: 'STANDARD', quotas: {}, features: ['DASHBOARD'] },
        usage: {},
        packageSnapshot: null,
        retirement: null,
        retirementSwitch: null,
        checkoutOfferId: null,
    };
}

const REGISTRY = {
    DASHBOARD: { label: 'Dashboard', description: '', icon: '' },
    EXPORT: {
        label: 'Datenexport',
        description: '',
        icon: '',
        withdrawn: [{ reason: REASON, effectiveFrom: WITHDRAWAL.effectiveFrom, liftedFrom: null }],
    },
};

interface Server {
    http: HttpClient;
    /** Every request beyond the page's own loading, by method and path. */
    asked: string[];
}

function aServer({
    withdrawals = [WITHDRAWAL] as unknown,
    listStatus = 200,
    previewStatus = 200,
} = {}): Server {
    const asked: string[] = [];
    const reply = (body: unknown, status = 200) => ({
        status,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    const http: HttpClient = async (url, init) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/feature-withdrawals/')) asked.push(`${method} ${url}`);
        if (url.endsWith('/end')) {
            const booking = url.includes('/bookings/');
            if (method === 'GET' && previewStatus !== 200) {
                return reply(
                    { code: 'FEATURE_WITHDRAWAL_NOT_IN_EFFECT', params: { featureKey: 'EXPORT' } },
                    previewStatus,
                );
            }
            const answer = {
                endsAt: '2026-07-10T09:00:00.000Z',
                creditNet: booking ? 0 : 33.87,
                currency: 'EUR',
            };
            return reply(
                method === 'POST'
                    ? {
                          ...answer,
                          withdrawalId: 'fw-1',
                          subscriptionBundleId: booking ? 'sb-1' : null,
                      }
                    : answer,
            );
        }
        if (url.endsWith('/feature-withdrawals')) return reply(withdrawals, listStatus);
        if (url.endsWith('/usage')) return reply(aSubscription());
        if (url.endsWith('/feature-registry')) return reply(REGISTRY);
        if (url.endsWith('/version-offer')) return reply({ offer: null });
        return reply([]);
    };
    return { http, asked };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

async function aSection(server: Server) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: server.http,
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
            showFeatureMatrix: true,
            i18n,
        },
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const card = () => document.body.querySelector<HTMLElement>('.sp-feature-withdrawn');
const dialogText = () => document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
const buttonNamed = (wrapper: VueWrapper, label: string) =>
    wrapper.findAll('button').find((button) => button.text() === label);
const dialogButtonNamed = (label: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>('.sp-dialog__panel button')].find(
        (button) => button.textContent?.trim() === label,
    );

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('a withdrawn feature, beside the plan', () => {
    test('says why, from when, and what each line is reduced by', async () => {
        await aSection(aServer());

        const text = card()?.textContent ?? '';
        expect(text).toContain('Datenexport steht seit dem 2026-07-01 nicht zur Verfügung');
        expect(text).toContain(`Grund: ${REASON}`);
        expect(text).toContain(
            'Standard (Monatlich): Sie zahlen € 5.00 netto/Monat weniger, solange es fehlt.',
        );
        expect(text).toContain('Export plus (Jährlich): Der Preis bleibt unverändert.');
        expect(text).toContain(i18n.featureWithdrawnEndRight);
    });

    test('is not shown where the installation does not withdraw features', async () => {
        await aSection(aServer({ listStatus: 404 }));

        expect(card()).toBeNull();
        expect(document.body.textContent).not.toContain('Error');
    });

    // @requirement SC-UI-020 — A page never takes the whole screen down because data arrived in an unexpected shape
    test('says it could not read them where the route answers something else, and keeps the page', async () => {
        await aSection(aServer({ withdrawals: [{ id: 'sb-1', label: 'Seats' }] }));

        expect(card()).toBeNull();
        expect(document.body.textContent).toContain(i18n.featureWithdrawnLoadFailed);
        expect(document.body.querySelector('.sp-plan-section__card')).not.toBeNull();
    });

    test('is not shown where nothing is withdrawn', async () => {
        await aSection(aServer({ withdrawals: [] }));

        expect(card()).toBeNull();
    });

    test('says from when it will be missing, when it returns, and what a change or special terms mean', async () => {
        await aSection(
            aServer({
                withdrawals: [
                    {
                        ...WITHDRAWAL,
                        effectiveFrom: '2999-01-01T00:00:00.000Z',
                        liftedFrom: '2999-03-01T00:00:00.000Z',
                        inEffect: false,
                        lines: [{ ...WITHDRAWAL.lines[0], reduced: false }],
                        specialTerms: true,
                        endable: { subscription: false, subscriptionBundleIds: [] },
                    },
                ],
            }),
        );

        const text = card()?.textContent ?? '';
        expect(text).toContain('Datenexport steht ab dem 2999-01-01 nicht mehr zur Verfügung');
        expect(text).toContain('Ab dem 2999-03-01 steht es wieder zur Verfügung.');
        expect(text).toContain('Standard (Monatlich): Die Minderung endete mit Ihrem Wechsel.');
        expect(text).toContain(i18n.featureWithdrawnSpecialTerms);
        expect(text, 'nothing may end at once before the date').not.toContain(
            i18n.featureWithdrawnEndRight,
        );
    });
});

// @requirement SC-CAT-017 — A withdrawn feature is marked wherever a plan or an add-on is shown with what it includes
describe('a withdrawn feature, where the plan section names it', () => {
    test('marks the feature as not available rather than as not included', async () => {
        await aSection(aServer());

        const matrix = document.body.querySelector('.sp-feature-matrix')?.textContent ?? '';
        expect(matrix).toContain('Nicht verfügbar seit 2026-07-01');
        expect(matrix).toContain(`Grund: ${REASON}`);
        const exportRow = [...document.body.querySelectorAll('.sp-feature-matrix__row')].find(
            (row) => row.textContent?.includes('Datenexport'),
        );
        expect(exportRow?.textContent).not.toContain(i18n.featuresLocked);
    });
});

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('ending at once while a feature is withdrawn', () => {
    test('names what ends and what is credited before the click, and ends it on confirmation', async () => {
        const server = aServer();
        const wrapper = await aSection(server);

        await buttonNamed(wrapper, i18n.featureWithdrawnEndSubscription)!.trigger('click');
        await flushPromises();

        expect(dialogText()).toContain(i18n.endAtOnceTitleSubscription);
        expect(dialogText()).toContain(
            'Ihr Abonnement und alle Zusatzpakete enden sofort, am 2026-07-10.',
        );
        expect(dialogText()).toContain(
            'Für die bereits bezahlte Zeit danach werden Ihrem Konto € 33.87 netto gutgeschrieben.',
        );
        expect(server.asked).toEqual(['GET /billing/feature-withdrawals/fw-1/end']);

        dialogButtonNamed(i18n.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.asked).toEqual([
            'GET /billing/feature-withdrawals/fw-1/end',
            'POST /billing/feature-withdrawals/fw-1/end',
        ]);
        expect(document.body.querySelector('.sp-dialog__panel')).toBeNull();
    });

    test('ends one add-on by name, and says when nothing is credited', async () => {
        const server = aServer();
        const wrapper = await aSection(server);

        await buttonNamed(wrapper, 'Export plus sofort beenden')!.trigger('click');
        await flushPromises();

        expect(dialogText()).toContain('Export plus sofort beenden?');
        expect(dialogText()).toContain('Export plus endet sofort, am 2026-07-10.');
        expect(dialogText()).toContain(i18n.endAtOnceNoCredit);

        dialogButtonNamed(i18n.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.asked.at(-1)).toBe(
            'POST /billing/feature-withdrawals/fw-1/bookings/sb-1/end',
        );
        expect(document.body.textContent).toContain('Export plus ist beendet.');
    });

    test('a refused question says why and offers no confirmation', async () => {
        const server = aServer({ previewStatus: 422 });
        const wrapper = await aSection(server);

        await buttonNamed(wrapper, i18n.featureWithdrawnEndSubscription)!.trigger('click');
        await flushPromises();

        expect(dialogText()).toContain(
            'EXPORT ist gerade nicht zurückgezogen. Deshalb kann nichts sofort beendet werden.',
        );
        expect(dialogButtonNamed(i18n.endAtOnceConfirm)?.disabled).toBe(true);
        expect(server.asked).toEqual(['GET /billing/feature-withdrawals/fw-1/end']);
    });
});

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('the page of the tenant’s add-ons', () => {
    test('tells of the withdrawal too, and reads the bookings again once one ended at once', async () => {
        const asked: string[] = [];
        const reply = (body: unknown) => ({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
        const http: HttpClient = async (url, init) => {
            asked.push(`${init?.method ?? 'GET'} ${url}`);
            if (url.endsWith('/feature-withdrawals')) return reply([WITHDRAWAL]);
            if (url.endsWith('/end')) {
                return reply({
                    endsAt: '2026-07-10T09:00:00.000Z',
                    creditNet: 0,
                    currency: 'EUR',
                    withdrawalId: 'fw-1',
                    subscriptionBundleId: 'sb-1',
                });
            }
            return reply([]);
        };
        const wrapper = mount(MySubscriptionBundlesPage, {
            attachTo: document.body,
            props: { billingEndpoint: '/api', http },
        });
        mounted.push(wrapper as VueWrapper);
        await flushPromises();

        // Mounted on its own, the page's notices speak the default language.
        expect(card()?.textContent).toContain('Datenexport has not been available since');
        const bookingsRead = () =>
            asked.filter((line) => line === 'GET /api/billing/subscription-bundles').length;
        const before = bookingsRead();

        await buttonNamed(wrapper, 'End Export plus now')!.trigger('click');
        await flushPromises();
        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(asked).toContain('POST /api/billing/feature-withdrawals/fw-1/bookings/sb-1/end');
        expect(bookingsRead()).toBeGreaterThan(before);
    });
});

// @requirement SC-CAT-017 — A withdrawn feature is marked wherever a plan or an add-on is shown with what it includes
describe('the mark beside a withdrawn feature, mounted on its own and so in the default language', () => {
    function aMark(withdrawn: unknown) {
        const Host = defineComponent({
            setup() {
                provideWithdrawnFeatures(
                    () =>
                        ({
                            EXPORT: { label: 'Datenexport', description: '', icon: '', withdrawn },
                        }) as never,
                    (iso) => iso.slice(0, 10),
                );
                return () => h(WithdrawnFeatureMark, { featureKey: 'EXPORT' });
            },
        });
        const wrapper = mount(Host);
        mounted.push(wrapper as VueWrapper);
        return wrapper.text();
    }

    test('says from when it is withdrawn ahead, and until when where it is lifted', () => {
        expect(
            aMark([
                {
                    reason: 'Gesetz',
                    effectiveFrom: '2999-01-01T00:00:00.000Z',
                    liftedFrom: null,
                },
            ]),
        ).toContain('Not available from 2999-01-01');
        expect(
            aMark([
                {
                    reason: 'Gesetz',
                    effectiveFrom: '2026-01-01T00:00:00.000Z',
                    liftedFrom: '2999-02-01T00:00:00.000Z',
                },
            ]),
        ).toContain('Not available since 2026-01-01, again from 2999-02-01');
    });

    test('says each withdrawal, where one begins the day another is lifted', () => {
        const text = aMark([
            {
                reason: 'Dienst eingestellt',
                effectiveFrom: '2026-01-01T00:00:00.000Z',
                liftedFrom: '2999-02-01T00:00:00.000Z',
            },
            { reason: 'Gesetz', effectiveFrom: '2999-02-01T00:00:00.000Z', liftedFrom: null },
        ]);
        expect(text).toContain('Not available since 2026-01-01, again from 2999-02-01');
        expect(text).toContain('Reason: Dienst eingestellt');
        expect(text).toContain('Not available from 2999-02-01');
        expect(text).toContain('Reason: Gesetz');
    });

    test('keeps the reason as it was typed', () => {
        expect(
            aMark([
                {
                    reason: 'Kostet $& mehr',
                    effectiveFrom: '2026-01-01T00:00:00.000Z',
                    liftedFrom: null,
                },
            ]),
        ).toContain('Reason: Kostet $& mehr');
    });

    test('says nothing where nothing is withdrawn, or nobody said', () => {
        expect(aMark(undefined)).toBe('');
        const wrapper = mount(WithdrawnFeatureMark, { props: { featureKey: 'EXPORT' } });
        mounted.push(wrapper as VueWrapper);
        expect(wrapper.text()).toBe('');
    });
});
