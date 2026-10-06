<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.subscriber.businessDialog.title"
        :subtitle="msg.subscriber.businessDialog.subtitle"
        :submit-label="msg.subscriber.businessDialog.submit"
        :submit-disabled="!change"
        :submit="onSubmit"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminField :label="msg.subscriber.business" required>
            <q-select
                v-model="draft.business"
                :options="options"
                outlined
                dense
                emit-value
                map-options
            />
        </AdminField>
        <AdminField :label="msg.subscriber.reason" :hint="msg.subscriber.reasonHint" required>
            <q-input
                v-model="draft.reason"
                outlined
                dense
                type="textarea"
                autogrow
                counter
                :maxlength="REASON_MAX_LENGTH"
            />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import type { SubscriberBusinessStatusInput } from '../../client/resources/tenants.resource.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { businessStatusChangeOf, REASON_MAX_LENGTH } from './subscriber-corrections.js';

// Whether the subscriber acts as a business — or that it is not stated — and
// why. Only a status other than the one it has can be sent.

const props = defineProps<{
    modelValue: boolean;
    business: boolean | null;
    /** The write, as the corrections composable runs it behind the second factor. */
    submit: (input: SubscriberBusinessStatusInput) => Promise<unknown>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', open: boolean): void }>();

const msg = useSaMessages('tenants');

const draft = reactive<{ business: boolean | null; reason: string }>({
    business: null,
    reason: '',
});

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        draft.business = props.business;
        draft.reason = '';
    },
    { immediate: true },
);

const options = computed(() => [
    { label: msg.value.subscriber.businessTrue, value: true },
    { label: msg.value.subscriber.businessFalse, value: false },
    { label: msg.value.subscriber.notStated, value: null },
]);

const change = computed(() => businessStatusChangeOf(props.business, draft));

function onSubmit(): Promise<unknown> {
    return change.value ? props.submit(change.value) : Promise.resolve(null);
}
</script>
