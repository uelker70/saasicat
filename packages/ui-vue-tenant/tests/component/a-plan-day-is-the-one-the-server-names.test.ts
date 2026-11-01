// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, type App } from 'vue';
import type { RetirementSwitchTerms, VersionRetiredNoticeWithDays } from '@saasicat/core';
import type { HttpClient, UsageSnapshotShape } from '@saasicat/ui-vue';

import PackageSnapshotPanel from '../../src/PackageSnapshotPanel.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import VersionRetiredCard from '../../src/tenant-plan-section/VersionRetiredCard.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n';
import { answeredUsage } from './support/server-days.js';

// Every day the plan section writes is a day the server named beside the
// moment, and the side of it the sentence means: what ends shows the last day it
// covers (`until`), what begins shows its first (`from`), and a pilot's end is
// the day that was picked. The days here are set apart from each other and from
// the moment's own date on purpose — a page that wrote the moment, or the other
// side, writes a day that appears nowhere in the answer as the right one.

const UNTIL = '2026-12-30';
const FROM = '2026-12-31';
const DAYS = { until: UNTIL, from: FROM };
/** Moments whose own dates are neither of those days: one past, one still to come. */
const PAST = '2020-06-15T12:00:00.000Z';
const AHEAD = '2099-06-15T12:00:00.000Z';

const i18n = defaultTenantPlanSectionI18n('en');
/** The tenant's English catalogue, provided the way the plan section provides it. */
const inEnglish = {
    install: (app: App) =>
        app.provide(
            TENANT_I18N_KEY,
            computed(() => i18n),
        ),
};
const formatDate = (value: string | Date) => String(value).slice(0, 10);

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

/** Shows `expected` and neither the other side nor the moment's own date. */
function showsOnly(shown: string, expected: string, moment: string) {
    expect(shown).toContain(expected);
    expect(shown).not.toContain(expected === UNTIL ? FROM : UNTIL);
    expect(shown).not.toContain(moment.slice(0, 10));
}

/** A running monthly subscription, answered with the days the server names. */
const RUNNING = answeredUsage({
    plan: 'PRO',
    effectivePlan: 'PRO',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    currentPeriodStart: '2026-06-01T00:00:00.000Z',
    currentPeriodEnd: AHEAD,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: {
        id: 'pv-1',
        planId: 'PRO',
        version: 1,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        changeNote: null,
    },
    planPriceNet: 29,
    limits: { plan: 'PRO', quotas: { users: 5 }, features: [] },
    usage: { users: 1 },
    packageSnapshot: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    cancellation: {
        effectiveAt: AHEAD,
        termEndsAt: AHEAD,
        noticeDeadline: null,
        afterNoticeDeadline: false,
    },
    retirement: null,
    retirementSwitch: null,
    checkoutOfferId: null,
});

/** `RUNNING` with the moments and days a case is about set by hand. */
const usageWith = (fields: Partial<UsageSnapshotShape>): UsageSnapshotShape => ({
    ...RUNNING,
    ...fields,
});

