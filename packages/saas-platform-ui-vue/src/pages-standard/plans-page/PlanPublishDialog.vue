<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 420px">
            <q-card-section>
                <div class="text-h6">{{ msg.publishDialog.title }}</div>
                <div class="text-body2 q-mt-sm">
                    {{ msg.publishDialog.bodyLead }} <code>{{ selectedPlan?.planKey }}</code
                    >{{ bodyTail }}
                </div>
                <div class="text-caption text-grey-7 q-mt-sm">
                    {{ msg.publishDialog.supersededNoteLead }} <code>supersededAt</code>
                    {{ msg.publishDialog.supersededNoteTail }}
                </div>
                <q-checkbox
                    :model-value="forceRegressive"
                    :label="msg.publishDialog.forceRegressive"
                    class="q-mt-md"
                    @update:model-value="$emit('update:forceRegressive', Boolean($event))"
                />
                <q-checkbox
                    :model-value="allowZeroPrice"
                    :label="msg.publishDialog.allowZeroPrice"
                    class="q-mt-sm"
                    @update:model-value="$emit('update:allowZeroPrice', Boolean($event))"
                />
            </q-card-section>
            <q-banner v-if="publishError" class="bg-warning q-mx-md q-mb-md" rounded>
                {{ publishError }}
            </q-banner>
            <q-card-section v-if="regressionChanges.length > 0" class="q-pt-none">
                <div class="text-subtitle2 q-mb-xs">{{ msg.publishDialog.regressiveChanges }}</div>
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
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="primary"
                    :label="msg.publishDialog.confirm"
                    :loading="publishing"
                    @click="$emit('execute')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { RegressionChange } from './types.js';

const props = defineProps<{
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

const msg = useSaMessages('plans');
const common = useSaMessages('common');

const bodyTail = computed(() =>
    formatMessage(msg.value.publishDialog.bodyTail, {
        version: props.publishTarget?.version ?? '',
    }),
);

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
