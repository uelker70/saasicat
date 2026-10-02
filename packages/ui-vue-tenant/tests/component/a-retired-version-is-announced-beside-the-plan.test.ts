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

function aSubscription(retirement: unknown) {
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
        checkoutOfferId: null,
    };
}

function aServer(retirement: unknown): HttpClient {
    const reply = (body: unknown) => ({
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    return async (url) => {
        if (url.endsWith('/usage')) return reply(aSubscription(retirement));
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
});

async function aSection(retirement: unknown) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: aServer(retirement),
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
