// @requirement SC-CHG-008 — A change that arrives later is the headline, and has to be acknowledged

import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { BillingCycleStr, CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';

import type { DaysAround } from '@saasicat/core';

import { answered } from './support/server-days.js';

// A yearly customer choosing a monthly higher plan gets everything later.
//
// The change is allowed — they may have a monthly plan from the end of their
// term — but nothing about it arrives today: not the features, not the quotas,
// not the price. Somebody who presses "upgrade" and sees no change for eleven
// months has been told something they did not read, and a line among the
// warnings is exactly the place a reader does not read.
//
// So the consequence is the heading, the alternative is a button beside it, and
// the confirmation is locked until the sentence is acknowledged. The three
// assertions below are the three halves of that, and the fourth is the one that
// matters most: an acknowledgement of one date is not an acknowledgement of the
// next.

const PLANS = [
    {
        id: 'pl-1',
        key: 'BASIC',
        name: 'Basic',
        monthlyNet: 10,
        yearlyNet: 100,
        quotas: { users: 5 },
        features: [],
    },
    {
        id: 'pl-2',
        key: 'PRO',
        name: 'Pro',
        monthlyNet: 20,
        yearlyNet: 200,
        quotas: { users: 50 },
        features: [],
    },
] as unknown as CatalogPlan[];

const DEFERRED: PlanChangePreviewShape = {
    changeType: 'UPGRADE',
    planDirection: 'UP',
    cycleDirection: 'SHORTER',
    isImmediate: false,
    ...answered({ effectiveAt: '2027-01-01T00:00:00.000Z', projectedTrialEndsAt: null }, [
        'effectiveAt',
        'projectedTrialEndsAt',
    ]),
    proration: null,
    limitsCheck: {},
    featuresGained: [],
    featuresLost: [],
    blockers: [],
    warnings: [],
    target: { plan: { monthlyNet: 20, yearlyNet: 200 } },
} as unknown as PlanChangePreviewShape;

/** A downgrade that costs features — the other thing a reader must acknowledge. */
const DOWNGRADE: PlanChangePreviewShape = {
    ...DEFERRED,
    changeType: 'DOWNGRADE',
    planDirection: 'DOWN',
    cycleDirection: 'SAME',
    featuresLost: ['export', 'webhooks'],
} as unknown as PlanChangePreviewShape;

/** A downgrade that costs only quotas. Saying "0 features" reads as a bug. */
const DOWNGRADE_QUOTAS_ONLY: PlanChangePreviewShape = {
    ...DOWNGRADE,
    featuresLost: [],
} as unknown as PlanChangePreviewShape;

const IMMEDIATE: PlanChangePreviewShape = {
    ...DEFERRED,
    planDirection: 'UP',
    cycleDirection: 'SAME',
    isImmediate: true,
    effectiveAt: null,
    effectiveDays: null,
} as unknown as PlanChangePreviewShape;

/** Same plan, different rhythm: nothing lost, nothing gained, still not today. */
const CYCLE_ONLY: PlanChangePreviewShape = {
    ...DEFERRED,
    changeType: 'CYCLE_CHANGE',
    planDirection: 'SAME',
    cycleDirection: 'SHORTER',
    featuresLost: [],
} as unknown as PlanChangePreviewShape;

const i18n = planChangeWizardI18n(defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE));
const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

