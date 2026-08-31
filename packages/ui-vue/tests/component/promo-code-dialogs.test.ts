// Both promo-code dialogs are public parts of the package and had no test.
// These cases pin down what consumers rely on: the payload the `submit`
// handler receives, when the save button is released, and that a handler error
// stays inside the dialog instead of reaching the caller.

// @requirement SC-PROMO-005 — A percentage discount is between 0 and 100

import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';

import PromoCodeCreateDialog from '../../src/internal/dialogs/PromoCodeCreateDialog.vue';
import PromoCodeEditDialog from '../../src/internal/dialogs/PromoCodeEditDialog.vue';
import { SA_MESSAGES } from '../../src/client/i18n/messages.js';
import { SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

// QDialog teleports into `body`; without cleanup the next case reads what the
// previous one left behind.
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

function mountDialog(component: typeof PromoCodeCreateDialog, props: Record<string, unknown>) {
    const wrapper = mountWithQuasar(component, {
        attachTo: document.body,
        props,
        global: { provide: { [SUPER_ADMIN_I18N_KEY as symbol]: i18n } },
    });
    mounted.push(wrapper);
    return wrapper;
}

/**
 * The dialog's confirming button, and whether it is usable.
 *
 * Since both dialogs moved onto `AdminFormDialog` the validity guard is the
 * button's `disabled` state, not an early return inside a handler — so a test
 * that called the handler directly would submit an invalid form and report that
 * it was accepted. Clicking is now the only way to ask the real question.
 */
function submitButton(): HTMLButtonElement {
    const buttons = document.querySelectorAll('.sa-dialog__actions button');
    expect(buttons).toHaveLength(2);
    return buttons[1] as HTMLButtonElement;
}

async function clickSubmit(): Promise<void> {
    // The dialog reaches its portal a tick after mounting, and the form state a
    // caller just set has to reach the button's `disabled` before the click.
    await flushPromises();
    submitButton().click();
    await flushPromises();
}

describe('PromoCodeCreateDialog', () => {
    test('passes the entered values through to submit', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };
        vm.form.code = 'SOMMER25';
        vm.form.value = 25;
        await clickSubmit();

        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0]).toMatchObject({
            code: 'SOMMER25',
            valueType: 'PERCENT',
            value: 25,
            durationType: 'BILLING_CYCLES',
        });
    });

    test('reopening starts from an empty form', async () => {
        // The dialog holds its form in a `ref` so the two-way binding to
        // `PromoCodeDialogFields` has something to assign to, and reopening
        // REPLACES the object rather than assigning over the old one. Whether
        // the child follows that swap is not visible from the parent — the
        // fields component keeps its own `defineModel` handle on it — so this
        // asks the child's rendered input rather than the parent's state.
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };
        vm.form.code = 'SOMMER25';
        await flushPromises();

        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();

        expect(vm.form.code).toBe('');
        const code = document.querySelector('.pc-code input') as HTMLInputElement | null;
        expect(code?.value ?? '').toBe('');
    });

    test('does not submit while the code is malformed', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };

        vm.form.code = 'ab';
        await wrapper.vm.$nextTick();
        expect(submitButton().disabled).toBe(true);
        await clickSubmit();
        expect(submit).not.toHaveBeenCalled();
    });

    test('keeps a handler error inside the dialog', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('Code already taken'));
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };

        vm.form.code = 'SOMMER25';
        vm.form.value = 25;
        await clickSubmit();

        expect(document.querySelector('.sa-dialog')?.textContent).toContain('Code already taken');
        // Still open: a failure the operator can act on must not take the form away.
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });
});

