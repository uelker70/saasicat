<template>
    <AdminDialog
        :model-value="modelValue"
        :title="
            target?.endsAt
                ? msg.terminateDialog.titleChangeEndDate
                : msg.terminateDialog.titleTerminate
        "
        size="sm"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div>
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
        </div>
        <template #footer>
            <AdminBanner v-if="error" tone="negative">{{ error }}</AdminBanner>
            <div class="sa-dialog__actions">
                <q-btn flat :label="common.cancel" @click="$emit('update:modelValue', false)" />
                <q-btn
                    color="primary"
                    :label="msg.terminateDialog.submit"
                    :loading="terminating"
                    :disable="!dateInput"
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
import type { PlanRow, PlanVersionRow } from '@saasicat/core';
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
