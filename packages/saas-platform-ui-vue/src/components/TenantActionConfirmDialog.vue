<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="tenant-action-confirm">
            <q-card-section class="header">
                <q-icon
                    :name="iconForAction"
                    size="22px"
                    :color="isDangerous ? 'negative' : 'primary'"
                />
                <div class="text-h6">{{ def?.label ?? msg.actions.confirmTitle }}</div>
            </q-card-section>

            <q-card-section v-if="def">
                <p class="tenant-action-confirm__lead">
                    {{ msg.actions.leadAction }} <strong>„{{ def.label }}"</strong>
                    {{ msg.actions.leadForTenant }}
                    <strong>„{{ row?.name ?? row?.slug ?? '–' }}"</strong>.
                </p>

                <!-- typed-slug / typed-production: slug confirmation as a safety
                     gate against accidentally clicking destructive actions. -->
                <template v-if="needsTypedSlug">
                    <p class="tenant-action-confirm__hint">
                        {{ msg.actions.typedSlugHint }}
                        <code>{{ row?.slug }}</code
                        >:
                    </p>
                    <q-input
                        v-model="slugInput"
                        outlined
                        dense
                        autofocus
                        :error="slugError"
                        :error-message="slugErrorMessage"
                        :placeholder="row?.slug"
                    />
                </template>

                <!-- confirmType='date': ISO date, passed through to the handler
                     via `extras.until` (e.g. pilots.extend). -->
                <template v-if="needsDate">
                    <q-input
                        v-model="dateInput"
                        outlined
                        dense
                        type="date"
                        class="q-mt-md"
                        :min="dateMin"
                        :label="dateLabel"
                        :error="dateError"
                        :error-message="dateError ? msg.actions.dateFutureError : undefined"
                    />
                </template>

                <!-- Reason is always required — the platform backends demand it
                     as MinLength(5) for AuditLog. Apps can switch it off via
                     `reasonRequired: false`, but the default is required. -->
                <q-input
                    v-if="reasonRequired"
                    v-model="reasonInput"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    class="q-mt-md"
                    :autofocus="!needsTypedSlug && !needsDate"
                    :label="msg.actions.reasonLabel"
                    :error="reasonError"
                    :error-message="reasonError ? msg.actions.reasonError : undefined"
                />
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat :label="common.cancel" @click="onCancel" />
                <q-btn
                    unelevated
                    :color="isDangerous ? 'negative' : 'primary'"
                    :label="def?.label ?? common.confirm"
                    :disable="!canSubmit"
                    @click="onConfirm"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TenantActionDef, TenantDto } from '@saasicat/types';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

// Platform-standard confirm dialog for tenant actions. Covers both confirm
// paths from the manifest in a single UI:
//   - 'simple': reason required only (or reasonRequired=false)
//   - 'typed-slug' / 'typed-production': additionally slug confirmation
//
// Apps don't need to handle the Quasar prompts themselves and can use the
// dialog directly as the `confirm` provider in
// `useTenantActionFlow({ confirm })`.

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        def: TenantActionDef | null;
        row: (TenantDto & Record<string, unknown>) | null;
        /**
         * Reason required? Defaults to `true`, because platform backends
         * enforce the reason as MinLength(5) for AuditLog. Apps with actions
         * that don't need a reason (e.g. read/export actions) can set
         * `false`.
         */
        reasonRequired?: boolean;
    }>(),
    { reasonRequired: true },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submit', payload: { reason: string | null; extras?: Record<string, unknown> }): void;
    (e: 'cancel'): void;
}>();

const msg = useSaMessages('tenants');
const common = useSaMessages('common');

const slugInput = ref('');
const reasonInput = ref('');
const dateInput = ref('');
const slugError = ref(false);
const reasonError = ref(false);
const dateError = ref(false);

const slugErrorMessage = computed(() =>
    slugError.value
        ? formatMessage(msg.value.actions.slugMismatch, { slug: props.row?.slug ?? '' })
        : undefined,
);

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            slugInput.value = '';
            reasonInput.value = '';
            dateInput.value = '';
            slugError.value = false;
            reasonError.value = false;
            dateError.value = false;
        }
    },
);

const needsTypedSlug = computed(
    () => props.def?.confirmType === 'typed-slug' || props.def?.confirmType === 'typed-production',
);
const needsDate = computed(() => props.def?.confirmType === 'date');

const dateMin = computed(() => new Date().toISOString().slice(0, 10));
const dateLabel = computed(() => {
    const key = props.def?.actionKey ?? '';
    if (key.endsWith('.extend')) return msg.value.actions.extendUntilLabel;
    return common.value.date;
});

const isDangerous = computed(() => {
    const key = props.def?.actionKey ?? '';
    return key.endsWith('.suspend') || key.endsWith('.revoke') || key.endsWith('.cancel');
});

const iconForAction = computed(() => {
    const key = props.def?.actionKey ?? '';
    if (key.endsWith('.suspend')) return 'block';
    if (key.endsWith('.reactivate')) return 'play_arrow';
    if (key.endsWith('.revoke')) return 'cancel';
    return 'check';
});

const canSubmit = computed(() => {
    if (needsTypedSlug.value && slugInput.value.trim() !== (props.row?.slug ?? '')) {
        return false;
    }
    if (props.reasonRequired && reasonInput.value.trim().length < 5) {
        return false;
    }
    if (needsDate.value && !isFutureIsoDate(dateInput.value)) {
        return false;
    }
    return true;
});

function isFutureIsoDate(iso: string): boolean {
    if (!iso) return false;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parsed.getTime() >= today.getTime();
}

function onConfirm(): void {
    slugError.value = needsTypedSlug.value && slugInput.value.trim() !== (props.row?.slug ?? '');
    reasonError.value = props.reasonRequired && reasonInput.value.trim().length < 5;
    dateError.value = needsDate.value && !isFutureIsoDate(dateInput.value);
    if (slugError.value || reasonError.value || dateError.value) return;
    const payload: { reason: string | null; extras?: Record<string, unknown> } = {
        reason: reasonInput.value.trim() || null,
    };
    if (needsDate.value) {
        // Normalize the ISO date to the UTC day boundary — the backend gets a
        // sub-day-precise date, while the UI has only day resolution.
        payload.extras = { until: new Date(dateInput.value).toISOString() };
    }
    emit('submit', payload);
}

function onCancel(): void {
    emit('cancel');
    emit('update:modelValue', false);
}
</script>

<style scoped>
.tenant-action-confirm {
    min-width: 400px;
    max-width: 520px;
}
.header {
    display: flex;
    align-items: center;
    gap: 12px;
}
.tenant-action-confirm__lead {
    margin: 0 0 12px;
    color: #475569;
    line-height: 1.5;
}
.tenant-action-confirm__hint {
    margin: 0 0 8px;
    color: #475569;
    font-size: 13px;
}
.tenant-action-confirm__hint code {
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 13px;
}
</style>
