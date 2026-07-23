<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 440px">
            <q-card-section>
                <div class="text-h6">{{ msg.archiveDialog.title }}</div>
                <div class="text-body2 q-mt-sm">
                    {{ msg.archiveDialog.bodyLead }} <code>{{ target?.plan.planKey }}</code>
                    {{ msg.archiveDialog.bodyVerb }}
                    <b>{{ msg.archiveDialog.bodyEmphasis }}</b
                    >{{ msg.archiveDialog.bodyTail }}
                </div>
                <div class="text-caption text-grey-7 q-mt-sm">
                    {{ msg.archiveDialog.contractProtectionNote }}
                </div>
            </q-card-section>
            <q-banner v-if="error" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ error }}
            </q-banner>
            <q-card-actions align="right">
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    :label="common.delete"
                    :loading="archiving"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
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
