// Like the promo dialogs, the pilot dialogs are publicly reachable and had no
// test. These cases guard the building blocks both of them draw — plan picker,
// end date with its presets — before their styles move into a shared
// stylesheet.

// @requirement SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

import { AdminError } from '../../src/client/admin-error.js';
import PilotCreateDialog from '../../src/internal/dialogs/PilotCreateDialog.vue';
import PilotEditDialog from '../../src/internal/dialogs/PilotEditDialog.vue';
import MfaPromptDialog from '../../src/ui/overlay/MfaPromptDialog.vue';
import { createSuperAdminI18n, SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const i18n = createSuperAdminI18n({ locale: ref('de') });

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

        // The presets are `q-btn`s in their own row now; the row is what names them.
        const presets = [...document.querySelectorAll<HTMLButtonElement>('.pl-end-presets button')];
        expect(presets.length).toBeGreaterThan(0);

        presets[0].click();
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { endsAt: string } };
        expect(vm.form.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(vm.form.endsAt).not.toBe('2026-12-31');
    });
});

// The pilot routes are the application's, and the resource throws what any
// route refuses as an `AdminError`. The dialogs show its sentence from the
// catalogue — or what the route said, for a code the catalogue does not know —
// and a refused second factor keeps the prompt open, asking again.
// @requirement SC-LANG-005 — Every string on a screen follows the language that was chosen
describe('a pilot dialog shows what the route answered', () => {
    const CODE = '123456';
    const de = i18n.messages.value;
    const created = { slug: 'autohaus-schulz' };
    const updated = { slug: 'demo-verein', changed: ['note'] };

    /** What a route answers with, as the resource throws it: the body's message is its detail. */
    interface RefusalBody {
        params?: { missing: string[] };
        message?: string;
    }

    const refusal = (status: number, code?: string, body: RefusalBody = {}) =>
        new AdminError({ status, code, body: { code, ...body }, detail: body.message });

    const incomplete = () =>
        refusal(422, 'SUBSCRIBER_IDENTITY_INCOMPLETE', { params: { missing: ['city'] } });

    /** Answers each submit with the next of `answers`: an error is thrown, anything else returned. */
    function answering(...answers: unknown[]) {
        const codes: string[] = [];
        const submit = vi.fn(async (...args: unknown[]) => {
            codes.push(String(args[args.length - 1]));
            const next = answers.shift();
            if (next instanceof Error) throw next;
            return next;
        });
        return { submit, codes };
    }

    async function settle(): Promise<void> {
        for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function inputWith(wrapper: ReturnType<typeof mountDialog>, placeholder: string) {
        const found = wrapper
            .findAllComponents({ name: 'QInput' })
            .find(
                (input) => input.find('input, textarea').attributes('placeholder') === placeholder,
            );
        if (!found) throw new Error(`no input with the placeholder "${placeholder}"`);
        return found;
    }

    function buttonLabelled(wrapper: ReturnType<typeof mountDialog>, label: string) {
        const found = wrapper
            .findAllComponents({ name: 'QBtn' })
            .find((button) => button.props('label') === label);
        if (!found) throw new Error(`no button labelled "${label}"`);
        return found;
    }

    const banner = () => document.querySelector('.sa-banner');

    async function filledCreate(submit: unknown, requireMfa = true) {
        const wrapper = mountDialog(PilotCreateDialog, {
            modelValue: false,
            planOptions,
            submit,
            requireMfa,
        });
        await wrapper.setProps({ modelValue: true });
        const pilots = de.pilots;
        inputWith(wrapper, pilots.copyDefaults.tenantNamePlaceholder).vm.$emit(
            'update:modelValue',
            'Autohaus Schulz',
        );
        inputWith(wrapper, pilots.copyDefaults.adminEmailPlaceholder).vm.$emit(
            'update:modelValue',
            'owner@schulz.example',
        );
        inputWith(wrapper, pilots.createDialog.firstNamePlaceholder).vm.$emit(
            'update:modelValue',
            'Eva',
        );
        inputWith(wrapper, pilots.createDialog.lastNamePlaceholder).vm.$emit(
            'update:modelValue',
            'Schulz',
        );
        await wrapper.vm.$nextTick();
        return wrapper;
    }

    async function submitCreate(wrapper: ReturnType<typeof mountDialog>): Promise<void> {
        await buttonLabelled(wrapper, de.pilots.createAction).trigger('click');
        await settle();
    }

    async function openedEdit(submit: unknown) {
        const wrapper = mountDialog(PilotEditDialog, {
            modelValue: false,
            row,
            planOptions,
            submit,
        });
        await wrapper.setProps({ modelValue: true });
        await wrapper.vm.$nextTick();
        inputWith(wrapper, de.pilots.copyDefaults.notePlaceholder).vm.$emit(
            'update:modelValue',
            'Verlängert',
        );
        await wrapper.vm.$nextTick();
        await buttonLabelled(wrapper, de.common.save).trigger('click');
        await settle();
        return wrapper;
    }

    async function enterCode(wrapper: ReturnType<typeof mountDialog>, code = CODE) {
        wrapper.findComponent(MfaPromptDialog).vm.$emit('confirm', code);
        await settle();
    }

    const prompt = (wrapper: ReturnType<typeof mountDialog>) =>
        wrapper.findComponent(MfaPromptDialog).props();

    describe('creating', () => {
        test('a refused address reads as the catalogue sentence, and the prompt closes', async () => {
            const { submit } = answering(incomplete());
            const wrapper = await filledCreate(submit);
            await submitCreate(wrapper);
            await enterCode(wrapper);

            expect(banner()?.textContent).toContain(de.errors.codes.SUBSCRIBER_IDENTITY_INCOMPLETE);
            expect(prompt(wrapper).modelValue).toBe(false);
            expect(wrapper.emitted('created')).toBeUndefined();
        });

        test("an application's own refusal reads as the route worded it", async () => {
            const { submit } = answering(
                refusal(422, 'AHP_PILOT_ADDRESS', { message: 'Das Haus braucht eine Anschrift.' }),
            );
            const wrapper = await filledCreate(submit);
            await submitCreate(wrapper);
            await enterCode(wrapper);

            expect(banner()?.textContent).toContain('Das Haus braucht eine Anschrift.');
        });

        test('a refused code keeps the prompt open and says so; the next code creates the pilot', async () => {
            const { submit, codes } = answering(refusal(401, 'MFA_FAILED'), created);
            const wrapper = await filledCreate(submit);
            await submitCreate(wrapper);
            await enterCode(wrapper, '000000');

            expect(prompt(wrapper).modelValue).toBe(true);
            expect(prompt(wrapper).error).toBe(de.pilots.mfa.invalidCode);
            expect(banner()).toBeNull();

            await enterCode(wrapper);
            expect(codes).toEqual(['000000', CODE]);
            expect(wrapper.emitted('created')).toEqual([[created]]);
            expect(prompt(wrapper).modelValue).toBe(false);
        });

        test('a failure of the route closes the prompt and reads as the status sentence', async () => {
            const { submit } = answering(refusal(500));
            const wrapper = await filledCreate(submit);
            await submitCreate(wrapper);
            await enterCode(wrapper);

            expect(prompt(wrapper).modelValue).toBe(false);
            expect(banner()?.textContent).toContain(de.errors.server);
        });

        test('a second factor not set up is said in the banner, not asked for again', async () => {
            const { submit, codes } = answering(refusal(401, 'MFA_NOT_SET_UP'));
            const wrapper = await filledCreate(submit);
            await submitCreate(wrapper);
            await enterCode(wrapper);

            expect(codes).toEqual([CODE]);
            expect(prompt(wrapper).modelValue).toBe(false);
            expect(banner()?.textContent).toContain(de.errors.codes.MFA_NOT_SET_UP);
        });

        test('without a second factor, the refusal reads the same', async () => {
            const { submit, codes } = answering(incomplete());
            const wrapper = await filledCreate(submit, false);
            await submitCreate(wrapper);

            expect(codes).toEqual(['']);
            expect(banner()?.textContent).toContain(de.errors.codes.SUBSCRIBER_IDENTITY_INCOMPLETE);
        });
    });

    describe('editing', () => {
        test('a refused code keeps the prompt open and says so; the next code saves', async () => {
            const { submit, codes } = answering(refusal(401, 'MFA_FAILED'), updated);
            const wrapper = await openedEdit(submit);
            await enterCode(wrapper, '000000');

            expect(prompt(wrapper).modelValue).toBe(true);
            expect(prompt(wrapper).error).toBe(de.pilots.mfa.invalidCode);

            await enterCode(wrapper);
            expect(codes).toEqual(['000000', CODE]);
            expect(wrapper.emitted('updated')).toEqual([[updated]]);
        });

        test('a failure of the route closes the prompt and reads as the status sentence', async () => {
            const { submit } = answering(refusal(500));
            const wrapper = await openedEdit(submit);
            await enterCode(wrapper);

            expect(prompt(wrapper).modelValue).toBe(false);
            expect(banner()?.textContent).toContain(de.errors.server);
        });
    });
});
