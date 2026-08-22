<template>
    <AdminDialog
        :model-value="modelValue"
        :title="msg.discardDialog.title"
        size="sm"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div class="text-body2 q-mt-sm">
            {{ bodyLead }}
            <code>{{ target?.plan.planKey }}</code> {{ msg.discardDialog.bodyTail }}
        </div>
        <template #footer>
            <AdminBanner v-if="error" tone="negative">{{ error }}</AdminBanner>
            <div class="sa-dialog__actions">
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    :label="common.discard"
                    :loading="discarding"
                    @click="$emit('execute')"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { PlanDiscardTarget } from './types.js';

const props = defineProps<{
    modelValue: boolean;
    target: PlanDiscardTarget | null;
    error: string | null;
    discarding: boolean;
}>();

const msg = useSaMessages('plans');
const common = useSaMessages('common');

const bodyLead = computed(() =>
    formatMessage(msg.value.discardDialog.bodyLead, {
        version: props.target?.draft.version ?? '',
    }),
);

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'execute'): void;
}>();
</script>
