// The version a tenant is on is being retired, and the plan section says so
// beside the plan: when the subscription moves on, to which version and at what
// price, and until when it may be cancelled without notice — in the
// confirmation of a cancellation too. What it says is the notice the
// subscriber was told, read off the usage the server answers.

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { CatalogPlan, HttpClient } from '@saasicat/ui-vue';

import TenantPlanSection from '../../src/TenantPlanSection.vue';
import { DEFAULT_I18N_DE } from '../../src/default-i18n.js';

const i18n = DEFAULT_I18N_DE;

const plan = (id: string, name: string): CatalogPlan => ({
    id,
    name,
    tagline: '',
    monthlyNet: 49,
    yearlyNet: 490,
    popular: false,
    quotas: { users: 5 },
    features: ['DASHBOARD'],
});

const side = (planKey: string, planVersionId: string, version: number, monthlyNet: number) => ({
    planKey,
    planVersionId,
    version,
    features: ['DASHBOARD'],
    quotas: { users: 5 },
    monthlyNet,
    yearlyNet: 490,
    validUntil: null,
    endsAt: null,
});

const RETIREMENT = {
    kind: 'version-retired',
    tenantId: 't-1',
    subscriptionId: 'sub-1',
    retirementId: 'r-1',
    retired: side('STANDARD', 'pv-1', 1, 49),
    replacement: side('PRO', 'pv-9', 3, 59),
    changes: [
        { field: 'monthlyNet', oldValue: '49.00', newValue: '59.00', direction: 'REGRESSION' },
    ],
    billingCycle: 'MONTHLY',
    effectiveAt: '2027-02-01T00:00:00.000Z',
    lastDayToCancel: '2027-01-31',
};

function aSubscription(retirement: unknown, retirementSwitch: unknown = null) {
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
        currentPeriodEnd: '2026-11-01T00:00:00.000Z',
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
        cancellation: {
            effectiveAt: '2026-11-01T00:00:00.000Z',
            termEndsAt: '2026-11-01T00:00:00.000Z',
            noticeDeadline: null,
            afterNoticeDeadline: false,
        },
        limits: { plan: 'STANDARD', quotas: { users: 5 }, features: ['DASHBOARD'] },
        usage: { users: 3 },
        packageSnapshot: null,
        retirement,
        retirementSwitch,
        checkoutOfferId: null,
    };
}

/** Every switch the page asked for, by the body it sent. */
const switches: unknown[] = [];

function aServer(retirement: unknown, retirementSwitch: unknown = null): HttpClient {
    const reply = (body: unknown) => ({
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    return async (url, init) => {
        if (url.endsWith('/retirement/switch')) {
            switches.push(JSON.parse(String(init?.body ?? 'null')));
            retirement = null;
            retirementSwitch = null;
            return reply({ fromPlanVersionId: 'pv-1', planVersionId: 'pv-9', heldUntilDay: null });
        }
        if (url.endsWith('/usage')) return reply(aSubscription(retirement, retirementSwitch));
        if (url.endsWith('/version-offer')) return reply({ offer: null });
        if (url.endsWith('/plans')) {
            return reply([plan('STANDARD', 'Standard'), plan('PRO', 'Professional')]);
        }
        return reply([]);
    };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    switches.splice(0);
});

async function aSection(retirement: unknown, retirementSwitch: unknown = null) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: aServer(retirement, retirementSwitch),
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
            i18n,
        },
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const card = () => document.body.querySelector<HTMLElement>('.sp-version-retired');

