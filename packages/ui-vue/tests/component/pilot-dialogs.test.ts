// Like the promo dialogs, the pilot dialogs are publicly reachable and had no
// test. These cases guard the building blocks both of them draw — plan picker,
// end date with its presets — before their styles move into a shared
// stylesheet.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, ref } from 'vue';

import PilotCreateDialog from '../../src/internal/dialogs/PilotCreateDialog.vue';
import PilotEditDialog from '../../src/internal/dialogs/PilotEditDialog.vue';
import { SA_MESSAGES } from '../../src/client/i18n/messages.js';
import { SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const i18n = {
    locale: ref('de'),
    messages: computed(() => SA_MESSAGES.de),
    setLocale: () => {},
};

const planOptions = [
    { value: 'BASIC', label: 'Basic', color: '#3f6bff' },
    { value: 'PRO', label: 'Pro', color: '#10b981' },
];

const row = {
    id: 'pilot-1',
    tenant: { id: 'tenant-1', slug: 'demo-verein', name: 'Demo Verein' },
    plan: 'PRO',
    pilotEndsAt: '2026-12-31',
    pilotNote: 'Pilotphase',
    grantedBy: 'admin@example.com',
};

function mountDialog(component: unknown, props: Record<string, unknown>) {
    const wrapper = mountWithQuasar(component as never, {
        attachTo: document.body,
        props,
        global: { provide: { [SUPER_ADMIN_I18N_KEY as symbol]: i18n } },
    });
    mounted.push(wrapper);
    return wrapper;
}

describe('PilotCreateDialog', () => {
    test('blocks submitting while required fields are missing', async () => {
        const wrapper = mountDialog(PilotCreateDialog, {
            modelValue: true,
            planOptions,
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { isValid: boolean };
        expect(vm.isValid).toBe(false);
    });

    test('draws the plan picker from the options passed in', async () => {
        const wrapper = mountDialog(PilotCreateDialog, {
            modelValue: true,
            planOptions,
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        const opts = [...document.querySelectorAll('.pl-plan-opt')];
        expect(opts.length).toBe(2);
        expect(opts.map((o) => o.querySelector('.pl-plan-opt__key')?.textContent)).toEqual([
            'BASIC',
            'PRO',
        ]);
    });

    test('derives the slug from the name', async () => {
        const wrapper = mountDialog(PilotCreateDialog, {
            modelValue: true,
            planOptions,
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { tenant: { name: string; slug: string } } };
        vm.form.tenant.name = 'Demo Verein e.V.';
        await wrapper.vm.$nextTick();
        expect(vm.form.tenant.slug).toMatch(/^[a-z0-9-]+$/);
    });
});

describe('PilotEditDialog', () => {
    // The dialog hydrates in its watcher on modelValue, and that one is not
    // `immediate` — so it fills the form only once opened. PilotsPage renders
    // it closed and then flips it; these tests do the same.
    async function openEdit() {
        const wrapper = mountDialog(PilotEditDialog, {
            modelValue: false,
            row,
            planOptions,
            submit: vi.fn(),
        });
        await wrapper.setProps({ modelValue: true });
        await wrapper.vm.$nextTick();
        return wrapper;
    }

    test('adopts plan, end date and note from the row', async () => {
        const wrapper = await openEdit();

        const vm = wrapper.vm as unknown as {
            form: { plan: string; endsAt: string; note: string };
        };
        expect(vm.form.plan).toBe('PRO');
        expect(vm.form.endsAt).toBe('2026-12-31');
        expect(vm.form.note).toBe('Pilotphase');
    });

    test('draws the same plan picker as the create dialog', async () => {
        await openEdit();

        const opts = [...document.querySelectorAll('.pl-plan-opt')];
        expect(opts.length).toBe(2);
        // The row's selected plan is marked.
        expect(document.querySelectorAll('.pl-plan-opt--active').length).toBe(1);
    });

    test('offers preset buttons for the end date', async () => {
        const wrapper = await openEdit();

        const presets = [...document.querySelectorAll<HTMLButtonElement>('.pl-preset-btn')];
        expect(presets.length).toBeGreaterThan(0);

        presets[0].click();
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { endsAt: string } };
        expect(vm.form.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(vm.form.endsAt).not.toBe('2026-12-31');
    });
});