function openWizard(
    preview: PlanChangePreviewShape,
    previewFor?: (plan: string, cycle: BillingCycleStr) => Promise<PlanChangePreviewShape>,
    subscription: { currentStatus?: string; trialEndsDays?: DaysAround | null } = {},
) {
    const wrapper = mount(PlanChangeWizard, {
        attachTo: document.body,
        props: {
            ...subscription,
            modelValue: true,
            plans: PLANS,
            currentPlanId: 'pl-1',
            currentPlanName: 'Basic',
            currentCycle: 'YEARLY' as BillingCycleStr,
            catalogQuotaKeys: ['users'],
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => String(iso).slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            previewPlanChange: previewFor ?? (() => Promise.resolve(preview)),
            changePlan: () => Promise.resolve(),
            i18n,
        },
    });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

const panel = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel')!;
const block = () => panel().querySelector<HTMLElement>('.sp-wizard__deferred');
const confirmButton = () =>
    [...panel().querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === i18n.confirmAction,
    );

const stepHeading = () => panel().querySelector<HTMLElement>('.sp-wizard__step-title')!;
const nextButton = () =>
    [...panel().querySelectorAll('button')].find((b) => b.textContent?.trim() === i18n.next)!;

/** Walks the wizard to its confirmation step with `pl-2` chosen, as a user does. */
async function reachConfirmation(wrapper: VueWrapper) {
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
    await nextTick();
    while (stepHeading().textContent?.trim() !== i18n.stepConfirm) {
        const next = nextButton();
        if (!next || next.disabled) break;
        next.click();
        // The preview is fetched between the steps; let it land.
        await nextTick();
        await Promise.resolve();
        await nextTick();
    }
    expect(stepHeading().textContent?.trim()).toBe(i18n.stepConfirm);
}

describe('a shorter cycle defers everything, and says so first', () => {
    test('the block appears, led by what the customer does not get today', async () => {
        const wrapper = openWizard(DEFERRED);
        await reachConfirmation(wrapper);

        const shown = block();
        expect(shown, 'no deferral block on a shortened cycle').not.toBeNull();
        const lead = shown!.querySelector('.sp-wizard__deferred-lead');
        expect(lead?.textContent).toContain('2027-01-01');
        expect(lead?.textContent).toContain('Pro');
    });

    test('it offers the alternative rather than only describing it', async () => {
        const wrapper = openWizard(DEFERRED);
        await reachConfirmation(wrapper);
        expect(block()!.textContent).toContain(i18n.deferredKeepYearly);
        expect(block()!.querySelector('button')).not.toBeNull();
    });

    test('the confirmation is locked until it is acknowledged', async () => {
        const wrapper = openWizard(DEFERRED);
        await reachConfirmation(wrapper);

        const button = confirmButton();
        expect(button, 'no confirm button on the confirmation step').toBeTruthy();
        expect(button!.hasAttribute('disabled')).toBe(true);

        const box = block()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await nextTick();

        expect(confirmButton()!.hasAttribute('disabled')).toBe(false);
    });

    test('an ordinary upgrade shows none of it', async () => {
        const wrapper = openWizard(IMMEDIATE);
        await reachConfirmation(wrapper);
        expect(block()).toBeNull();
        expect(confirmButton()!.hasAttribute('disabled')).toBe(false);
    });

    test('a downgrade is a different sentence, not this one', async () => {
        // The case that separates "reads the directions" from "reads the date".
        // A downgrade is deferred too, and it needs its own acknowledgement —
        // but not the one that offers a yearly cycle as the way out.
        const wrapper = openWizard(DOWNGRADE);
        await reachConfirmation(wrapper);
        expect(block()).not.toBeNull();
        expect(block()!.textContent).not.toContain(i18n.deferredKeepYearly);
    });
});

describe('a downgrade names what falls away, and when', () => {
    test('the heading counts the features and dates the loss', async () => {
        const wrapper = openWizard(DOWNGRADE);
        await reachConfirmation(wrapper);

        const lead = block()!.querySelector('.sp-wizard__deferred-lead')!;
        expect(lead.textContent).toContain('2');
        expect(lead.textContent).toContain('2027-01-01');
    });

    test('every lost feature is listed, not just counted', async () => {
        // A number is not an answer to "what am I losing".
        const wrapper = openWizard(DOWNGRADE);
        await reachConfirmation(wrapper);

        const items = [...block()!.querySelectorAll('.sp-wizard__deferred-list li')].map((li) =>
            li.textContent?.trim(),
        );
        expect(items).toEqual(['export', 'webhooks']);
    });

    test('the confirmation is locked until it is acknowledged', async () => {
        const wrapper = openWizard(DOWNGRADE);
        await reachConfirmation(wrapper);
        expect(confirmButton()!.hasAttribute('disabled')).toBe(true);

        const box = block()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await nextTick();
        expect(confirmButton()!.hasAttribute('disabled')).toBe(false);
    });

    test('a downgrade that costs no feature says so instead of counting zero', async () => {
        // "0 features" where nothing is lost reads as a defect rather than as
        // good news, and the quotas are the real change in that case.
        const wrapper = openWizard(DOWNGRADE_QUOTAS_ONLY);
        await reachConfirmation(wrapper);

        // Compared against the whole rendered sentence, because the two
        // templates share their opening: both start with the date, so a prefix
        // check cannot tell them apart — and neither can `not.toContain('0')`,
        // which the date itself satisfies. Two drafts, two false passes.
        const lead = block()!.querySelector('.sp-wizard__deferred-lead')!.textContent?.trim();
        expect(lead).toBe(
            i18n.downgradeLeadQuotasOnly.replace('{date}', '2027-01-01').replace('{plan}', 'Pro'),
        );
        expect(block()!.querySelector('.sp-wizard__deferred-list li')).toBeNull();
    });
});

describe('a cycle change is acknowledged too', () => {
    test('it says the rhythm changes later, and a new term starts then', async () => {
        // Nothing is lost and nothing is gained, so nobody would look for a
        // consequence — which is exactly why the new minimum term has to be
        // said rather than met on an invoice.
        const wrapper = openWizard(CYCLE_ONLY);
        await reachConfirmation(wrapper);

        const shown = block();
        expect(shown, 'no acknowledgement on a cycle change').not.toBeNull();
        expect(shown!.querySelector('.sp-wizard__deferred-lead')!.textContent).toContain(
            '2027-01-01',
        );
        expect(shown!.textContent).not.toContain(i18n.deferredKeepYearly);
    });

    test('the confirmation is locked until it is acknowledged', async () => {
        const wrapper = openWizard(CYCLE_ONLY);
        await reachConfirmation(wrapper);
        expect(confirmButton()!.hasAttribute('disabled')).toBe(true);

        const box = block()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await nextTick();
        expect(confirmButton()!.hasAttribute('disabled')).toBe(false);
    });
});

describe('the dates stand out from the sentence around them', () => {
    test('the effective date is set in bold, the rest is not', async () => {
        // Through parts rather than `v-html`: a translation a consumer supplies
        // must never become markup.
        const wrapper = openWizard(DEFERRED);
        await reachConfirmation(wrapper);

        const strong = [...block()!.querySelectorAll('strong')].map((el) => el.textContent);
        expect(strong).toContain('2027-01-01');
        expect(block()!.querySelector('.sp-wizard__deferred-lead strong')).not.toBeNull();
    });
});

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server
describe('the day a change takes effect, from either side of it', () => {
    // The days are set apart from each other and from the moment's own date: a
    // sentence that wrote the moment, or the other side, writes a day that
    // appears nowhere as the right one.
    const UNTIL = '2026-12-30';
    const FROM = '2026-12-31';
    const SPLIT: PlanChangePreviewShape = {
        ...DOWNGRADE,
        effectiveDays: { until: UNTIL, from: FROM },
    };

    test('what falls away does so from the first day, and what stays runs until the last', async () => {
        const wrapper = openWizard(SPLIT);
        await reachConfirmation(wrapper);

        const [lead = '', body = ''] = [...block()!.querySelectorAll('p')].map(
            (paragraph) => paragraph.textContent ?? '',
        );
        expect(lead).toContain(FROM);
        expect(lead).not.toContain(UNTIL);
        expect(body).toContain(UNTIL);
        expect(body).not.toContain(FROM);
        const [, bodyLine] = [...block()!.querySelectorAll('p')];
        expect(bodyLine?.querySelector('strong')?.textContent).toBe(UNTIL);
    });

    test('the preview names the first day the change applies', async () => {
        const wrapper = openWizard(SPLIT);
        wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
        await nextTick();
        nextButton().click();
        await nextTick();
        await Promise.resolve();
        await nextTick();

        const effective = panel().querySelector('.sp-wizard__type')?.textContent ?? '';
        expect(effective).toContain(`${i18n.effectiveAtLabel}: ${FROM}`);
        expect(effective).not.toContain(UNTIL);
    });

    test('the confirmation names the first day the change applies, and the price is due from it', async () => {
        const wrapper = openWizard(SPLIT);
        await reachConfirmation(wrapper);

        const line = panel().querySelector('.sp-wizard__confirm-line')?.textContent ?? '';
        expect(line).toContain(FROM);
        expect(line).not.toContain(UNTIL);
        expect(panel().textContent).toContain(`${i18n.confirmRecurringFrom} ${FROM}`);
    });

    test('a trial pays regularly from its end, named by the last day the trial covers', async () => {
        const trial = { until: '2027-03-14', from: '2027-03-15' };
        const wrapper = openWizard(SPLIT, undefined, {
            currentStatus: 'TRIAL',
            trialEndsDays: trial,
        });
        await reachConfirmation(wrapper);

        expect(panel().textContent).toContain(`${i18n.confirmRecurringTrialEnd} (2027-03-14)`);
    });

    test('and from the trial the change projects, where it projects one', async () => {
        const projected: PlanChangePreviewShape = {
            ...SPLIT,
            projectedTrialEndsDays: { until: '2027-04-29', from: '2027-04-30' },
        };
        const wrapper = openWizard(projected, undefined, {
            currentStatus: 'TRIAL',
            trialEndsDays: { until: '2027-03-14', from: '2027-03-15' },
        });
        await reachConfirmation(wrapper);

        expect(panel().textContent).toContain(`${i18n.confirmRecurringTrialEnd} (2027-04-29)`);
    });
});

describe('keeping the yearly cycle re-asks rather than reusing the answer', () => {
    test('the block disappears once the preview describes the new choice', async () => {
        // The button changed only `targetCycle`. The preview still described
        // the monthly deferral — its date, its price, its `isImmediate` — so
        // submitting would have scheduled at term end the very change the
        // button promised for today.
        // The stub answers per cycle, as the server does: monthly defers,
        // yearly does not.
        const wrapper = openWizard(DEFERRED, (_plan, cycle) =>
            Promise.resolve(cycle === 'YEARLY' ? IMMEDIATE : DEFERRED),
        );
        await reachConfirmation(wrapper);
        // The wizard opens on the current cycle, which is yearly here; the
        // reader picks monthly, which is the case this block exists for.
        (wrapper.vm as unknown as { targetCycle: BillingCycleStr }).targetCycle = 'MONTHLY';
        await nextTick();
        await Promise.resolve();
        await nextTick();
        expect(block(), 'no deferral after choosing the monthly cycle').not.toBeNull();

        const keep = [...block()!.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === i18n.deferredKeepYearly,
        )!;
        keep.click();
        await nextTick();
        await Promise.resolve();
        await nextTick();

        expect(block(), 'the deferral block survived a cycle that no longer defers').toBeNull();
        expect(confirmButton()!.hasAttribute('disabled')).toBe(false);
    });
});