function header(fields: Partial<UsageSnapshotShape>, billsAgain = false) {
    const wrapper = mount(TenantPlanCardHeader, {
        props: {
            usage: usageWith(fields),
            currentPlanName: 'Pro',
            statusTone: 'positive' as const,
            statusLabel: 'Active',
            cycleLabel: 'Monthly',
            currentPriceEur: 29,
            currentPriceUnit: '/ mo',
            billsAgain,
            formatCurrency: (value: number) => `€ ${value}`,
            formatDate,
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

/** The line of the header that begins with `label`. */
const lineOf = (wrapper: ReturnType<typeof header>, label: string) =>
    wrapper
        .findAll('p')
        .find((line) => line.text().startsWith(label))
        ?.text() ?? '';

describe('the plan card', () => {
    test('is billed again from the first day of the next period', () => {
        const wrapper = header({ currentPeriodEndDays: DAYS }, true);
        showsOnly(lineOf(wrapper, i18n.nextBillingDate), FROM, AHEAD);
    });

    test('ends a trial on the last day it covers', () => {
        const wrapper = header({ status: 'TRIAL', trialEndsAt: AHEAD, trialEndsDays: DAYS });
        showsOnly(lineOf(wrapper, i18n.trialEndsAt), UNTIL, AHEAD);
    });

    test('ends a pilot on the day that was picked', () => {
        const wrapper = header({ isPilot: true, pilotEndsAt: AHEAD, pilotEndsDay: UNTIL });
        showsOnly(lineOf(wrapper, i18n.pilotEndsAt), UNTIL, AHEAD);
    });

    test('names the first day a scheduled change applies', () => {
        const wrapper = header({
            pendingPlan: 'BASIC',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: AHEAD,
            pendingEffectiveDays: DAYS,
        });
        showsOnly(lineOf(wrapper, i18n.pendingChange), FROM, AHEAD);
    });

    test('and the first day a newer version taken for the end of the term applies', () => {
        const wrapper = header({
            pendingPlan: 'PRO',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: AHEAD,
            pendingEffectiveDays: DAYS,
        });
        showsOnly(lineOf(wrapper, i18n.pendingVersionSwitch), FROM, AHEAD);
    });

    test('runs a cancelled subscription until the last day it covers', () => {
        const wrapper = header({
            canceledAt: PAST,
            canceledEffectiveAt: AHEAD,
            canceledDays: { until: '2020-06-15', from: '2020-06-15' },
            canceledEffectiveDays: DAYS,
        });
        showsOnly(wrapper.find('.sp-plan-section__canceled').text(), UNTIL, AHEAD);
    });

    test('says an ended subscription has ended since the first day it no longer ran', () => {
        const wrapper = header({ canceledEffectiveAt: PAST, canceledEffectiveDays: DAYS });
        showsOnly(wrapper.find('.sp-plan-section__canceled').text(), FROM, PAST);
    });
});

describe('the confirmation of a cancellation', () => {
    /** Answers the reads the section makes with `usage`, and nothing else. */
    function aServer(usage: UsageSnapshotShape): HttpClient {
        const reply = (body: unknown) => ({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
        return async (url) => {
            if (url.endsWith('/usage')) return reply(usage);
            if (url.endsWith('/version-offer')) return reply({ offer: null });
            return reply([]);
        };
    }

    test('names the last day the subscription runs, and the last day notice could be given', async () => {
        const wrapper = mount(TenantPlanSection, {
            attachTo: document.body,
            props: {
                http: aServer(
                    usageWith({
                        cancellation: {
                            effectiveAt: AHEAD,
                            termEndsAt: AHEAD,
                            noticeDeadline: AHEAD,
                            afterNoticeDeadline: true,
                            effectiveDays: DAYS,
                            termEndsDays: DAYS,
                            noticeDeadlineDays: { until: '2026-11-29', from: '2026-11-30' },
                        },
                    }),
                ),
                formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
                formatDate,
                i18n,
            },
        });
        mounted.push(wrapper);
        await flushPromises();

        const cancel = wrapper
            .findAll('button')
            .find((button) => button.text() === i18n.cancelSubscriptionButton);
        await cancel!.trigger('click');
        await flushPromises();

        const dialog = document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
        showsOnly(dialog, UNTIL, AHEAD);
        expect(dialog).toContain('ended on 2026-11-29');
        expect(dialog).not.toContain('2026-11-30');
        expect(dialog).toContain(i18n.cancelConfirmAction.replace('{date}', UNTIL));
    });
});

describe('the retirement of the version the tenant is on', () => {
    const side = (planVersionId: string, version: number) => ({
        planKey: 'PRO',
        planVersionId,
        version,
        features: [],
        quotas: { users: 5 },
        monthlyNet: 29,
        yearlyNet: 290,
        validUntil: null,
        endsAt: null,
    });
    const RETIREMENT: VersionRetiredNoticeWithDays = {
        kind: 'version-retired',
        tenantId: 't-1',
        subscriptionId: 'sub-1',
        retirementId: 'r-1',
        retired: side('pv-1', 1),
        replacement: side('pv-2', 2),
        changes: [],
        billingCycle: 'MONTHLY',
        effectiveAt: AHEAD,
        effectiveDays: DAYS,
        lastDayToCancel: '2026-12-29',
    };

    function card(switchTerms: RetirementSwitchTerms | null = null) {
        const wrapper = mount(VersionRetiredCard, {
            attachTo: document.body,
            global: { plugins: [inEnglish] },
            props: {
                retirement: RETIREMENT,
                planName: 'Pro',
                switchTerms,
                billingCycle: 'MONTHLY',
                nextPeriodStartDay: '2026-07-01',
                formatCurrency: (value: number) => `€ ${value}`,
                formatDate,
                quotaLabel: (key: string) => key,
                featureLabel: (key: string) => key,
                formatQuotaValue: (key: string, value: number) => `${value} ${key}`,
            },
        });
        mounted.push(wrapper);
        return wrapper;
    }

    test('says the subscription moves on from the first day of the replacement', () => {
        const text = card().text();
        expect(text).toContain(`From ${FROM}, your subscription continues on Pro (version 2)`);
        expect(text).toContain(`From ${FROM} (version 2)`);
        expect(text).not.toContain(UNTIL);
        expect(text).not.toContain(AHEAD.slice(0, 10));
    });

    test('a switch that costs no more applies its price from the day the next period starts', async () => {
        const wrapper = card({ priceNet: 29, held: null });
        const switchNow = wrapper
            .findAll('button')
            .find((button) => button.text() === i18n.versionRetiredSwitch);
        await switchNow!.trigger('click');
        await flushPromises();

        const dialog = document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
        expect(dialog).toContain('From your next period on 2026-07-01');
    });
});

describe('the package the subscription was concluded from', () => {
    test('was captured on the day the server names', () => {
        const wrapper = mount(PackageSnapshotPanel, {
            global: { plugins: [inEnglish] },
            props: {
                snapshot: { planId: 'PRO', capturedAt: AHEAD },
                checkoutOfferId: 'offer-1',
                capturedDays: DAYS,
                formatDate,
                formatCurrency: (value: number) => `€ ${value}`,
            },
        });
        mounted.push(wrapper);

        showsOnly(wrapper.find('.sp-chip').text(), FROM, AHEAD);
    });
});
