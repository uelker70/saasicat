import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import TenantPlanSection from '../../src/TenantPlanSection.vue';
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

    test('reaches a boundary further away than one hop', async () => {
        // The clamp alone is half the rule. A cancellation a year out is
        // scheduled in hops, and the callback of a hop has not reached the
        // boundary — nothing else arms the next one, because the watcher
        // depends on a date that has not changed. One hop and then silence
        // meant the boundary was never observed at all.
        vi.useFakeTimers();
        try {
            const wrapper = header({
                canceledAt: iso(0),
                canceledEffectiveAt: new Date(Date.now() + 60 * DAY).toISOString(),
            });

            // Two hops of the platform maximum are still short of sixty days.
            await vi.advanceTimersByTimeAsync(2_147_483_647);
            await nextTick();
            expect(wrapper.text(), 'ended before its date').toContain(i18n.canceledUnchanged);

            await vi.advanceTimersByTimeAsync(60 * DAY);
            await nextTick();

            expect(wrapper.text(), 'the boundary passed unobserved').toContain(i18n.endedHeading);
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

// The page around the header, because three of the things that change when a
// subscription ends are decided there rather than in the card: the status
// badge, its tone, and whether a next billing date is shown at all. And one
// more act the page offers — accepting a pending plan version — whose route
// refuses on a subscription that has ended, so the banner has to go with it.

const PENDING_VERSION = {
    id: 'pv-2',
    planId: 'PRO',
    version: 2,
    publishedAt: iso(-10),
    supersededAt: null,
    changeNote: 'More storage',
};

function sectionUsage(overrides: Record<string, unknown>) {
    return {
        plan: 'PRO',
        effectivePlan: 'PRO',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: iso(-200),
        currentPeriodStart: iso(-10),
        currentPeriodEnd: iso(20),
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: { ...PENDING_VERSION, version: 1, changeNote: null },
        pendingPlanVersion: PENDING_VERSION,
        pendingPlanVersionEffectiveAt: iso(5),
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: {
            effectiveAt: iso(20),
            termEndsAt: iso(20),
            noticeDeadline: null,
            afterNoticeDeadline: false,
        },
        limits: { plan: 'PRO', quotas: { users: 50 }, features: ['EXPORT'] },
        usage: { users: 3 },
        packageSnapshot: null,
        checkoutOfferId: null,
        ...overrides,
    };
}

/**
 * Answers the reads the section makes, and nothing else. `HttpClient` is a
 * function rather than an object — a fetch-shaped one — so this returns
 * responses, not payloads.
 */
function stubHttp(usage: Record<string, unknown>) {
    const respond = (payload: unknown) => ({
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
        ok: true,
    });
    return async (url: string) => {
        if (url.includes('/usage')) return respond(usage);
        // The catalog reads answer with bare arrays, not envelopes.
        if (url.includes('/subscription-bundles')) return respond([]);
        if (url.includes('/plans')) return respond([]);
        if (url.includes('/bundles')) return respond([]);
        if (url.includes('/feature-registry')) return respond([]);
        return respond({});
    };
}

async function mountSection(usage: Record<string, unknown>) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: stubHttp(usage) as never,
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate: (value: string | Date) => String(value).slice(0, 10),
        },
    });
    mounted.push(wrapper as VueWrapper);
    // Two composables load in parallel; let both settle.
    for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
        await nextTick();
    }
    return wrapper;
}

describe('the page around the card', () => {
    const ended = sectionUsage({ canceledAt: iso(-90), canceledEffectiveAt: iso(-60) });
    const running = sectionUsage({});

    test('shows an ended subscription as cancelled, whatever its status column says', async () => {
        const wrapper = await mountSection(ended);

        // The row still reads ACTIVE — nothing transitions it — so a badge
        // driven by the status alone would say "Active" here.
        expect(ended.status).toBe('ACTIVE');
        expect(wrapper.text()).toContain(i18n.statusCanceled);
        expect(wrapper.text()).not.toContain(i18n.nextBillingDate);
    });

    test('and a running one keeps its badge and its billing date', async () => {
        const wrapper = await mountSection(running);

        expect(wrapper.text()).toContain(i18n.statusActive);
        expect(wrapper.text()).toContain(i18n.nextBillingDate);
    });

    test('offers no pending version to accept once the contract is over', async () => {
        // The route answers SUBSCRIPTION_ENDED; a banner offering the act would
        // turn a state the page could show into an error dialog.
        const wrapper = await mountSection(ended);

        expect(wrapper.findComponent({ name: 'PendingVersionBanner' }).exists()).toBe(false);
    });

    test('while a running subscription is asked about it', async () => {
        // The premise: the banner is hidden by the ending, not missing from the
        // fixture.
        const wrapper = await mountSection(running);

        expect(wrapper.findComponent({ name: 'PendingVersionBanner' }).exists()).toBe(true);
    });
});

describe('a cancellation that arrives after the page did', () => {
    // Every page mounts before its data arrives, so the moment a composable was
    // created says nothing about the moment its subject was. Measuring the
    // boundary from mount time waits too long and, in between, calls an ended
    // subscription running.
    test('is measured from now, not from when the card was created', async () => {
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
            const usage = ref({ canceledAt: null, canceledEffectiveAt: null });
            const wrapper = mount(
                {
                    components: { TenantPlanCardHeader },
                    setup: () => ({ usage }),
                    template: `<TenantPlanCardHeader :usage="usage" current-plan-name="Pro"
                        status-tone="positive" :status-label="'Active'" cycle-label="monthly"
                        :current-price-eur="29" current-price-unit="/ mo" :next-billing-date="null"
                        :format-currency="(v) => String(v)" :format-date="(v) => String(v)" />`,
                },
                { attachTo: document.body },
            );
            mounted.push(wrapper as VueWrapper);

            // Nine days pass with the card open and no cancellation on it.
            vi.advanceTimersByTime(9 * DAY);
            delays.length = 0;

            // Then one is loaded, five days out.
            usage.value = {
                canceledAt: new Date(Date.now() - DAY).toISOString(),
                canceledEffectiveAt: new Date(Date.now() + 5 * DAY).toISOString(),
            } as never;
            await nextTick();

            expect(delays.length, 'nothing was scheduled for the new subject').toBe(1);
            expect(
                delays[0],
                'the wait was measured from when the card was created, not from now',
            ).toBeLessThanOrEqual(5 * DAY);
        } finally {
            spy.mockRestore();
            vi.useRealTimers();
        }
    });
});
