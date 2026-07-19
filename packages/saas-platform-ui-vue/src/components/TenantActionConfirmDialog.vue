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
                <div class="text-h6">{{ def?.label ?? 'Aktion bestätigen' }}</div>
            </q-card-section>

            <q-card-section v-if="def">
                <p class="tenant-action-confirm__lead">
                    Aktion <strong>„{{ def.label }}"</strong> für Tenant
                    <strong>„{{ row?.name ?? row?.slug ?? '–' }}"</strong>.
                </p>

                <!-- typed-slug / typed-production: Slug-Bestätigung als Sicherheits-
                     gate gegen versehentliches Klicken auf zerstörerische Actions. -->
                <template v-if="needsTypedSlug">
                    <p class="tenant-action-confirm__hint">
                        Bestätige durch Eintippen des Slugs
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

                <!-- confirmType='date': ISO-Datum, wird via `extras.until`
                     an den Handler durchgereicht (z. B. pilots.extend). -->
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
                        :error-message="
                            dateError ? 'Bitte ein Datum in der Zukunft wählen.' : undefined
                        "
                    />
                </template>

                <!-- Reason ist immer Pflicht — die Plattform-Backends verlangen ihn
                     als MinLength(5) für AuditLog. App kann via `reasonRequired: false`
                     ausschalten, aber Default ist Pflicht. -->
                <q-input
                    v-if="reasonRequired"
                    v-model="reasonInput"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    class="q-mt-md"
                    :autofocus="!needsTypedSlug && !needsDate"
                    label="Grund (Pflicht für Audit-Log, mindestens 5 Zeichen)"
                    :error="reasonError"
                    :error-message="
                        reasonError
                            ? 'Bitte einen Grund mit mindestens 5 Zeichen angeben.'
                            : undefined
                    "
                />
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="onCancel" />
                <q-btn
                    unelevated
                    :color="isDangerous ? 'negative' : 'primary'"
                    :label="def?.label ?? 'Bestätigen'"
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

// Plattform-Standard-Confirm-Dialog für Tenant-Actions. Deckt beide Confirm-
// Pfade aus dem Manifest in einer UI ab:
//   - 'simple': nur Reason-Pflicht (oder reasonRequired=false)
//   - 'typed-slug' / 'typed-production': zusätzlich Slug-Bestätigung
//
// Apps brauchen sich um die Quasar-Prompts nicht selbst kümmern und
// können den Dialog direkt als `confirm`-Provider in
// `useTenantActionFlow({ confirm })` einsetzen.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4.5.

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        def: TenantActionDef | null;
        row: (TenantDto & Record<string, unknown>) | null;
        /**
         * Reason als Pflicht? Default `true`, weil Plattform-Backends den
         * Reason als MinLength(5) für AuditLog erzwingen. Apps mit Actions,
         * die keinen Reason brauchen (z. B. Lese-/Export-Aktionen), können
         * `false` setzen.
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

const slugInput = ref('');
const reasonInput = ref('');
const dateInput = ref('');
const slugError = ref(false);
const reasonError = ref(false);
const dateError = ref(false);

const slugErrorMessage = computed(() =>
    slugError.value ? `Muss exakt „${props.row?.slug}“ sein` : undefined,
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
    if (key.endsWith('.extend')) return 'Verlängern bis (Datum)';
    return 'Datum';
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
        // ISO-Datum als UTC-Tagesgrenze normieren — Backend bekommt Sub-day-
        // präzises Datum, die UI hat nur Tagesauflösung.
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
