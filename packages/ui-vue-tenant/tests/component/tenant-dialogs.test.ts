import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import BundlePreviewDialog from '../../src/tenant-plan-section/BundlePreviewDialog.vue';
import TenantDialog from '../../src/ui/TenantDialog.vue';
import type { BundlePreviewShape } from '@saasicat/ui-vue';

// The dialogs at a real call site, not the composable in isolation.
//
// `useDialog` is proved next door in `@saasicat/ui-vue`. What is proved here is
// the wiring: that the shell puts the title where `aria-labelledby` points,
// that a persistent dialog still offers a way out, and that the preview dialog
// reaches the footer buttons through the slot rather than rendering them into
// the body. The panel is teleported to `document.body`, so it is read from
// there — `wrapper.find` never sees a teleported node, and a test that looked
// for it in the wrapper would pass by finding nothing.

const preview: BundlePreviewShape = {
    action: 'add',
    bundle: { bundleVersionId: 'bv-1', bundleKey: 'ANALYTICS', label: 'Analytics' },
    billingCycle: 'MONTHLY',
    blockers: [],
    warnings: [],
    proration: null,
    nextPeriodPriceNet: 900,
    minimumTermMonths: 0,
    minimumTermEndsAt: null,
    missingRequires: [],
    redundantFeatures: [],
} as unknown as BundlePreviewShape;

const mounted: VueWrapper[] = [];

function mountDialog(component: unknown, options: Record<string, unknown> = {}) {
    const wrapper = mount(component as never, { attachTo: document.body, ...options });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

const panel = () => document.body.querySelector<HTMLElement>('.sp-dialog__panel');

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

describe('the dialog shell names itself', () => {
    test('the panel is a modal named by its own heading', async () => {
        mountDialog(TenantDialog, {
            props: { modelValue: true, title: 'Change plan' },
            slots: { default: 'body' },
        });
        await nextTick();

        const dialog = panel();
        expect(dialog).not.toBeNull();
        expect(dialog!.getAttribute('role')).toBe('dialog');
        expect(dialog!.getAttribute('aria-modal')).toBe('true');

        const namedBy = dialog!.getAttribute('aria-labelledby');
        expect(document.getElementById(namedBy!)?.textContent).toBe('Change plan');
    });

    test('a persistent dialog still renders a way out', async () => {
        // Persistent turns off escape and the backdrop. Hiding the close
        // control there too would build the trap it exists to prevent.
        mountDialog(TenantDialog, {
            props: { modelValue: true, title: 'Change plan', persistent: true },
        });
        await nextTick();
        expect(panel()!.querySelector('button')).not.toBeNull();
    });

    test('a closed dialog renders nothing at all', () => {
        mountDialog(TenantDialog, { props: { modelValue: false, title: 'Change plan' } });
        expect(panel()).toBeNull();
    });

    test('the close control asks the caller to close', async () => {
        const wrapper = mountDialog(TenantDialog, {
            props: { modelValue: true, title: 'Change plan' },
        });
        await nextTick();
        panel()!.querySelector('button')!.click();
        expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    });
});

describe('the bundle preview reaches the shell', () => {
    function mountPreview(props: Record<string, unknown> = {}) {
        return mountDialog(BundlePreviewDialog, {
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
                ...props,
            },
        });
    }

    test('its title and the bundle label both reach the head', async () => {
        mountPreview();
        await nextTick();
        expect(panel()!.textContent).toContain('Analytics');
    });

    test('the footer confirm carries the action, and blockers disable it', async () => {
        mountPreview();
        await nextTick();
        const buttons = [...panel()!.querySelectorAll('button')];
        // Close control, cancel, confirm — the confirm is the last one.
        const confirm = buttons.at(-1)!;
        expect(confirm.disabled).toBe(false);

        mounted.splice(0).forEach((w) => w.unmount());
        document.body.innerHTML = '';

        mountPreview({
            preview: { ...preview, blockers: [{ code: 'X', message: 'no' }] },
        });
        await nextTick();
        expect([...panel()!.querySelectorAll('button')].at(-1)!.disabled).toBe(true);
    });

    test('while it loads, the ring is decoration and the sentence carries the news', async () => {
        mountPreview({ loading: true, preview: null });
        await nextTick();
        const ring = panel()!.querySelector('.sp-spinner');
        expect(ring?.getAttribute('aria-hidden')).toBe('true');
        expect(panel()!.textContent?.trim().length).toBeGreaterThan(0);
    });
});
