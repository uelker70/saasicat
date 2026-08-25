import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { BillingCycleStr, CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';

// What the confirmation step shows has to be the answer to the question it is
// asking. Between the two there is a network.
//
// The wizard re-asks whenever the cycle changes, and until this file existed it
// kept the previous answer on screen while the new one travelled: its date, its
// price, its `isImmediate`. A reader could tick "I understand this happens on
// 1 January" and press confirm, and the server — which decides the timing
// itself, and no longer takes it from the request — would apply a yearly
// upgrade on the spot and prorate it. The screen and the invoice described
// different events.
//
// The second half is the order of the answers. Two questions can be outstanding
// at once, and nothing makes the network answer them in the order they were
// asked; the slower earlier one wins simply by arriving last.

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
    effectiveAt: '2027-01-01T00:00:00.000Z',
    proration: null,
    limitsCheck: {},
    featuresGained: [],
    featuresLost: [],
    blockers: [],
    warnings: [],
    target: { plan: { monthlyNet: 20, yearlyNet: 200 } },
    projectedTrialEndsAt: null,
} as unknown as PlanChangePreviewShape;

const IMMEDIATE: PlanChangePreviewShape = {
    ...DEFERRED,
    cycleDirection: 'SAME',
    isImmediate: true,
    effectiveAt: null,
} as unknown as PlanChangePreviewShape;

const i18n = planChangeWizardI18n(defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE));
const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

/** A stub server that answers when the test says so, not when it is asked. */
function heldPreviews() {
    const pending: { cycle: BillingCycleStr; settle: (dto: PlanChangePreviewShape) => void }[] = [];
    const previewPlanChange = (_plan: string, cycle: BillingCycleStr) =>
        new Promise<PlanChangePreviewShape>((resolve) => {
            pending.push({ cycle, settle: resolve });
        });
    /** Answers the oldest outstanding question for `cycle`. */
    const answer = async (cycle: BillingCycleStr, dto: PlanChangePreviewShape) => {
        const at = pending.findIndex((p) => p.cycle === cycle);
        expect(at, `nothing was asked for the ${cycle} cycle`).toBeGreaterThan(-1);
        pending.splice(at, 1)[0].settle(dto);
        await nextTick();
        await Promise.resolve();
        await nextTick();
    };
    return { previewPlanChange, answer, outstanding: () => pending.length };
}

function openWizard(
    previewPlanChange: (plan: string, cycle: BillingCycleStr) => Promise<PlanChangePreviewShape>,
) {
    const wrapper = mount(PlanChangeWizard, {
        attachTo: document.body,
        props: {
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
            previewPlanChange,
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
const confirmLine = () => panel().querySelector<HTMLElement>('.sp-wizard__confirm-line');
const stepHeading = () => panel().querySelector<HTMLElement>('.sp-wizard__step-title')!;
const setCycle = async (wrapper: VueWrapper, cycle: BillingCycleStr) => {
    (wrapper.vm as unknown as { targetCycle: BillingCycleStr }).targetCycle = cycle;
    await nextTick();
};

/**
 * Walks to the confirmation step with `pl-2` and the monthly cycle chosen,
 * answering the preview question on the way — the step guard will not let a
 * reader past an unanswered one.
 */
async function reachConfirmation(
    wrapper: VueWrapper,
    server: ReturnType<typeof heldPreviews>,
    dto: PlanChangePreviewShape,
) {
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
    await nextTick();
    await setCycle(wrapper, 'MONTHLY');
    await clickNext();
    await server.answer('MONTHLY', dto);
    await clickNext();
    expect(stepHeading().textContent?.trim()).toBe(i18n.stepConfirm);
}

async function clickNext() {
    const next = [...panel().querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === i18n.next,
    );
    expect(next, 'no next button').toBeTruthy();
    expect(next!.disabled, 'the next button was disabled').toBe(false);
    next!.click();
    await nextTick();
}

/** The deferral block's way out, which only changes the target cycle. */
async function clickKeepYearly() {
    const keep = [...block()!.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === i18n.deferredKeepYearly,
    );
    expect(keep, 'no "keep yearly" button in the deferral block').toBeTruthy();
    keep!.click();
    await nextTick();
}

describe('while a replacement preview is on the wire', () => {
    test('the answer to the abandoned question is taken off the screen', async () => {
        const server = heldPreviews();
        const wrapper = openWizard(server.previewPlanChange);
        await reachConfirmation(wrapper, server, DEFERRED);

        expect(block(), 'no deferral block to begin with').not.toBeNull();
        expect(confirmLine()?.textContent).toContain('2027-01-01');

        await clickKeepYearly();

        expect(block(), 'the abandoned answer stayed on screen').toBeNull();
        expect(confirmLine(), 'its date stayed on screen').toBeNull();
    });

    test('and the confirmation cannot be given', async () => {
        const server = heldPreviews();
        const wrapper = openWizard(server.previewPlanChange);
        await reachConfirmation(wrapper, server, DEFERRED);

        const box = block()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await nextTick();
        expect(
            confirmButton()!.hasAttribute('disabled'),
            'an acknowledged deferral stays locked',
        ).toBe(false);

        [...block()!.querySelectorAll('button')]
            .find((b) => b.textContent?.trim() === i18n.deferredKeepYearly)!
            .click();
        await nextTick();

        expect(
            confirmButton()!.hasAttribute('disabled'),
            'confirmable with no answer on screen',
        ).toBe(true);

        await server.answer('YEARLY', IMMEDIATE);
        expect(
            confirmButton()!.hasAttribute('disabled'),
            'still locked after the answer arrived',
        ).toBe(false);
        expect(panel().textContent).toContain(i18n.confirmImmediate);
    });
});

describe('when the answers come back out of order', () => {
    test('the outdated one does not install itself', async () => {
        const server = heldPreviews();
        const wrapper = openWizard(server.previewPlanChange);
        await reachConfirmation(wrapper, server, DEFERRED);

        // Two questions outstanding: the yearly one asked second, the monthly
        // one asked third when the reader changed their mind back.
        await clickKeepYearly();
        await setCycle(wrapper, 'MONTHLY');
        expect(server.outstanding(), 'the second change asked nothing').toBe(2);

        // The later question is answered first; the earlier one arrives after.
        await server.answer('MONTHLY', DEFERRED);
        await server.answer('YEARLY', IMMEDIATE);

        expect(
            panel().textContent,
            'the abandoned yearly answer won by arriving last',
        ).not.toContain(i18n.confirmImmediate);
        expect(block(), 'the current monthly answer was overwritten').not.toBeNull();
    });
});
