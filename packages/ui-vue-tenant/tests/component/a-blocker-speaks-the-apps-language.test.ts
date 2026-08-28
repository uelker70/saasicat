import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import {
    DEFAULT_I18N_DE,
    DEFAULT_I18N_EN,
    planChangeWizardI18n,
    type TenantPlanSectionI18n,
} from '../../src/default-i18n';
import type { BillingCycleStr, CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';

// A blocker is the sentence that tells a tenant why the button is dead, and it
// has to arrive in the language the rest of the dialog is in.
//
// The wizard used to pick its catalogue itself — `locale === 'de' ? de : en` —
// which knew only the two languages the platform ships. An app that adds one
// through `additionalLocales`, or hands over its own `i18n` map, got its own
// wording on the controls and German or English on the blocker underneath
// them, with nowhere to say otherwise. The catalogue now travels in the same
// `i18n` object as every other string, so the two cannot disagree.
//
// Asserted as whole sentences on purpose. "not English" would also pass if the
// text were replaced by anything at all, including a bare code.

const PLANS = [
    { id: 'pl-1', key: 'BASIC', name: 'Basic', monthlyNet: 10, yearlyNet: 100, quotas: {} },
    { id: 'pl-2', key: 'PRO', name: 'Pro', monthlyNet: 20, yearlyNet: 200, quotas: {} },
] as unknown as CatalogPlan[];

/** One blocker of each kind the plan-change preview can raise with values. */
const BLOCKERS = [
    {
        code: 'QUOTA_OVER_TARGET',
        message: 'Current usage 11 exceeds the target limit 5 (vehicles) in the Basic plan.',
        params: { used: '11', targetMax: 5, quotaKey: 'vehicles', planName: 'Basic' },
    },
];

function previewWith(blockers: unknown[]): PlanChangePreviewShape {
    return {
        changeType: 'DOWNGRADE',
        isImmediate: true,
        effectiveAt: null,
        proration: null,
        limitsCheck: {},
        featuresGained: [],
        featuresLost: [],
        blockers,
        warnings: [],
        target: { plan: { monthlyNet: 20, yearlyNet: 200 } },
        projectedTrialEndsAt: null,
    } as unknown as PlanChangePreviewShape;
}

const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

/** Mounts the wizard on `section`'s catalogue and walks it to the preview step. */
async function blockerLines(
    section: TenantPlanSectionI18n,
    blockers: unknown[] = BLOCKERS,
): Promise<string[]> {
    const wrapper = mount(PlanChangeWizard, {
        attachTo: document.body,
        props: {
            modelValue: true,
            plans: PLANS,
            currentPlanId: 'pl-1',
            currentPlanName: 'Basic',
            currentCycle: 'MONTHLY' as BillingCycleStr,
            catalogQuotaKeys: [],
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => iso.slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            previewPlanChange: () => Promise.resolve(previewWith(blockers)),
            changePlan: () => Promise.resolve(),
            i18n: planChangeWizardI18n(section),
        },
    });
    mounted.push(wrapper as VueWrapper);
    await nextTick();

    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
    await nextTick();
    const panel = document.body.querySelector<HTMLElement>('.sp-dialog__panel')!;
    [...panel.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === section.wizardNext)!
        .click();
    await Promise.resolve();
    await nextTick();
    await nextTick();

    return [...panel.querySelectorAll('.sp-wizard__blockers li')].map((li) =>
        li.textContent!.replace(/\s+/g, ' ').trim(),
    );
}

/** An app's own catalogue, in a language the platform ships no catalogue for. */
const FRENCH: TenantPlanSectionI18n = {
    ...DEFAULT_I18N_EN,
    issueMessages: {
        QUOTA_OVER_TARGET:
            "L'utilisation actuelle {used} dépasse la limite {targetMax} ({quotaKey}) " +
            'du forfait {planName}.',
    },
};

describe('the blocker is read in the language the app chose', () => {
    test('the shipped German catalogue renders the German sentence', async () => {
        expect(await blockerLines(DEFAULT_I18N_DE)).toEqual([
            'Aktuelle Nutzung 11 überschreitet das Ziel-Limit 5 (vehicles) im Paket Basic. ' +
                'Bitte zuerst die Nutzung reduzieren.',
        ]);
    });

    test('the shipped English catalogue renders the English sentence', async () => {
        expect(await blockerLines(DEFAULT_I18N_EN)).toEqual([
            'Current usage 11 exceeds the target limit 5 (vehicles) in the Basic plan. ' +
                'Please reduce usage first.',
        ]);
    });

    test("an app's own catalogue wins, in a language the platform does not ship", async () => {
        // The case the hardcoded branch could not serve: `fr` is neither of the
        // two catalogues, so the app has to be able to say the sentence itself.
        expect(await blockerLines(FRENCH)).toEqual([
            "L'utilisation actuelle 11 dépasse la limite 5 (vehicles) du forfait Basic.",
        ]);
    });

    test('a code the app left untranslated still reads, from the shipped text', async () => {
        // A partial catalogue is the normal case, and it must not leave a blank
        // line next to a disabled button.
        const lines = await blockerLines(FRENCH, [
            ...BLOCKERS,
            { code: 'PLAN_NOT_SELF_SERVICE', message: 'ignored', params: { planName: 'Pro' } },
        ]);
        expect(lines[1]).toBe(
            'Pro is only activated via a special contract. Please contact the contract manager.',
        );
    });

    test('a code nobody has a text for falls back to the message the backend sent', async () => {
        const lines = await blockerLines(DEFAULT_I18N_DE, [
            { code: 'SOMETHING_AN_APP_ADDED', message: 'Refused by the billing provider.' },
        ]);
        expect(lines).toEqual(['Refused by the billing provider.']);
    });
});
