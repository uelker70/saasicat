<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="window ? msg.form.rescheduleTitle : msg.form.announceTitle"
        :subtitle="formatMessage(msg.form.zone, { zone })"
        :submit-label="window ? msg.form.submitSave : msg.form.submitAnnounce"
        :submit-disabled="!complete"
        :submit="onSubmit"
        :success-message="window ? msg.form.rescheduled : msg.form.announced"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminFieldGrid>
            <AdminField v-if="!locked" :label="msg.form.startsAt" required>
                <q-input v-model="form.startsAt" outlined dense type="datetime-local" />
            </AdminField>
            <AdminField :label="msg.form.endsAt" :required="!locked">
                <q-input v-model="form.endsAt" outlined dense type="datetime-local" />
            </AdminField>
        </AdminFieldGrid>
        <AdminField :label="msg.form.message">
            <q-input
                v-model="form.message"
                outlined
                dense
                type="textarea"
                autogrow
                counter
                :maxlength="MAINTENANCE_MESSAGE_MAX_LENGTH"
            />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { MAINTENANCE_MESSAGE_MAX_LENGTH, type MaintenanceWindowView } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import {
    browserTimeZone,
    instantOfLocalInput,
    localInputOf,
} from '../../client/maintenance-times.js';
import type {
    MaintenanceAnnouncementInput,
    MaintenanceRevisionInput,
} from '../../client/resources/maintenance.resource.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import AdminFieldGrid from '../../ui/page/AdminFieldGrid.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// Announcing a window, or moving the open one. The times are typed in the
// browser's zone, which the subtitle names, and sent as instants with theirs.
// A locked window keeps its start — the lock began when it began — so its form
// asks for the end and the message only.

const props = defineProps<{
    modelValue: boolean;
    /** The open window to move; null to announce a new one. */
    window: MaintenanceWindowView | null;
    announce: (input: MaintenanceAnnouncementInput) => Promise<void>;
    reschedule: (id: string, input: MaintenanceRevisionInput) => Promise<void>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const msg = useSaMessages('maintenance');
const zone = browserTimeZone();
const form = reactive({ startsAt: '', endsAt: '', message: '' });
const locked = computed(() => props.window?.status === 'locked');

// Reopening starts from the window as it stands, not from the last attempt.
watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        form.startsAt = localInputOf(props.window?.startsAt);
        form.endsAt = localInputOf(props.window?.endsAt);
        form.message = props.window?.message ?? '';
    },
    { immediate: true },
);

const complete = computed(() =>
    locked.value
        ? true
        : instantOfLocalInput(form.startsAt) !== null && instantOfLocalInput(form.endsAt) !== null,
);

async function onSubmit(): Promise<void> {
    const startsAt = instantOfLocalInput(form.startsAt) ?? undefined;
    const endsAt = instantOfLocalInput(form.endsAt) ?? undefined;
    const message = form.message.trim() === '' ? null : form.message;
    if (!props.window) {
        // `complete` has held both times before the button could be pressed.
        await props.announce({ startsAt: startsAt ?? '', endsAt: endsAt ?? '', message });
        return;
    }
    await props.reschedule(props.window.id, {
        ...(locked.value ? {} : { startsAt }),
        endsAt,
        message,
    });
}
</script>
