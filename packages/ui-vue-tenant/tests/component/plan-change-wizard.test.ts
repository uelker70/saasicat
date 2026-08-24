import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { BillingCycleStr, CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';

// The wizard's two claims that no picture holds: a guarded step refuses to
// advance, and focus lands on the heading of the step that just appeared.
//
// Both are asserted at the wizard rather than only at `useSteps`, because the
// wiring is where they break — a guard read from the wrong ref, or a heading
// that never got the ref bound to it, leaves the composable correct and the
// wizard wrong.

const PLANS: CatalogPlan[] = [
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

const PREVIEW: PlanChangePreviewShape = {
    changeType: 'UPGRADE',
    isImmediate: true,
    effectiveAt: null,
    proration: null,
    limitsCheck: {},
    featuresGained: [],
    featuresLost: [],
    blockers: [],
    warnings: [],
    target: { plan: { monthlyNet: 20, yearlyNet: 200 } },
    projectedTrialEndsAt: null,
} as unknown as PlanChangePreviewShape;

const i18n = planChangeWizardI18n(defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE));
const mounted: VueWrapper[] = [];

function openWizard(overrides: Record<string, unknown> = {}) {
    const wrapper = mount(PlanChangeWizard, {
        attachTo: document.body,
        props: {
            modelValue: true,
            plans: PLANS,
            currentPlanId: 'pl-1',
            currentPlanName: 'Basic',
            currentCycle: 'MONTHLY' as BillingCycleStr,
            catalogQuotaKeys: ['users'],
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => iso.slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            previewPlanChange: () => Promise.resolve(PREVIEW),
            changePlan: () => Promise.resolve(),
            i18n,
            ...overrides,
        },
    });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

const panel = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel')!;
const stepHeading = () => panel().querySelector<HTMLElement>('.sp-wizard__step-title')!;
const nextButton = () =>
    [...panel().querySelectorAll('button')].find((b) => b.textContent?.trim() === i18n.next)!;

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

describe('the wizard refuses a step it may not leave', () => {
    test('no plan chosen: pressing next changes nothing', async () => {
        openWizard();
        await nextTick();
        expect(stepHeading().textContent?.trim()).toBe(i18n.stepChoose);

        nextButton().click();
        await nextTick();
        expect(stepHeading().textContent?.trim()).toBe(i18n.stepChoose);
    });

    test('choosing the plan the tenant is already on is not a change', async () => {
        // Same plan, same cycle — the guard's other half, and the one that a
        // "did the user pick something" check would let through.
        const wrapper = openWizard();
        await nextTick();
        await pickPlan(wrapper, 'pl-1');

        nextButton().click();
        await nextTick();
        expect(stepHeading().textContent?.trim()).toBe(i18n.stepChoose);
    });

    test('a different plan advances', async () => {
        const wrapper = openWizard();
        await nextTick();
        await pickPlan(wrapper, 'pl-2');

        nextButton().click();
        await nextTick();
        expect(stepHeading().textContent?.trim()).toBe(i18n.stepPreview);
    });
});

describe('the next button says whether it will do anything', () => {
    // The behaviour tests above prove the guard refuses the move. They pass
    // just as well when the button is enabled and inert, which is what the
    // rewrite left behind: the old `q-btn` carried `:disable`, the replacement
    // carried nothing, and a control that looks pressable and does nothing is
    // a worse answer than one that is plainly unavailable.

    test('no plan chosen: the button is disabled', async () => {
        openWizard();
        await nextTick();
        expect(nextButton().disabled).toBe(true);
    });

    test('the plan the tenant is already on: still disabled', async () => {
        const wrapper = openWizard();
        await nextTick();
        await pickPlan(wrapper, 'pl-1');
        expect(nextButton().disabled).toBe(true);
    });

    test('a different plan: enabled', async () => {
        const wrapper = openWizard();
        await nextTick();
        await pickPlan(wrapper, 'pl-2');
        expect(nextButton().disabled).toBe(false);
    });

    test('on the preview step it follows the blockers', async () => {
        // Same binding, second step: the guard there is "no blockers", and the
        // wizard reads it through the step machine rather than beside it.
        const wrapper = openWizard({
            previewPlanChange: () =>
                Promise.resolve({
                    ...PREVIEW,
                    blockers: [{ code: 'LIMIT', message: 'over quota' }],
                } as unknown as PlanChangePreviewShape),
        });
        await nextTick();
        await pickPlan(wrapper, 'pl-2');
        nextButton().click();
        await flush();

        expect(stepHeading().textContent?.trim()).toBe(i18n.stepPreview);
        expect(nextButton().disabled).toBe(true);
    });
});

describe('focus follows the step the tenant is now on', () => {
    test('advancing moves focus to the new heading', async () => {
        const wrapper = openWizard();
        await nextTick();
        await pickPlan(wrapper, 'pl-2');

        nextButton().click();
        await nextTick();
        await nextTick();
        expect(document.activeElement).toBe(stepHeading());
        expect(stepHeading().textContent?.trim()).toBe(i18n.stepPreview);
    });

    test('a refused move leaves focus alone', async () => {
        openWizard();
        await nextTick();
        const before = document.activeElement;

        nextButton().click();
        await nextTick();
        await nextTick();
        expect(document.activeElement).toBe(before);
    });
});

describe('the progress list says where the tenant is without relying on colour', () => {
    test('exactly one step is marked current, and it carries a word', async () => {
        openWizard();
        await nextTick();
        const current = panel().querySelectorAll('[aria-current="step"]');
        expect(current).toHaveLength(1);
        expect(current[0]!.textContent).toContain(i18n.stepChoose);
    });
});

/** Lets the preview promise settle and the wizard re-render. */
async function flush() {
    await Promise.resolve();
    await nextTick();
    await nextTick();
}

/** Clicks the plan tile in the grid, the way a tenant does. */
async function pickPlan(wrapper: VueWrapper, planId: string) {
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', planId);
    await nextTick();
}
