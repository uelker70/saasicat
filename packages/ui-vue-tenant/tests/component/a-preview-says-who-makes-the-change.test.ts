// A user of the tenant who is not its administrator sees what a plan change
// would cost and is told, at the preview, that the administration makes it —
// rather than walking to the last step and being refused there (`SC-ADM-026`).

// @requirement SC-ADM-026 — The administrator changes what the tenant pays; billing needs the billing permission

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { CatalogPlan, PlanChangePreviewShape } from '@saasicat/ui-vue';
import { DEFERRED_UPGRADE } from './support/plan-change-previews.js';

const i18n = planChangeWizardI18n(defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE));

const plan = (id: string, name: string, monthlyNet: number): CatalogPlan => ({
    id,
    name,
    tagline: '',
    monthlyNet,
    yearlyNet: monthlyNet * 10,
    popular: false,
    quotas: {},
    features: [],
});
const PLANS = [plan('pl-1', 'Basic', 10), plan('pl-2', 'Pro', 20)];

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

/** The wizard at its preview step, the server answering `preview` for any question. */
async function atThePreview(preview: PlanChangePreviewShape) {
    const wrapper = mount(PlanChangeWizard, {
        attachTo: document.body,
        props: {
            modelValue: true,
            plans: PLANS,
            currentPlanId: 'pl-1',
            currentPlanName: 'Basic',
            currentCycle: 'MONTHLY',
            catalogQuotaKeys: [],
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => String(iso).slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            previewPlanChange: () => Promise.resolve(preview),
            changePlan: () => Promise.resolve(),
            i18n,
        },
    });
    // SAFETY: `mount` types a wrapper by its component's props; the list holds
    // wrappers of any component and only ever unmounts them.
    mounted.push(wrapper as VueWrapper);
    wrapper.findComponent({ name: 'PlanGrid' }).vm.$emit('update:modelValue', 'pl-2');
    await flushPromises();
    buttonNamed(i18n.next)!.click();
    await flushPromises();
    expect(panel().querySelector('.sp-wizard__step-title')?.textContent?.trim()).toBe(
        i18n.stepPreview,
    );
}

const panel = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel')!;
const buttonNamed = (label: string) =>
    [...panel().querySelectorAll('button')].find((button) => button.textContent?.trim() === label);

describe('the preview of a plan change', () => {
    test('read by a user who may not change it, says the administration makes the change', async () => {
        await atThePreview({ ...DEFERRED_UPGRADE, mayChange: false });

        expect(panel().textContent).toContain(i18n.changedByAdministration);
        expect(buttonNamed(i18n.next), 'a way on to a refusal').toBeUndefined();
        expect(buttonNamed(i18n.back)).toBeTruthy();
    });

    test('read by the administrator, goes on to the confirmation', async () => {
        await atThePreview({ ...DEFERRED_UPGRADE, mayChange: true });

        expect(panel().textContent).not.toContain(i18n.changedByAdministration);
        expect(buttonNamed(i18n.next)).toBeTruthy();
    });

    test('from a server that does not say, goes on as it did', async () => {
        await atThePreview(DEFERRED_UPGRADE);

        expect(buttonNamed(i18n.next)).toBeTruthy();
    });
});
