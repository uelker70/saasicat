<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.liftDialog.title"
        :submit-label="msg.liftDialog.submit"
        :submit-disabled="!complete"
        :submit="onSubmit"
        :success-message="msg.liftDialog.done"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <p class="text-body2">
            {{ formatMessage(msg.liftDialog.intro, { feature: row?.featureLabel ?? '' }) }}
        </p>
        <AdminField :label="msg.liftDialog.liftedFrom" :hint="dateHint">
            <q-input v-model="liftedFrom" outlined dense type="datetime-local" />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
// Lifting a withdrawal: from when the feature is granted again — at once
// where the field is left empty. The date is typed in the browser's zone,
// which the hint names, and sent as an instant with its own.

import { computed, ref, watch } from 'vue';
import type { FeatureWithdrawalLifted, FeatureWithdrawalView } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import { browserTimeZone, instantOfLocalInput } from '../../client/maintenance-times.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    modelValue: boolean;
    /** The withdrawal to lift. */
    row: FeatureWithdrawalView | null;
    lift: (
        row: FeatureWithdrawalView,
        liftedFrom: string | null,
    ) => Promise<FeatureWithdrawalLifted | null>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const msg = useSaMessages('featureWithdrawals');
const dateHint = formatMessage(msg.value.liftDialog.liftedFromHint, { zone: browserTimeZone() });
const liftedFrom = ref('');

// Reopening starts empty — at once — not from the last attempt.
watch(
    () => props.modelValue,
    (open) => {
        if (open) liftedFrom.value = '';
    },
    { immediate: true },
);

const complete = computed(
    () =>
        props.row !== null &&
        (liftedFrom.value === '' || instantOfLocalInput(liftedFrom.value) !== null),
);

async function onSubmit(): Promise<FeatureWithdrawalLifted | null> {
    // `complete` has held the row before the button could be pressed.
    if (!props.row) return null;
    return props.lift(props.row, instantOfLocalInput(liftedFrom.value));
}
</script>
