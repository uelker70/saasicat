<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <q-card style="min-width: 420px">
            <q-card-section>
                <div class="text-h6">
                    {{
                        target?.endsAt
                            ? msg.terminateDialog.titleChangeEndDate
                            : msg.terminateDialog.titleTerminate
                    }}
                </div>
                <div class="text-body2 q-mt-sm">
                    {{ msg.terminateDialog.bodyPlanPrefix }} <code>{{ plan.planKey }}</code>
                    {{ bodyExpiry }} <b>{{ msg.terminateDialog.bodyWithout }}</b>
                    {{ msg.terminateDialog.bodySuffix }}
                </div>
                <q-input
                    :model-value="dateInput"
                    :label="msg.terminateDialog.dateLabel"
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
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="primary"
                    :label="msg.terminateDialog.submit"
                    :loading="terminating"
                    :disable="!dateInput"
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

const props = defineProps<{
    modelValue: boolean;
    plan: PlanRow;
    target: PlanVersionRow | null;
    dateInput: string;
    error: string | null;
    terminating: boolean;
}>();

const msg = useSaMessages('planDetail');
const common = useSaMessages('common');

const bodyExpiry = computed(() =>
    formatMessage(msg.value.terminateDialog.bodyExpiry, { version: props.target?.version ?? '' }),
);

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'update:dateInput', value: string): void;
    (e: 'execute'): void;
}>();
</script>
