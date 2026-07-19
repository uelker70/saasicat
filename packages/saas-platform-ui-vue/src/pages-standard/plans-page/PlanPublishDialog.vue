<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 420px">
            <q-card-section>
                <div class="text-h6">Version publishen?</div>
                <div class="text-body2 q-mt-sm">
                    Plan <code>{{ selectedPlan?.planKey }}</code
                    >, Draft v{{ publishTarget?.version }}.
                </div>
                <div class="text-caption text-grey-7 q-mt-sm">
                    Eine ggf. zuvor live Version wird auf <code>supersededAt</code> gesetzt
                    (Vertragsschutz P1: Bestand-Subscriptions bleiben auf der alten Version bis zum
                    nächsten Renewal).
                </div>
                <q-checkbox
                    :model-value="forceRegressive"
                    label="Force-Publish auch bei Regression (Feature entfernt / Quota gesenkt / Preis erhöht)"
                    class="q-mt-md"
                    @update:model-value="$emit('update:forceRegressive', Boolean($event))"
                />
                <q-checkbox
                    :model-value="allowZeroPrice"
                    label="Preis 0,00 bewusst zulassen (kostenloser Sondervertrag)"
                    class="q-mt-sm"
                    @update:model-value="$emit('update:allowZeroPrice', Boolean($event))"
                />
            </q-card-section>
            <q-banner v-if="publishError" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ publishError }}
            </q-banner>
            <q-card-section v-if="regressionChanges.length > 0" class="q-pt-none">
                <div class="text-subtitle2 q-mb-xs">Regressive Änderungen:</div>
                <ul class="sa-publish-regression">
                    <li v-for="c in regressionChanges" :key="c.field">
                        <strong>{{ fieldLabel(c.field) }}:</strong>
                        <span class="sa-publish-regression__old">
                            {{ formatChangeValue(c.oldValue) }}
                        </span>
                        <q-icon name="arrow_forward" size="14px" class="q-mx-xs" />
                        <span class="sa-publish-regression__new">
                            {{ formatChangeValue(c.newValue) }}
                        </span>
                    </li>
                </ul>
            </q-card-section>
            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="primary"
                    label="Publish"
                    :loading="publishing"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import type { RegressionChange } from './types.js';

defineProps<{
    modelValue: boolean;
    selectedPlan: PlanRow | null;
    publishTarget: PlanVersionRow | null;
    forceRegressive: boolean;
    allowZeroPrice: boolean;
    publishing: boolean;
    publishError: string | null;
    regressionChanges: RegressionChange[];
    fieldLabel: (field: string) => string;
    formatChangeValue: (value: unknown) => string;
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'update:forceRegressive', value: boolean): void;
    (e: 'update:allowZeroPrice', value: boolean): void;
    (e: 'execute'): void;
}>();
</script>

<style scoped>
.sa-publish-regression {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: #334155;
}
.sa-publish-regression li {
    margin: 4px 0;
}
.sa-publish-regression__old {
    color: #94a3b8;
    text-decoration: line-through;
}
.sa-publish-regression__new {
    color: #b91c1c;
    font-weight: 600;
}
</style>
