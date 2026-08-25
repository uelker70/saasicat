import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { UsageSnapshotShape } from '@saasicat/ui-vue';

// Three states, not two, and the middle one is the one that gets lost.
//
// A subscription with no cancellation runs. One with a cancellation still to
// come ALSO runs — it is billed and keeps every entitlement until the date, and
// saying "cancelled, gone" there is how a tenant loses access they paid for.
// One whose date has passed is over.
//
// The page cannot read `status` to tell the second from the third: nothing
// transitions that column when a cancellation lands, so a subscription that
// ended last month still says ACTIVE. Until this file existed the header
// believed it, and showed a positive badge, a next billing date, and a sentence
// promising nothing would change before a date already in the past — beside a
// "change plan" button whose route now answers `SUBSCRIPTION_ENDED`.

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const i18n = defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE);
const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function header(usage: Partial<UsageSnapshotShape>) {
    const wrapper = mount(TenantPlanCardHeader, {
        props: {
            usage: {
                status: 'ACTIVE',
                isPilot: false,
                pilotEndsAt: null,
                trialEndsAt: null,
                currentPeriodEnd: iso(30),
                pendingPlan: null,
                pendingEffectiveAt: null,
                canceledAt: null,
                canceledEffectiveAt: null,
                ...usage,
            } as unknown as UsageSnapshotShape,
            currentPlanName: 'Pro',
            statusTone: 'positive' as const,
            statusLabel: i18n.statusActive,
            cycleLabel: i18n.cycleMonthly,
            currentPriceEur: 29,
            currentPriceUnit: '/ mo',
            // The parent stops offering one once the subscription has ended; the
            // header is asked here with the value it would still receive.
            nextBillingDate: iso(30),
            formatCurrency: (v: number) => `€ ${v.toFixed(2)}`,
            formatDate: (v: string | Date) => String(v).slice(0, 10),
        },
    });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

const buttonLabels = (wrapper: VueWrapper) => wrapper.findAll('button').map((b) => b.text().trim());

describe('a subscription that has ended', () => {
    const ended = { canceledAt: iso(-90), canceledEffectiveAt: iso(-60) };

    test('says so, in the past tense', () => {
        const text = header(ended).text();

        expect(text).toContain(i18n.endedHeading);
        expect(text).not.toContain(i18n.canceledUnchanged);
    });

    test('and offers neither of the two acts it no longer has', () => {
        const labels = buttonLabels(header(ended));

        expect(labels, 'a plan the route refuses to change').not.toContain(i18n.changePlanButton);
        expect(labels, 'a cancellation to declare twice').not.toContain(
            i18n.cancelSubscriptionButton,
        );
    });
});

describe('a cancellation still to come', () => {
    const ending = { canceledAt: iso(0), canceledEffectiveAt: iso(30) };

    test('runs unchanged, and says that instead', () => {
        const text = header(ending).text();

        expect(text).toContain(i18n.canceledUnchanged);
        expect(text).not.toContain(i18n.endedHeading);
    });

    test('and the plan can still be changed', () => {
        // A customer who cancels in March may still move plan for the term they
        // have paid for. Only the second cancel button goes.
        const labels = buttonLabels(header(ending));

        expect(labels).toContain(i18n.changePlanButton);
        expect(labels).not.toContain(i18n.cancelSubscriptionButton);
    });
});

describe('a subscription with no cancellation', () => {
    test('says nothing about one and offers both acts', () => {
        const wrapper = header({});

        expect(wrapper.text()).not.toContain(i18n.canceledHeading);
        expect(wrapper.text()).not.toContain(i18n.endedHeading);
        expect(buttonLabels(wrapper)).toEqual([
            i18n.changePlanButton,
            i18n.cancelSubscriptionButton,
        ]);
    });
});

describe('a cancellation older than the fields that describe it', () => {
    test('is read from the only column it has', () => {
        // The pre-split row: `canceledAt` IS the effective date.
        const text = header({ canceledAt: iso(-60), canceledEffectiveAt: null }).text();

        expect(text).toContain(i18n.endedHeading);
    });
});
