// Die beiden Promo-Code-Dialoge sind oeffentliche Bestandteile des Pakets und
// hatten bislang keinen Test. Diese Faelle halten das Verhalten fest, auf das
// Konsumenten sich verlassen: Welche Nutzlast der `submit`-Handler bekommt,
// wann der Speichern-Knopf freigegeben ist, und dass ein Fehler des Handlers im
// Dialog landet statt den Aufrufer zu erreichen.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, ref } from 'vue';

import PromoCodeCreateDialog from '../src/components/dialogs/PromoCodeCreateDialog.vue';
import PromoCodeEditDialog from '../src/components/dialogs/PromoCodeEditDialog.vue';
import { SA_MESSAGES } from '../src/client/i18n/messages.js';
import { SUPER_ADMIN_I18N_KEY } from '../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

// QDialog teleportiert nach `body`; ohne Aufraeumen liest der naechste Fall die
// Reste des vorigen.
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

describe('PromoCodeCreateDialog', () => {
    test('reicht die erfassten Werte an submit durch', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        await wrapper.vm.$nextTick();

        const vm = wrapper.vm as unknown as {
            form: Record<string, unknown>;
            onSubmit: () => Promise<void>;
        };
        vm.form.code = 'SOMMER25';
        vm.form.value = 25;
        await vm.onSubmit();

        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0]).toMatchObject({
            code: 'SOMMER25',
            valueType: 'PERCENT',
            value: 25,
            durationType: 'BILLING_CYCLES',
        });
    });

    test('sendet nicht, solange der Code die Form verfehlt', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        const vm = wrapper.vm as unknown as {
            form: Record<string, unknown>;
            onSubmit: () => Promise<void>;
        };

        vm.form.code = 'ab';
        await vm.onSubmit();
        expect(submit).not.toHaveBeenCalled();
    });

    test('behaelt einen Fehler des Handlers im Dialog', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('Code bereits vergeben'));
        const wrapper = mountDialog(PromoCodeCreateDialog, { modelValue: true, submit });
        const vm = wrapper.vm as unknown as {
            form: Record<string, unknown>;
            error: string;
            onSubmit: () => Promise<void>;
        };

        vm.form.code = 'SOMMER25';
        vm.form.value = 25;
        await expect(vm.onSubmit()).resolves.toBeUndefined();
        expect(vm.error).toBe('Code bereits vergeben');
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
        return wrapper.vm as unknown as {
            form: Record<string, unknown>;
            error: string;
            onSubmit: () => Promise<void>;
        };
    }

    test('uebernimmt die Werte der Zeile ins Formular', () => {
        const vm = mountEdit(vi.fn());
        // Der Code ist nicht aenderbar und daher kein Formularfeld.
        expect(vm.form.code).toBeUndefined();
        expect(vm.form.value).toBe(10);
        expect(vm.form.durationType).toBe('ONCE');
        expect(vm.form.status).toBe('ACTIVE');
    });

    test('sendet nichts, solange sich nichts geaendert hat', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const vm = mountEdit(submit);

        await vm.onSubmit();
        expect(submit).not.toHaveBeenCalled();
    });

    test('sendet nur die geaenderten Felder, mit der Id der Zeile', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        const vm = mountEdit(submit);

        vm.form.value = 15;
        await vm.onSubmit();

        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0]).toBe('promo-1');
        // Nur das Delta: Status und Laufzeit bleiben unberuehrt.
        expect(submit.mock.calls[0][1]).toEqual({ value: 15 });
    });

    test('behaelt einen Fehler des Handlers im Dialog', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('Nicht mehr aenderbar'));
        const vm = mountEdit(submit);

        vm.form.value = 15;
        await expect(vm.onSubmit()).resolves.toBeUndefined();
        expect(vm.error).toBe('Nicht mehr aenderbar');
    });
});
