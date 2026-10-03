// @requirement SC-BUN-016 — A tenant reads what a booking commits to before confirming it

import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { computed, nextTick } from 'vue';

import BundlePreviewDialog from '../../src/tenant-plan-section/BundlePreviewDialog.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n';
import type { BundlePreviewShape } from '@saasicat/ui-vue';

// What a tenant is told before they agree to a bundle.
//
// A bundle runs in step with the plan that pays for it: its periods end on the
// plan's billing day, and it ends when the plan does, without a cancellation of
// its own. Both of those are terms of the booking, so both have to be on the
// screen the tenant confirms — the first period they are committing to, the day
// the plan takes it down with it, and the fact that a period cut short that way
// is not refunded.
//
// The panel is teleported to `document.body`, so it is read from there;
// `wrapper.find` never sees a teleported node and a test looking for it in the
// wrapper would pass by finding nothing.

const BASE: BundlePreviewShape = {
    action: 'add',
    bundle: { bundleVersionId: 'bv-1', bundleKey: 'ANALYTICS', label: 'Analytics' },
    billingCycle: 'MONTHLY',
    blockers: [],
    warnings: [],
    proration: null,
    nextPeriodPriceNet: 900,
    minimumTermMonths: 0,
    minimumTermEndsAt: null,
    firstPeriodEnd: '2026-06-01T00:00:00.000Z',
    endsWithPlanAt: null,
    missingRequires: [],
    redundantFeatures: [],
} as unknown as BundlePreviewShape;

const mounted: VueWrapper[] = [];
const panel = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel');
/** The text of every list entry in the panel. */
const listed = () => [...panel()!.querySelectorAll('li')].map((item) => item.textContent?.trim());

