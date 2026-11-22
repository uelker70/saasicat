// Like the promo dialogs, the pilot dialogs are publicly reachable and had no
// test. These cases guard the building blocks both of them draw — plan picker,
// end date with its presets — before their styles move into a shared
// stylesheet.

// @requirement SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

import { AdminError } from '../../src/client/admin-error.js';
import type { PilotCreatePayload } from '../../src/client/resources/pilots.types.js';
import PilotCreateDialog from '../../src/internal/dialogs/PilotCreateDialog.vue';
import PilotEditDialog from '../../src/internal/dialogs/PilotEditDialog.vue';
import MfaPromptDialog from '../../src/ui/overlay/MfaPromptDialog.vue';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
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

const de = i18n.messages.value;

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function inputWith(wrapper: ReturnType<typeof mountDialog>, placeholder: string) {
    const found = wrapper
        .findAllComponents({ name: 'QInput' })
        .find((input) => input.find('input, textarea').attributes('placeholder') === placeholder);
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

/**
 * The create dialog, opened as the pilots page opens it, under the manifest the
 * shell serves — or none — with the tenant and its administrator filled in.
 */
async function filledCreate(
    submit: unknown,
    requireMfa = true,
    manifest: { subscriberAddressRequired?: boolean } | null = null,
) {
    const wrapper = mountWithQuasar(PilotCreateDialog, {
        attachTo: document.body,
        props: { modelValue: false, planOptions, submit, requireMfa },
        global: {
            provide: {
                // SAFETY: the key is the symbol the dialog injects its catalogue
                // under, typed as Vue's injection key rather than as a symbol.
                [SUPER_ADMIN_I18N_KEY as symbol]: i18n,
                // SAFETY: the key is the symbol the dialog injects the shell's
                // manifest under, typed as Vue's injection key likewise.
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => manifest,
            },
        },
    });
    mounted.push(wrapper);
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

// @requirement SC-SPEC-010 — The operator gives a pilot's subscriber its address, required under a tax adapter
describe("the pilot subscriber's address", () => {
    const dialog = de.pilots.createDialog;
    const ADDRESS = [
        [dialog.addressLine1Placeholder, 'Hauptstraße 1'],
        [dialog.postalCodePlaceholder, '10115'],
        [dialog.cityPlaceholder, 'Berlin'],
        [dialog.countryPlaceholder, 'de'],
    ] as const;

    function enter(wrapper: ReturnType<typeof mountDialog>, placeholder: string, value: string) {
        inputWith(wrapper, placeholder).vm.$emit('update:modelValue', value);
    }

    const createButton = (wrapper: ReturnType<typeof mountDialog>) =>
        buttonLabelled(wrapper, de.pilots.createAction);

    /** A route that creates the pilot, keeping each payload the dialog sent. */
    function recordingRoute() {
        const sent: PilotCreatePayload[] = [];
        const submit = async (payload: PilotCreatePayload) => {
            sent.push(payload);
            return { slug: 'autohaus-schulz' };
        };
        return { submit, sent };
    }

    test('where a contract needs it, "Create" stays off until street, postal code, city and country are there', async () => {
        const { submit, sent } = recordingRoute();
        const wrapper = await filledCreate(submit, false, { subscriberAddressRequired: true });
        expect(createButton(wrapper).props('disable')).toBe(true);

        for (const [placeholder, value] of ADDRESS.slice(0, 3)) enter(wrapper, placeholder, value);
        await wrapper.vm.$nextTick();
        expect(createButton(wrapper).props('disable')).toBe(true);

        const [countryPlaceholder, country] = ADDRESS[3];
        enter(wrapper, countryPlaceholder, country);
        await wrapper.vm.$nextTick();
        expect(createButton(wrapper).props('disable')).toBe(false);

        await submitCreate(wrapper);
        expect(sent).toHaveLength(1);
        expect(sent[0].subscriber).toEqual({
            addressLine1: 'Hauptstraße 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        });
    });

    test('where it says so, the dialog says why the address is asked for', async () => {
        await filledCreate(vi.fn(), false, { subscriberAddressRequired: true });
        expect(document.body.textContent).toContain(dialog.subscriberAddressRequired);
        expect(document.body.textContent).not.toContain(dialog.subscriberAddressOptional);
    });

    for (const [what, manifest] of [
        ['a manifest that does not need it', { subscriberAddressRequired: false }],
        ['a manifest that does not say', {}],
        ['no manifest', null],
    ] as const) {
        test(`under ${what}, "Create" is on without an address and sends no subscriber`, async () => {
            const { submit, sent } = recordingRoute();
            const wrapper = await filledCreate(submit, false, manifest);
            expect(createButton(wrapper).props('disable')).toBe(false);
            expect(document.body.textContent).toContain(dialog.subscriberAddressOptional);

            await submitCreate(wrapper);
            expect(sent).toHaveLength(1);
            expect('subscriber' in sent[0]).toBe(false);
        });
    }

    test('where it is optional, what was entered is sent', async () => {
        const { submit, sent } = recordingRoute();
        const wrapper = await filledCreate(submit, false, { subscriberAddressRequired: false });
        enter(wrapper, dialog.cityPlaceholder, 'Berlin');
        await wrapper.vm.$nextTick();

        await submitCreate(wrapper);
        expect(sent.map((payload) => payload.subscriber)).toEqual([{ city: 'Berlin' }]);
    });

    test('opened again, the dialog starts without the address entered before', async () => {
        const wrapper = await filledCreate(vi.fn(), false, { subscriberAddressRequired: false });
        enter(wrapper, dialog.cityPlaceholder, 'Berlin');
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });

        expect(inputWith(wrapper, dialog.cityPlaceholder).find('input').element.value).toBe('');
    });

    test('every address field is labelled for the input it names', async () => {
        await filledCreate(vi.fn(), false, { subscriberAddressRequired: true });
        for (const [placeholder, label] of [
            [dialog.addressLine1Placeholder, dialog.addressLine1Label],
            [dialog.addressLine2Placeholder, dialog.addressLine2Label],
            [dialog.postalCodePlaceholder, dialog.postalCodeLabel],
            [dialog.cityPlaceholder, dialog.cityLabel],
            [dialog.countryPlaceholder, dialog.countryLabel],
        ]) {
            const input = document.querySelector(`input[placeholder="${placeholder}"]`);
            // The field's own label, not the one Quasar wraps every input in.
            const named = document.querySelector(`.pl-field > label[for="${input?.id}"]`);
            expect(named?.textContent, placeholder).toContain(label);
        }
    });
});
