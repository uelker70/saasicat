<template>
    <AdminDialog
        :model-value="modelValue"
        :title="msg.archiveDialog.title"
        size="sm"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div class="text-body2 q-mt-sm">
            {{ msg.archiveDialog.bodyLead }} <code>{{ target?.plan.planKey }}</code>
            {{ msg.archiveDialog.bodyVerb }}
            <b>{{ msg.archiveDialog.bodyEmphasis }}</b
            >{{ msg.archiveDialog.bodyTail }}
        </div>
        <div class="text-caption text-grey-7 q-mt-sm">
            {{ msg.archiveDialog.contractProtectionNote }}
        </div>
        <template #footer>
            <AdminBanner v-if="error" tone="negative">{{ error }}</AdminBanner>
            <div class="sa-dialog__actions">
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    :label="common.delete"
                    :loading="archiving"
                    @click="$emit('execute')"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import type { PlanArchiveTarget } from './types.js';

const msg = useSaMessages('plans');
const common = useSaMessages('common');

defineProps<{
    modelValue: boolean;
    target: PlanArchiveTarget | null;
    error: string | null;
    archiving: boolean;
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'execute'): void;
}>();
</script>