function mountPreview(preview: unknown, locale?: 'de' | 'en') {
    // `as never` on the component collapses the options type along with it, so
    // the options are built separately and handed over as one value.
    const options: Record<string, unknown> = {
        attachTo: document.body,
        global: locale
            ? {
                  provide: {
                      [TENANT_I18N_KEY as symbol]: computed(() =>
                          defaultTenantPlanSectionI18n(locale),
                      ),
                  },
              }
            : {},
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
    };
    const wrapper = mount(BundlePreviewDialog as never, options as never);
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

describe('the first period is named before it is agreed to', () => {
    test('the date the first period runs to is on the screen', async () => {
        mountPreview(BASE);
        await nextTick();
        expect(panel()!.textContent).toContain('2026-06-01');
    });

    test('a booking with no period to align to says nothing rather than nothing-as-a-date', async () => {
        // A trial, or a subscription not yet started: the backend answers null
        // rather than inventing a period, and a row reading "until —" would be
        // a commitment the tenant cannot check.
        mountPreview({ ...BASE, firstPeriodEnd: null });
        await nextTick();
        expect(panel()!.textContent).not.toContain('First billing period');
        expect(panel()!.textContent).not.toContain('null');
    });
});

describe('ending with the plan is stated, not left to be discovered', () => {
    test('a plan that is already ending names the day', async () => {
        mountPreview({ ...BASE, endsWithPlanAt: '2026-08-01T00:00:00.000Z' });
        await nextTick();
        expect(panel()!.textContent).toContain('2026-08-01');
        expect(panel()!.textContent).toContain('Ends with the plan');
    });

    test('a plan that runs on shows no end date', async () => {
        mountPreview(BASE);
        await nextTick();
        expect(panel()!.textContent).not.toContain('Ends with the plan on');
    });

    test('the no-refund rule holds whether or not the plan is ending', async () => {
        // It is a term of every booking, not a warning about this one. A
        // warning that always fires teaches people to skip warnings, so this
        // sits in the price block and reads the same either way.
        for (const endsWithPlanAt of [null, '2026-08-01T00:00:00.000Z']) {
            mountPreview({ ...BASE, endsWithPlanAt });
            await nextTick();
            expect(panel()!.textContent).toContain('not refunded');
            mounted.splice(0).forEach((w) => w.unmount());
            document.body.innerHTML = '';
        }
    });

    test('a cancellation preview does not repeat the booking terms', async () => {
        // Nothing is being committed to here — the terms belong to the act of
        // booking, and restating them on the way out is noise.
        mountPreview({
            action: 'cancel',
            subscriptionBundleId: 'sb-1',
            bundle: BASE.bundle,
            billingCycle: 'MONTHLY',
            effectiveAt: '2026-06-01T00:00:00.000Z',
            nextPeriodSavingsNet: 900,
            blockers: [],
            warnings: [],
        });
        await nextTick();
        expect(panel()!.textContent).not.toContain('not refunded');
        expect(panel()!.textContent).not.toContain('First billing period');
    });
});

// @requirement SC-LANG-005 — Every string on a screen follows the language that was chosen
describe('a reason the booking cannot be made reads in the chosen language', () => {
    /** The refusal for a plan the subscription is set to move to, with the English the backend sends. */
    const upcoming = (planKey: string, from: string) => ({
        code: 'BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN',
        message: `This bundle cannot run on the ${planKey} plan, which the subscription moves to with effect from ${from}.`,
        params: { planKey, billingCycle: 'YEARLY', from },
    });

    test('each of two reasons with one code, with its own values', async () => {
        // A booking can meet two plans it is set to move to: a change it
        // scheduled, and a retirement it was told of.
        mountPreview(
            { ...BASE, blockers: [upcoming('BASIC', '2027-01-01'), upcoming('PRO', '2027-03-01')] },
            'de',
        );
        await nextTick();
        expect(listed()).toEqual(
            expect.arrayContaining([
                'Dieses Bundle kann nicht im Plan BASIC laufen, in den das Abonnement mit Wirkung ab 2027-01-01 wechselt.',
                'Dieses Bundle kann nicht im Plan PRO laufen, in den das Abonnement mit Wirkung ab 2027-03-01 wechselt.',
            ]),
        );
    });

    test('and read again in another order, each still keeps its own', async () => {
        // A list keyed by the code alone cannot tell the two apart once Vue has
        // to match the old entries to the new by key, and it says so.
        const incompatible = {
            code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
            message: 'not for this plan',
            params: { bundleVersionId: 'bv-1', planKey: 'STARTER', allowedPlanKeys: 'PRO' },
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrapper = mountPreview(
            {
                ...BASE,
                blockers: [
                    upcoming('BASIC', '2027-01-01'),
                    upcoming('PRO', '2027-03-01'),
                    incompatible,
                ],
            },
            'en',
        );
        await nextTick();
        // Typed as the mount is, through `never`: see `mountPreview`.
        await wrapper.setProps({
            preview: {
                ...BASE,
                blockers: [
                    incompatible,
                    upcoming('PRO', '2027-03-01'),
                    upcoming('BASIC', '2027-01-01'),
                ],
            },
        } as never);
        const duplicates = warn.mock.calls.filter(([message]) =>
            String(message).includes('Duplicate keys'),
        );
        warn.mockRestore();

        expect(duplicates).toEqual([]);
        expect(listed()).toEqual(
            expect.arrayContaining([
                'This bundle cannot run on the PRO plan, which the subscription moves to with effect from 2027-03-01.',
                'This bundle cannot run on the BASIC plan, which the subscription moves to with effect from 2027-01-01.',
            ]),
        );
    });
});

// @requirement SC-LANG-005 — Every string on a screen follows the language that was chosen
describe('a reason against the plan of today reads as a sentence, not as data', () => {
    test('naming the plan rather than the version, and the rhythm in words of its own', async () => {
        mountPreview(
            {
                ...BASE,
                blockers: [
                    {
                        code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
                        message:
                            "BundleVersion 'f3d1c0de-0000-4000-8000-000000000001' is not compatible",
                        params: {
                            bundleVersionId: 'f3d1c0de-0000-4000-8000-000000000001',
                            planKey: 'BASIC',
                            allowedPlanKeys: 'STANDARD, PRO',
                        },
                    },
                    {
                        code: 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
                        message: 'This bundle has no monthly price for the BASIC plan.',
                        params: { billingCycle: 'MONTHLY', planKey: 'BASIC' },
                    },
                ],
            },
            'de',
        );
        await nextTick();
        const text = panel()!.textContent ?? '';

        expect(listed()).toEqual(
            expect.arrayContaining([
                'Dieses Bundle kann im Plan BASIC nicht gebucht werden. Buchbar ist es in: STANDARD, PRO.',
                'Für dieses Bundle ist im Plan BASIC in diesem Abrechnungsrhythmus kein Preis hinterlegt, es kann hier deshalb nicht gebucht werden.',
            ]),
        );
        expect(text).not.toContain('f3d1c0de');
        expect(text).not.toContain('MONTHLY');
    });
});
