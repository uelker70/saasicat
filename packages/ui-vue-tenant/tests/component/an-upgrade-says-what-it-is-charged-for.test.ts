import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { BillingCycleStr, CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';

// An immediate upgrade is charged one of two ways, and the preview has to say
// which. In the same rhythm it is the difference for what is left of the
// period; into a longer rhythm it is the new period's full price, less the
// unused rest of the old one. A page that showed the second as "additional
// amount until the end of the period" would name a figure for a period it is
// not charged for.

const PLANS: CatalogPlan[] = [
    {
        id: 'pl-1',
        key: 'BASIC',
        name: 'Basic',
        monthlyNet: 49,
        yearlyNet: 490,
        quotas: {},
        features: [],
    },
    {
        id: 'pl-2',
        key: 'PRO',
        name: 'Pro',
        monthlyNet: 99,
        yearlyNet: 990,
        quotas: {},
        features: [],
    },
] as unknown as CatalogPlan[];

function previewWith(proration: Record<string, unknown>): PlanChangePreviewShape {
    return {
        changeType: 'UPGRADE',
        planDirection: 'UP',
        cycleDirection: proration.basis === 'newPeriod' ? 'LONGER' : 'SAME',
        isImmediate: true,
        effectiveAt: null,
        proration: {
            daysRemainingInPeriod: 15,
            daysInPeriod: 30,
            periodStart: '2026-06-01T00:00:00.000Z',
            periodEnd: '2026-07-01T00:00:00.000Z',
            currentPriceNet: 49,
            ...proration,
        },
        limitsCheck: {},
        featuresGained: [],
        featuresLost: [],
        blockers: [],
        warnings: [],
        target: { plan: { monthlyNet: 99, yearlyNet: 990 } },
        projectedTrialEndsAt: null,
    } as unknown as PlanChangePreviewShape;
}

const i18n = planChangeWizardI18n(defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE));
const mounted: VueWrapper[] = [];

async function previewStep(preview: PlanChangePreviewShape): Promise<HTMLElement> {
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
            previewPlanChange: () => Promise.resolve(preview),
            changePlan: () => Promise.resolve(),
            i18n,
        },
    });
    mounted.push(wrapper as VueWrapper);
    await nextTick();
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
    await nextTick();
    const panel = document.body.querySelector<HTMLElement>('.sp-dialog__panel')!;
    [...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === i18n.next)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    return panel.querySelector<HTMLElement>('.sp-wizard__proration')!;
}

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

describe('the preview names what an upgrade is charged for', () => {
    // @requirement SC-CHG-021 — An immediate upgrade into a longer rhythm starts today, less the unused rest
    test('into a longer rhythm: the new period in full, and the rest it is reduced by', async () => {
        const block = await previewStep(
            previewWith({
                basis: 'newPeriod',
                targetPriceNet: 990,
                remainderNet: 24.5,
                prorataDeltaNet: 965.5,
                rawDeltaNet: 965.5,
                isFree: false,
            }),
        );

        const text = block.textContent ?? '';
        expect(text).toContain(i18n.newPeriodLine);
        expect(text).toContain('€ 990.00');
        expect(text).toContain(i18n.remainderLine);
        expect(text).toContain('€ 24.50');
        expect(text).not.toContain(i18n.prorationLine);
    });

    // @requirement SC-CHG-020 — An immediate upgrade in the same rhythm runs inside the period already paid
    test('in the same rhythm: the difference for what is left of the period', async () => {
        const block = await previewStep(
            previewWith({
                basis: 'difference',
                targetPriceNet: 99,
                remainderNet: 0,
                prorataDeltaNet: 25,
                rawDeltaNet: 25,
                isFree: false,
            }),
        );

        const text = block.textContent ?? '';
        expect(text).toContain(i18n.prorationLine);
        expect(text).toContain('€ 25.00');
        expect(text).not.toContain(i18n.newPeriodLine);
    });
});
