<template>
    <AdminDialog
        :model-value="modelValue"
        :title="title"
        :size="size"
        persistent
        @update:model-value="onDialogModel"
    >
        <p v-if="message" class="sa-dialog__message">{{ message }}</p>
        <slot />
        <q-input
            v-if="requireTyped"
            v-model="typed"
            outlined
            dense
            autofocus
            class="sa-dialog__typed"
            :label="requireTyped.label"
            :disable="action.pending.value"
        />
        <template #footer>
            <AdminErrorBanner :error="action.error.value" />
            <div class="sa-dialog__actions">
                <q-btn
                    flat
                    no-caps
                    :label="cancelLabel ?? common.cancel"
                    :disable="action.pending.value"
                    @click="close"
                />
                <q-btn
                    unelevated
                    no-caps
                    :color="tone === 'danger' ? 'negative' : 'primary'"
                    :label="confirmLabel ?? common.confirm"
                    :loading="action.pending.value"
                    :disable="!mayConfirm"
                    @click="onConfirm"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AdminDialog from './AdminDialog.vue';
import AdminErrorBanner from '../feedback/AdminErrorBanner.vue';
import { useAsyncAction } from '../../vue/use-async-action.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The dialog for an action the operator has to agree to. Distinct from the
// confirm PORT next to it: the port answers a yes/no question raised from
// script, this component is a dialog a page renders — which is what you need
// when the question carries markup, a typed confirmation, or a body that is not
// one sentence.
//
// `requireTyped` is the escalation for the irreversible ones. Rule 6.4 says a
// destructive dialog names what will happen instead of asking "are you sure";
// asking for the subject's name in writing is that rule taken one step further,
// for the cases where a mis-click costs a tenant.
const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        title: string;
        message?: string;
        size?: 'sm' | 'md' | 'lg';
        tone?: 'neutral' | 'warning' | 'danger';
        confirmLabel?: string;
        cancelLabel?: string;
        /** Demands the operator types `expected` before confirming is possible. */
        requireTyped?: { label: string; expected: string };
        /** The action. Rejecting keeps the dialog open and shows the reason. */
        confirm: () => Promise<unknown>;
        /** Announced as a toast when `confirm` resolves. */
        successMessage?: string;
    }>(),
    {
        message: undefined,
        size: 'sm',
        tone: 'neutral',
        confirmLabel: undefined,
        cancelLabel: undefined,
        requireTyped: undefined,
        successMessage: undefined,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'confirmed'): void;
}>();

const common = useSaMessages('common');
const typed = ref('');

const action = useAsyncAction(() => props.confirm(), {
    notifyOn: props.successMessage ? 'both' : 'error',
    successMessage: () => props.successMessage ?? '',
});

// Compared trimmed but case-sensitively: a tenant named `Acme` and one named
// `ACME` are two tenants, and the point of typing it is to prove which one.
const mayConfirm = computed(
    () => !props.requireTyped || typed.value.trim() === props.requireTyped.expected,
);

// Reopening must not inherit the previous answer — otherwise the second delete
// is confirmable before the operator has typed anything.
watch(
    () => props.modelValue,
    (open) => {
        if (open) typed.value = '';
    },
);

function close(): void {
    action.reset();
    emit('update:modelValue', false);
}

function onDialogModel(open: boolean): void {
    if (!open) close();
}

async function onConfirm(): Promise<void> {
    if (!mayConfirm.value) return;
    const result = await action.run();
    if (!result.ok) return;
    emit('confirmed');
    close();
}
</script>
