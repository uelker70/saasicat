// A user of the tenant who is not its administrator sees what a plan change
// would cost and is told, at the preview, that the administration makes it —
// rather than walking to the last step and being refused there (`SC-ADM-026`).
// The same holds for an add-on's booking and its cancellation, which share one
// dialog.

// @requirement SC-ADM-026 — The administrator changes what the tenant pays; billing needs the billing permission

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import { computed } from 'vue';
import PlanChangeWizard from '../../src/PlanChangeWizard.vue';
import BundlePreviewDialog from '../../src/tenant-plan-section/BundlePreviewDialog.vue';
import { defaultTenantPlanSectionI18n, planChangeWizardI18n } from '../../src/default-i18n';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type {
    BundleAddPreviewShape,
    BundleCancelPreviewShape,
    CatalogPlan,
    PlanChangePreviewShape,
} from '@saasicat/ui-vue';
import { DEFERRED_UPGRADE } from './support/plan-change-previews.js';
import { answered } from './support/server-days.js';

const catalogue = defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE);
const i18n = planChangeWizardI18n(catalogue);

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

const BOOKING = answered(
    {
        action: 'add',
        bundle: {
            bundleVersionId: 'bv-1',
            bundleKey: 'ANALYTICS',
            label: 'Analytics',
            features: [],
            quotas: {},
        },
        billingCycle: 'MONTHLY',
        blockers: [],
        warnings: [],
        proration: null,
        nextPeriodPriceNet: 9,
        minimumTermMonths: 0,
        minimumTermEndsAt: null,
        firstPeriodEnd: '2026-06-01T00:00:00.000Z',
        endsWithPlanAt: null,
        missingRequires: [],
        redundantFeatures: [],
    },
    ['minimumTermEndsAt', 'firstPeriodEnd', 'endsWithPlanAt'],
) satisfies BundleAddPreviewShape;

const CANCELLATION = answered(
    {
        action: 'cancel',
        subscriptionBundleId: 'sb-1',
        bundle: BOOKING.bundle,
        billingCycle: 'MONTHLY',
        effectiveAt: '2026-06-01T00:00:00.000Z',
        nextPeriodSavingsNet: 9,
        blockers: [],
        warnings: [],
    },
    ['effectiveAt'],
) satisfies BundleCancelPreviewShape;

/** The add-on dialog showing `preview`. */
function theAddOnDialogShowing(preview: BundleAddPreviewShape | BundleCancelPreviewShape) {
    const wrapper = mount(BundlePreviewDialog, {
        attachTo: document.body,
        global: {
            plugins: [
                {
                    install: (app) =>
                        app.provide(
                            TENANT_I18N_KEY,
                            computed(() => catalogue),
                        ),
                },
            ],
        },
        props: {
            modelValue: true,
            preview,
            loading: false,
            error: null,
            submitting: false,
            subscriptionStatus: 'ACTIVE',
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => iso.slice(0, 10),
            featureLabel: (key: string) => key,
        },
    });
    // SAFETY: `mount` types a wrapper by its component's props; the list holds
    // wrappers of any component and only ever unmounts them.
    mounted.push(wrapper as VueWrapper);
}

describe("the preview of an add-on's booking or cancellation", () => {
    test.each([
        ['a booking', BOOKING, catalogue.bundlePreviewConfirmAdd],
        ['a cancellation', CANCELLATION, catalogue.bundlePreviewConfirmCancel],
    ] as const)(
        'of %s, read by a user who may not make it, says the administration makes it',
        (_, preview, confirm) => {
            theAddOnDialogShowing({ ...preview, mayChange: false });

            expect(panel().textContent).toContain(catalogue.bundlePreviewByAdministration);
            expect(buttonNamed(confirm), 'a way on to a refusal').toBeUndefined();
            expect(buttonNamed(catalogue.bundlePreviewClose)).toBeTruthy();
        },
    );

    test.each([
        ['a booking', BOOKING, catalogue.bundlePreviewConfirmAdd],
        ['a cancellation', CANCELLATION, catalogue.bundlePreviewConfirmCancel],
    ] as const)('of %s, read by the administrator, offers to confirm it', (_, preview, confirm) => {
        theAddOnDialogShowing({ ...preview, mayChange: true });

        expect(panel().textContent).not.toContain(catalogue.bundlePreviewByAdministration);
        expect(buttonNamed(confirm)).toBeTruthy();
    });

    test('from a server that does not say, offers to confirm it as it did', () => {
        theAddOnDialogShowing(BOOKING);

        expect(buttonNamed(catalogue.bundlePreviewConfirmAdd)).toBeTruthy();
    });
});