// @requirement SC-SUB-030 — A tenant sees the retirement of its version beside its plan
describe('a retired version, beside the plan', () => {
    test('says when the subscription moves on, to which version, and what it costs then', async () => {
        await aSection(RETIREMENT);

        const text = card()?.textContent ?? '';
        expect(text).toContain('Version 1 Ihres Pakets wird eingestellt');
        expect(text).toContain(
            'Ab dem 2027-02-01 läuft Ihr Abonnement auf Professional (Version 3) weiter',
        );
        const rows = [...(card()?.querySelectorAll('tbody tr') ?? [])].map((row) =>
            [...row.children].map((cell) => cell.textContent?.trim()),
        );
        expect(rows[0]).toEqual([i18n.versionOfferPriceMonthly, '€ 49.00', '€ 59.00']);
        expect(text).toContain(
            'Bis einschließlich 2027-01-31 können Sie ohne Kündigungsfrist zum Ende Ihrer laufenden Periode kündigen.',
        );
    });

    test('is not shown where nothing is being retired', async () => {
        await aSection(null);

        expect(card()).toBeNull();
    });

    test('is said again in the confirmation of a cancellation', async () => {
        const wrapper = await aSection(RETIREMENT);

        const cancel = wrapper
            .findAll('button')
            .find((button) => button.text() === i18n.cancelSubscriptionButton);
        expect(cancel, 'no cancel button').toBeTruthy();
        await cancel!.trigger('click');
        await flushPromises();

        expect(document.body.querySelector('.sp-dialog__panel')?.textContent).toContain(
            'Weil Version 1 Ihres Pakets eingestellt wird, gilt bis einschließlich 2027-01-31 keine Kündigungsfrist.',
        );
    });
});

/** The replacement costs ten more; the subscriber keeps paying 49 until the date. */
const HELD = { priceNet: 59, held: { priceNet: 49, amountNet: 10, lastDay: '2027-01-31' } };

const buttonNamed = (wrapper: VueWrapper, label: string) =>
    wrapper.findAll('button').find((button) => button.text() === label);

async function confirmingTheSwitch(retirementSwitch: unknown) {
    const wrapper = await aSection(RETIREMENT, retirementSwitch);
    await buttonNamed(wrapper, i18n.versionRetiredSwitch)!.trigger('click');
    await flushPromises();
    return wrapper;
}

const dialogText = () => document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';

// @requirement SC-SUB-032 — A subscriber may switch to the replacement early, at no more than they paid
describe('the switch to the replacement, before the date', () => {
    test('is offered where the subscription may take it, and not otherwise', async () => {
        const offered = await aSection(RETIREMENT, HELD);
        expect(buttonNamed(offered, i18n.versionRetiredSwitch)).toBeTruthy();
        offered.unmount();
        mounted.splice(0);

        const notOffered = await aSection(RETIREMENT, null);
        expect(buttonNamed(notOffered, i18n.versionRetiredSwitch)).toBeUndefined();
    });

    test('says what it costs until the date and after it, and that cancelling without notice lapses', async () => {
        await confirmingTheSwitch(HELD);

        expect(dialogText()).toContain(
            'Bis einschließlich 2027-01-31 zahlen Sie weiter € 49.00 netto/Monat, ab 2027-02-01 € 59.00 netto/Monat.',
        );
        expect(dialogText()).toContain(i18n.versionRetiredSwitchCancelLapses);
    });

    test('says a price that is not higher applies from the next period', async () => {
        await confirmingTheSwitch({ priceNet: 45, held: null });

        expect(dialogText()).toContain(
            'Ab Ihrer nächsten Periode am 2026-11-01 zahlen Sie € 45.00 netto/Monat.',
        );
    });

    test('switches to the version shown when confirmed, and says so', async () => {
        await confirmingTheSwitch(HELD);

        // The dialog is teleported to the document, outside the wrapper.
        const confirm = [...document.body.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === i18n.versionRetiredSwitchConfirm,
        );
        expect(confirm, 'no confirm button').toBeTruthy();
        confirm!.click();
        await flushPromises();

        expect(switches).toEqual([{ planVersionId: 'pv-9' }]);
        expect(document.body.textContent).toContain('Sie nutzen jetzt Version 3.');
        expect(card()).toBeNull();
    });
});
