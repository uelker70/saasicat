<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 400px">
            <q-card-section>
                <div class="text-h6">Draft verwerfen?</div>
                <div class="text-body2 q-mt-sm">
                    Draft v{{ target?.draft.version }} von
                    <code>{{ target?.plan.planKey }}</code> wird unwiderruflich gelöscht. Published
                    Versions bleiben unverändert.
                </div>
            </q-card-section>
            <q-banner v-if="error" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ error }}
            </q-banner>
            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    label="Verwerfen"
                    :loading="discarding"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import type { PlanDiscardTarget } from './types.js';

defineProps<{
    modelValue: boolean;
    target: PlanDiscardTarget | null;
    error: string | null;
    discarding: boolean;
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'execute'): void;
}>();
</script>