describe('PromoCodeEditDialog', () => {
    const row = {
        id: 'promo-1',
        code: 'WINTER10',
        status: 'ACTIVE' as const,
        valueType: 'PERCENT' as const,
        value: 10,
        durationType: 'ONCE' as const,
        durationValue: null,
        maxRedemptions: null,
        redemptionsCount: 0,
        validFrom: null,
        validUntil: null,
    };

    function mountEdit(submit: ReturnType<typeof vi.fn>) {
        const wrapper = mountDialog(PromoCodeEditDialog as never, {
            modelValue: true,
            row,
            submit,
        });
        return wrapper;
    }

    test('adopts the row values into the form', () => {
        const vm = mountEdit(vi.fn()).vm as unknown as { form: Record<string, unknown> };
        // The code is not editable and therefore not a form field.
        expect(vm.form.code).toBeUndefined();
        expect(vm.form.value).toBe(10);
        expect(vm.form.durationType).toBe('ONCE');
        expect(vm.form.status).toBe('ACTIVE');
    });

    test('sends nothing while nothing has changed', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountEdit(submit);
        await wrapper.vm.$nextTick();

        expect(submitButton().disabled).toBe(true);
        await clickSubmit();
        expect(submit).not.toHaveBeenCalled();
    });

    test('sends only the changed fields, with the row id', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountEdit(submit);
        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };

        vm.form.value = 15;
        await clickSubmit();

        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0]).toBe('promo-1');
        // The delta only: status and duration stay untouched.
        expect(submit.mock.calls[0][1]).toEqual({ value: 15 });
    });

    test('keeps a handler error inside the dialog', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('No longer editable'));
        const wrapper = mountEdit(submit);
        const vm = wrapper.vm as unknown as { form: Record<string, unknown> };

        vm.form.value = 15;
        await clickSubmit();

        expect(document.querySelector('.sa-dialog')?.textContent).toContain('No longer editable');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });
});

// Since the merge the fields live in PromoCodeDialogFields. These cases guard
// the spot most likely to break: the code, which is no longer bound by v-model
// but travels back to the dialog's form through an event.
describe('Shared form body', () => {
    const plans = [
        { key: 'BASIC', label: 'Basic', color: '#3f6bff' },
        { key: 'PRO', label: 'Pro', color: '#10b981' },
    ];

    test('create: typing into the code field lands upper-cased in the form', async () => {
        const wrapper = mountDialog(PromoCodeCreateDialog, {
            modelValue: true,
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        const input = document.querySelector<HTMLInputElement>('.pc-code input');
        expect(input).not.toBeNull();
        input!.value = 'sommer-25!';
        input!.dispatchEvent(new Event('input'));
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { code: string } };
        // Lower case lifted, disallowed characters dropped.
        expect(vm.form.code).toBe('SOMMER-25');
    });

    test('create: the random button fills a valid code', async () => {
        const wrapper = mountDialog(PromoCodeCreateDialog, {
            modelValue: true,
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        // The generator sits in the field's `after` slot, so it is the only
        // button inside the code field.
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.pc-code button')];
        expect(buttons.length).toBe(1);
        buttons[0].click();
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { code: string } };
        expect(vm.form.code).toMatch(/^[A-Z0-9]{8}$/);
    });

    test('edit: the code field shows the code and is disabled', async () => {
        const wrapper = mountDialog(PromoCodeEditDialog as never, {
            modelValue: true,
            row: {
                id: 'promo-1',
                code: 'WINTER10',
                status: 'ACTIVE',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                durationValue: null,
                maxRedemptions: null,
                redemptionsCount: 0,
                validFrom: null,
                validUntil: null,
            },
            submit: vi.fn(),
        });
        await wrapper.vm.$nextTick();

        const input = document.querySelector<HTMLInputElement>('.pc-code input');
        expect(input?.value).toBe('WINTER10');
        expect(input?.disabled).toBe(true);
        // No random button on edit.
        expect(document.querySelectorAll('.pc-code button').length).toBe(0);
    });

    test('the status switch appears on edit only', async () => {
        const create = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit: vi.fn() });
        await create.vm.$nextTick();
        expect(document.querySelectorAll('.pc-status .pc-seg-opt').length).toBe(0);
        create.unmount();
        document.body.innerHTML = '';

        const edit = mountDialog(PromoCodeEditDialog as never, {
            modelValue: true,
            row: {
                id: 'promo-1',
                code: 'WINTER10',
                status: 'ACTIVE',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                durationValue: null,
                maxRedemptions: null,
                redemptionsCount: 0,
                validFrom: null,
                validUntil: null,
            },
            submit: vi.fn(),
        });
        await edit.vm.$nextTick();
        expect(document.querySelectorAll('.pc-status .pc-seg-opt').length).toBe(2);
    });

    test('the plan picker writes into the dialog form', async () => {
        const wrapper = mountDialog(PromoCodeCreateDialog, {
            modelValue: true,
            submit: vi.fn(),
            plans,
        });
        await wrapper.vm.$nextTick();

        const chips = [...document.querySelectorAll<HTMLButtonElement>('.pc-plan-opt')];
        expect(chips.length).toBe(2);
        chips[0].click();
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as { form: { appliesToPlans: string[] } };
        expect(vm.form.appliesToPlans).toEqual(['BASIC']);
    });
});
