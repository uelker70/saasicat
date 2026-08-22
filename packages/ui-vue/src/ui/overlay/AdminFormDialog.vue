<template>
    <AdminDialog
        :model-value="modelValue"
        :title="title"
        :subtitle="subtitle"
        :size="size"
        persistent
        @update:model-value="onDialogModel"
    >
        <slot />
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
                    color="primary"
                    :label="submitLabel ?? common.save"
                    :loading="action.pending.value"
                    :disable="submitDisabled"
                    @click="onSubmit"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
import AdminDialog from './AdminDialog.vue';
import AdminErrorBanner from '../feedback/AdminErrorBanner.vue';
import { useAsyncAction } from '../../vue/use-async-action.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// A dialog whose point is a write. The lifecycle around that write — disable
// while pending, show the failure without closing, close and announce on
// success — was hand-rolled in every create and edit dialog in the package,
// and jscpd found 115 cloned lines between the two promo-code dialogs alone.
//
// `submit` is the only function prop in the package that survived AP3. The
// resource ports removed the rest because a page passing `loadX`/`saveX` down
// was passing its data layer through the view. This one is different in kind:
// what a form dialog submits is the form's own content, which nothing above it
// can know. Naming it as a prop is what lets the dialog own everything else.
const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        title: string;
        subtitle?: string;
        size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
        submitLabel?: string;
        cancelLabel?: string;
        submitDisabled?: boolean;
        /** The write. Rejecting keeps the dialog open and shows the reason. */
        submit: () => Promise<unknown>;
        /** Announced as a toast when `submit` resolves. */
        successMessage?: string;
    }>(),
    {
        subtitle: undefined,
        size: 'md',
        submitLabel: undefined,
        cancelLabel: undefined,
        submitDisabled: false,
        successMessage: undefined,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submitted'): void;
}>();

const common = useSaMessages('common');

const action = useAsyncAction(() => props.submit(), {
    notifyOn: props.successMessage ? 'both' : 'error',
    successMessage: () => props.successMessage ?? '',
});

function close(): void {
    // Dropping a failure on the way out: reopening the dialog to a stale error
    // about a submit the operator has since abandoned reads as a new failure.
    action.reset();
    emit('update:modelValue', false);
}

function onDialogModel(open: boolean): void {
    if (!open) close();
}

async function onSubmit(): Promise<void> {
    const result = await action.run();
    if (!result.ok) return;
    emit('submitted');
    close();
}
</script>
