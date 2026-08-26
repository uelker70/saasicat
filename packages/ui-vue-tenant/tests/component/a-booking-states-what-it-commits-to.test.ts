import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import BundlePreviewDialog from '../../src/tenant-plan-section/BundlePreviewDialog.vue';
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

function mountPreview(preview: unknown) {
    // `as never` on the component collapses the options type along with it, so
    // the options are built separately and handed over as one value.
    const options: Record<string, unknown> = {
        attachTo: document.body,
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
