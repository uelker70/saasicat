// @requirement SC-CANC-016 — A subscription is in one of three states, not two
// @requirement SC-ENTL-013 — A cancellation that is merely declared changes nothing

import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UsageSnapshotShape } from '@saasicat/ui-vue';

import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// A cancelled subscription is not a gone subscription.
//
// It runs, it is billed, and it keeps every entitlement until
// `canceledEffectiveAt`. A tenant who cancels in month three of a year and then
// sees "cancelled" with no date has lost nothing yet and believes they have —
// which is a support ticket at best and an early exit at worst.
//
// So the header says the DATE, and it stops offering an act that is already
// done. Both halves are here because either alone reads as correct.

const usage = (overrides: Partial<UsageSnapshotShape> = {}): UsageSnapshotShape =>
    ({
        plan: 'PRO',
        effectivePlan: 'PRO',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        currentPeriodStart: '2026-01-01T00:00:00.000Z',
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
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
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        limits: { plan: 'PRO', quotas: { notes: 100 }, features: [] },
        usage: { notes: 1 },
        packageSnapshot: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: {
            effectiveAt: '2027-01-01T00:00:00.000Z',
            termEndsAt: '2027-01-01T00:00:00.000Z',
            noticeDeadline: null,
            afterNoticeDeadline: false,
        },
        checkoutOfferId: null,
        ...overrides,
    }) as UsageSnapshotShape;

function mountHeader(overrides: Partial<UsageSnapshotShape> = {}) {
    return mount(TenantPlanCardHeader, {
        props: {
            usage: usage(overrides),
            currentPlanName: 'Pro',
            statusTone: 'positive' as never,
            statusLabel: 'Active',
            cycleLabel: 'Yearly',
            currentPriceEur: 100,
            currentPriceUnit: '/year',
            nextBillingDate: '2027-01-01T00:00:00.000Z',
            formatCurrency: (value: number) => `${value} €`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
        },
    });
}

const i18n = defaultTenantPlanSectionI18n('en');

describe('while nothing is cancelled', () => {
    test('the tenant is offered the act', () => {
        const wrapper = mountHeader();
        expect(wrapper.text()).toContain(i18n.cancelSubscriptionButton);
    });

    test('and told nothing about a cancellation', () => {
        // The premise for the suite below: if this string were always present,
        // the assertions there would pass without the component doing anything.
        expect(mountHeader().text()).not.toContain(i18n.canceledHeading);
    });
});

describe('once it is cancelled', () => {
    const cancelled = () =>
        mountHeader({
            canceledAt: '2026-03-01T00:00:00.000Z',
            canceledEffectiveAt: '2027-01-01T00:00:00.000Z',
        });

    test('the date is shown, not just the word', () => {
        // "Cancelled" alone is what makes a tenant think they have already lost
        // access they are still paying for.
        //
        // Read from the strip itself, not from the header's text: the next
        // billing date beside it is the same day here, so a whole-text search
        // passes with the date removed — it did, on the first draft.
        const strip = cancelled().find('.sp-plan-section__canceled');
        expect(strip.exists()).toBe(true);
        expect(strip.text()).toContain(i18n.canceledHeading);
        expect(strip.text()).toContain('2027-01-01');
    });

    test('and the subscription is described as unchanged until then', () => {
        expect(cancelled().find('.sp-plan-section__canceled').text()).toContain(
            i18n.canceledUnchanged,
        );
    });

    test('the act is no longer offered', () => {
        // Offering it twice invites a second declaration that changes nothing
        // and reads as though the first one failed.
        expect(cancelled().text()).not.toContain(i18n.cancelSubscriptionButton);
    });

    test('changing plan still is', () => {
        // A cancelled subscription is still a running one, and upgrading is a
        // perfectly ordinary thing to do inside a term one has given notice on.
        expect(cancelled().text()).toContain(i18n.changePlanButton);
    });
});
