<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 440px">
            <q-card-section>
                <div class="text-h6">Plan komplett löschen?</div>
                <div class="text-body2 q-mt-sm">
                    Plan <code>{{ target?.plan.planKey }}</code> wird
                    <b>unwiderruflich aus der DB entfernt</b>. Da der Plan keine published Version
                    hat, sind keine Subscriptions betroffen.
                </div>
                <div class="text-caption text-grey-7 q-mt-sm">
                    Vertragsschutz P1: Pläne mit jemals veröffentlichten Versionen können nicht
                    gelöscht werden — das Backend würde 422 antworten.
                </div>
            </q-card-section>
            <q-banner v-if="error" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ error }}
            </q-banner>
            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="negative"
                    label="Löschen"
                    :loading="archiving"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import type { PlanArchiveTarget } from './types.js';

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
