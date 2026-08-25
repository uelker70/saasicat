import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

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

describe('a card left open across the moment', () => {
    // The clock is not a dependency of a computed, and nothing else changes at
    // that moment: no request arrives, no prop is written. Without a scheduled
    // re-evaluation the card keeps saying "running" and keeps offering a plan
    // change the route now refuses.
    test('follows the boundary instead of the last render', async () => {
        vi.useFakeTimers();
        try {
            const wrapper = header({
                canceledAt: iso(0),
                canceledEffectiveAt: new Date(Date.now() + 5_000).toISOString(),
            });

            expect(wrapper.text(), 'ended before its date').toContain(i18n.canceledUnchanged);
            expect(buttonLabels(wrapper)).toContain(i18n.changePlanButton);

            await vi.advanceTimersByTimeAsync(5_001);
            await nextTick();

            expect(wrapper.text(), 'still running after its date').toContain(i18n.endedHeading);
            expect(buttonLabels(wrapper)).not.toContain(i18n.changePlanButton);
        } finally {
            vi.useRealTimers();
        }
    });

    test('and asks for no delay the platform would truncate', () => {
        // `setTimeout` counts its delay in a signed 32-bit integer: above
        // 2^31-1 it fires immediately instead of later, so a cancellation a
        // year out would re-arm in a tight loop. The wait is taken in hops.
        //
        // Asserted on the delay rather than on behaviour, deliberately: no test
        // environment reproduces the truncation — fake timers honour a delay of
        // any size — so a behavioural test here would pass with the clamp
        // removed, which is a guard that guards nothing. Verified: removing
        // `Math.min` fails this test and nothing else.
        vi.useFakeTimers();
        const delays: number[] = [];
        const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
            fn: () => void,
            ms?: number,
        ) => {
            delays.push(ms ?? 0);
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);
        try {
            header({ canceledAt: iso(0), canceledEffectiveAt: iso(365) });

            expect(delays.length, 'nothing was scheduled at all').toBeGreaterThan(0);
            for (const ms of delays) expect(ms).toBeLessThanOrEqual(2_147_483_647);
        } finally {
            spy.mockRestore();
            vi.useRealTimers();
        }
    });
});
