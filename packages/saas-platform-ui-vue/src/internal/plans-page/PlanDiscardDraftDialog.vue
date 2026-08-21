<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 400px">
            <q-card-section>
                <div class="text-h6">{{ msg.discardDialog.title }}</div>
                <div class="text-body2 q-mt-sm">
                    {{ bodyLead }}
                    <code>{{ target?.plan.planKey }}</code> {{ msg.discardDialog.bodyTail }}
                </div>
            </q-card-section>
            <q-banner v-if="error" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ error }}
            </q-banner>
            <q-card-actions align="right">
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    :label="common.discard"
                    :loading="discarding"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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
