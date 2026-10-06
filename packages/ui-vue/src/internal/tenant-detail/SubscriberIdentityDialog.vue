<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.subscriber.identityDialog.title"
        :subtitle="msg.subscriber.identityDialog.subtitle"
        :submit-label="msg.subscriber.identityDialog.submit"
        :submit-disabled="!correction"
        :submit="onSubmit"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminField :label="msg.subscriber.legalName" required>
            <q-input v-model="draft.legalName" outlined dense />
        </AdminField>
        <AdminFieldGrid>
            <AdminField
                :label="msg.subscriber.vatId"
                :hint="msg.subscriber.identityDialog.vatIdHint"
            >
                <q-input v-model="draft.vatId" outlined dense />
            </AdminField>
            <AdminField :label="msg.subscriber.taxNumber">
                <q-input v-model="draft.taxNumber" outlined dense />
            </AdminField>
        </AdminFieldGrid>
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
import type { AdminTenantSubscriber } from '@saasicat/core';

import type { SubscriberIdentityCorrectionInput } from '../../client/resources/tenants.resource.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import AdminFieldGrid from '../../ui/page/AdminFieldGrid.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { identityCorrectionOf, REASON_MAX_LENGTH } from './subscriber-corrections.js';

// Correcting the legal identity of the same legal entity. The form starts from
// the subscriber as it stands and sends only what changed, with the reason;
// nothing can be sent before something changed and a reason is given.

const props = defineProps<{
    modelValue: boolean;
    subscriber: NonNullable<AdminTenantSubscriber['subscriber']>;
    /** The write, as the corrections composable runs it behind the second factor. */
    submit: (input: SubscriberIdentityCorrectionInput) => Promise<unknown>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', open: boolean): void }>();

const msg = useSaMessages('tenants');

const draft = reactive({ legalName: '', vatId: '', taxNumber: '', reason: '' });

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        draft.legalName = props.subscriber.legalName;
        draft.vatId = props.subscriber.vatId ?? '';
        draft.taxNumber = props.subscriber.taxNumber ?? '';
        draft.reason = '';
    },
    { immediate: true },
);

const correction = computed(() => identityCorrectionOf(props.subscriber, draft));

function onSubmit(): Promise<unknown> {
    // Disabled until there is one; the guard keeps the type honest.
    return correction.value ? props.submit(correction.value) : Promise.resolve(null);
}
</script>
