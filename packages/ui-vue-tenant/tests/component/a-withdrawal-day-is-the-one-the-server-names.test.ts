// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { DaysAround, FeatureWithdrawalMark, TenantFeatureWithdrawal } from '@saasicat/core';
import type { HttpClient } from '@saasicat/ui-vue';

import WithdrawnFeatureMark from '../../src/WithdrawnFeatureMark.vue';
import FeatureWithdrawnNotices from '../../src/tenant-plan-section/FeatureWithdrawnNotices.vue';
import { provideWithdrawnFeatures } from '../../src/withdrawn-features.js';

// Every day a withdrawal is told by is a day the server named beside the
// moment: from when the feature is missing, from when it returns, from when a
// line a scheduled change brings is reduced, and the day an end at once ends
// on. Each sentence says "from", "since" or "on", so each writes the `from`
// side. Every moment here has a date of its own and every field days of its
// own, set apart on purpose — a page that wrote the moment, the other side or
// another field's day writes a day that appears nowhere as the right one.

const PAST = '2020-06-15T12:00:00.000Z';
const AHEAD = '2099-06-15T12:00:00.000Z';
const RETURNS = '2099-08-15T12:00:00.000Z';
const CHANGES = '2099-07-15T12:00:00.000Z';
const ENDS = '2020-06-20T12:00:00.000Z';

const EFFECTIVE_DAYS: DaysAround = { until: '2026-12-30', from: '2026-12-31' };
const LIFTED_DAYS: DaysAround = { until: '2027-03-30', from: '2027-03-31' };
const CHANGE_DAYS: DaysAround = { until: '2027-05-30', from: '2027-05-31' };
const ENDS_DAYS: DaysAround = { until: '2027-07-30', from: '2027-07-31' };

/** The day an instant falls on where the viewer is, as a browser's formatter reads it. */
function formatDate(value: string | Date): string {
    const at = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Shows the `from` side of `days`, and neither its `until` nor the moment's own date. */
function showsFrom(shown: string, days: DaysAround, moment: string) {
    expect(shown).toContain(days.from);
    expect(shown).not.toContain(days.until);
    expect(shown).not.toContain(moment.slice(0, 10));
}

const WITHDRAWAL: TenantFeatureWithdrawal = {
    withdrawalId: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Export',
    reason: 'The service closed.',
    effectiveFrom: PAST,
    effectiveFromDays: EFFECTIVE_DAYS,
    liftedFrom: null,
    liftedFromDays: null,
    inEffect: true,
    lines: [
        {
            line: 'plan',
            key: 'PRO',
            label: 'Pro',
            subscriptionBundleId: null,
            billingCycle: 'MONTHLY',
            reductionNet: 5,
            reduced: true,
            fromChange: null,
            fromChangeDays: null,
        },
    ],
    specialTerms: false,
    endable: { subscription: true, subscriptionBundleIds: [] },
};

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

/** The notices, mounted on their own and so in the default language, answered with `withdrawals`. */
async function notices(withdrawals: unknown[]) {
    const reply = (body: unknown) => ({
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    const http: HttpClient = async (url) =>
        reply(
            url.endsWith('/end')
                ? { endsAt: ENDS, endsDays: ENDS_DAYS, creditNet: 0, currency: 'EUR' }
                : withdrawals,
        );
    const wrapper = mount(FeatureWithdrawnNotices, {
        attachTo: document.body,
        props: { http, formatCurrency: (n: number) => `€ ${n.toFixed(2)}`, formatDate },
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const noticeText = () => document.body.querySelector('.sp-feature-withdrawn')?.textContent ?? '';

describe('a withdrawal told beside the plan', () => {
    test('has been missing since the first day it took the feature away', async () => {
        await notices([WITHDRAWAL]);

        expect(noticeText()).toContain('Export has not been available since 2026-12-31');
        showsFrom(noticeText(), EFFECTIVE_DAYS, PAST);
    });

    test('is missing from the first day it takes the feature away, and back from the first day it returns', async () => {
        await notices([
            {
                ...WITHDRAWAL,
                effectiveFrom: AHEAD,
                liftedFrom: RETURNS,
                liftedFromDays: LIFTED_DAYS,
                inEffect: false,
            },
        ]);

        expect(noticeText()).toContain('Export will not be available from 2026-12-31');
        expect(noticeText()).toContain('It is available again from 2027-03-31.');
        showsFrom(noticeText(), EFFECTIVE_DAYS, AHEAD);
        showsFrom(noticeText(), LIFTED_DAYS, RETURNS);
    });

    test('reduces a line a scheduled change brings from the first day of the change', async () => {
        const [line] = WITHDRAWAL.lines;
        await notices([
            {
                ...WITHDRAWAL,
                lines: [
                    { ...line, reduced: false, fromChange: CHANGES, fromChangeDays: CHANGE_DAYS },
                ],
            },
        ]);

        expect(noticeText()).toContain('Pro (Monthly): from your change on 2027-05-31');
        showsFrom(noticeText(), CHANGE_DAYS, CHANGES);
    });

    test('ending at once ends on the day the end falls on', async () => {
        const wrapper = await notices([WITHDRAWAL]);

        await wrapper
            .findAll('button')
            .find((button) => button.text() === 'End subscription now')!
            .trigger('click');
        await flushPromises();

        const dialog = document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
        expect(dialog).toContain('Your subscription and every add-on end at once, on 2027-07-31.');
        showsFrom(dialog, ENDS_DAYS, ENDS);
    });

    test('from a server that names no days yet, writes a dash rather than a day of its own', async () => {
        const withoutDays = Object.fromEntries(
            Object.entries(WITHDRAWAL).filter(([key]) => !key.endsWith('Days')),
        );
        await notices([withoutDays]);

        expect(noticeText()).toContain('Export has not been available since —');
        expect(noticeText()).not.toContain(PAST.slice(0, 10));
    });
});

describe('the mark beside a withdrawn feature', () => {
    function aMark(mark: FeatureWithdrawalMark) {
        const Host = defineComponent({
            setup() {
                provideWithdrawnFeatures(
                    () => ({
                        EXPORT: { label: 'Export', description: '', icon: '', withdrawn: [mark] },
                    }),
                    formatDate,
                );
                return () => h(WithdrawnFeatureMark, { featureKey: 'EXPORT' });
            },
        });
        const wrapper = mount(Host);
        mounted.push(wrapper as VueWrapper);
        return wrapper.text();
    }

    test('is missing from the first day it takes the feature away, and back from the first day it returns', () => {
        const text = aMark({
            reason: 'Law',
            effectiveFrom: PAST,
            effectiveFromDays: EFFECTIVE_DAYS,
            liftedFrom: RETURNS,
            liftedFromDays: LIFTED_DAYS,
        });

        expect(text).toContain('Not available since 2026-12-31, again from 2027-03-31');
        showsFrom(text, EFFECTIVE_DAYS, PAST);
        showsFrom(text, LIFTED_DAYS, RETURNS);
    });
});
