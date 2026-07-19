<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 420px">
            <q-card-section>
                <div class="text-h6">
                    {{ target?.endsAt ? 'Enddatum ändern' : 'Version terminieren' }}
                </div>
                <div class="text-body2 q-mt-sm">
                    Plan <code>{{ plan.planKey }}</code> — v{{ target?.version }} wird am gewählten
                    Datum auslaufen, <b>ohne</b> durch eine Nachfolge-Version ersetzt zu werden.
                    Bestand-Subscriptions bleiben gebunden (Vertragsschutz P1); neue Buchungen sind
                    ab diesem Datum nicht mehr möglich.
                </div>
                <q-input
                    :model-value="dateInput"
                    label="Enddatum (YYYY-MM-DD)"
                    type="text"
                    class="q-mt-md"
                    mask="####-##-##"
                    placeholder="2026-12-31"
                    @update:model-value="$emit('update:dateInput', String($event ?? ''))"
                >
                    <template #append>
                        <q-icon name="event" class="cursor-pointer">
                            <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                                <q-date
                                    :model-value="dateInput"
                                    mask="YYYY-MM-DD"
                                    @update:model-value="
                                        $emit('update:dateInput', String($event ?? ''))
                                    "
                                />
                            </q-popup-proxy>
                        </q-icon>
                    </template>
                </q-input>
            </q-card-section>
            <q-banner v-if="error" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ error }}
            </q-banner>
            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="primary"
                    label="Terminieren"
                    :loading="terminating"
                    :disable="!dateInput"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import type { PlanRow, PlanVersionRow } from '@saasicat/types';

defineProps<{
    modelValue: boolean;
    plan: PlanRow;
    target: PlanVersionRow | null;
    dateInput: string;
    error: string | null;
    terminating: boolean;
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'update:dateInput', value: string): void;
    (e: 'execute'): void;
}>();
</script>
