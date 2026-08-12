<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="pl-dlg">
            <q-card-section class="pl-dlg__head">
                <div>
                    <div class="pl-dlg__title">{{ msg.editDialog.title }}</div>
                    <div class="pl-dlg__sub" v-if="row">
                        <strong>{{ row.tenant.name }}</strong>
                        <span class="pl-dlg__sep">·</span>
                        <code>{{ row.tenant.slug }}</code>
                    </div>
                </div>
                <q-btn
                    class="pl-dlg__close"
                    flat
                    dense
                    round
                    icon="close"
                    v-close-popup
                    :disable="loading"
                />
            </q-card-section>

            <q-card-section class="pl-dlg__body">
                <!-- Section 1: Plan -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">1</span>
                        <div>
                            <div class="pl-section__title">{{ msg.form.planLabel }}</div>
                            <div class="pl-section__sub">{{ msg.editDialog.sectionPlanSub }}</div>
                        </div>
                    </header>
                    <div class="pl-plan-select">
                        <button
                            v-for="p in effectivePlanOptions"
                            :key="p.value"
                            type="button"
                            class="pl-plan-opt"
                            :class="{ 'pl-plan-opt--active': form.plan === p.value }"
                            @click="form.plan = p.value"
                        >
                            <span
                                class="pl-plan-opt__dot"
                                :style="{ background: p.color ?? '#94a3b8' }"
                            />
                            <div class="pl-plan-opt__text">
                                <span class="pl-plan-opt__key">{{ p.value }}</span>
                                <span class="pl-plan-opt__label">{{ p.label }}</span>
                            </div>
                            <q-icon
                                v-if="form.plan === p.value"
                                name="check"
                                size="16px"
                                class="pl-plan-opt__check"
                            />
                        </button>
                    </div>
                </section>

                <!-- Section 2: End date -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">2</span>
                        <div>
                            <div class="pl-section__title">
                                {{ msg.editDialog.sectionEndDate }}
                            </div>
                            <div class="pl-section__sub">
                                {{ msg.editDialog.sectionEndDateSub }}
                            </div>
                        </div>
                    </header>
                    <div class="pl-end-row">
                        <input v-model="form.endsAt" class="pl-input" type="date" />
                        <button
                            v-if="form.endsAt"
                            type="button"
                            class="pl-btn-mini"
                            :title="msg.editDialog.clearDateTitle"
                            @click="form.endsAt = ''"
                        >
                            <q-icon name="close" size="12px" />
                            {{ common.unlimited }}
                        </button>
                    </div>
                    <div class="pl-end-presets">
                        <button
                            v-for="p in presetEnds"
                            :key="p.days"
                            type="button"
                            class="pl-preset-btn"
                            @click="setEndsAtDays(p.days)"
                        >
                            +{{ p.label }}
                        </button>
                    </div>
                </section>

                <!-- Section 3: Note -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">3</span>
                        <div>
                            <div class="pl-section__title">{{ msg.editDialog.sectionNote }}</div>
                            <div class="pl-section__sub">{{ msg.editDialog.sectionNoteSub }}</div>
                        </div>
                    </header>
                    <textarea
                        v-model="form.note"
                        class="pl-input pl-textarea"
                        rows="3"
                        :placeholder="notePlaceholder"
                    />
                </section>

                <p v-if="error" class="pl-error">{{ error }}</p>
            </q-card-section>

            <q-card-actions align="right" class="pl-dlg__foot">
                <q-btn flat :label="common.cancel" v-close-popup :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="common.save"
                    :loading="loading"
                    :disable="!isDirty"
                    @click="onSubmit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>

    <MfaPromptDialog
        v-if="requireMfa"
        v-model="showMfa"
        :description="mfaDescription"
        :error="mfaError"
        :setup-hint="mfaSetupHint"
        @confirm="(code) => doSubmit(code)"
    />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import MfaPromptDialog from '../MfaPromptDialog.vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { PilotRow } from '../../pages-standard/PilotsPage.vue';
import type { PilotCopy, PilotEditPayload, PilotEditResult } from './types.js';

// Platform dialog for editing an existing pilot subscription
// (sim layout: numbered sections, plan tile picker, ends-at quick sets).
// Only changed fields are sent — the server leaves fields that are not
// included untouched.

type PlanOption = string | { label?: string; value: string; color?: string };

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        row: PilotRow | null;
        planOptions: readonly PlanOption[];
        /** Tenant-specific labels/placeholders; neutral defaults otherwise. */
        copy?: PilotCopy;
        requireMfa?: boolean;
        mfaSetupHint?: string;
        submit: (
            slug: string,
            payload: PilotEditPayload,
            mfaCode: string,
        ) => Promise<PilotEditResult>;
    }>(),
    { requireMfa: true },
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'updated', result: PilotEditResult): void;
}>();

const msg = useSaMessages('pilots');
const common = useSaMessages('common');

const presetEnds = computed<ReadonlyArray<{ label: string; days: number }>>(() => [
    { label: msg.value.form.preset30Days, days: 30 },
    { label: msg.value.form.preset90Days, days: 90 },
    { label: msg.value.form.preset6Months, days: 180 },
    { label: msg.value.form.preset1Year, days: 365 },
]);

const notePlaceholder = computed(
    () => props.copy?.notePlaceholder ?? msg.value.copyDefaults.notePlaceholder,
);

function normalize(opt: PlanOption): { value: string; label: string; color?: string } {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value, label: opt.label ?? opt.value, color: opt.color };
}

// If the current plan ID is not (or no longer) in the catalog — e.g. a legacy
// value like "STANDARD" from an earlier seed generation — it still appears in
// the picker, so the user can see it and deliberately switch away from it.
const effectivePlanOptions = computed<Array<{ value: string; label: string; color?: string }>>(
    () => {
        const opts = props.planOptions.map(normalize);
        const current = props.row?.plan;
        if (!current) return opts;
        if (opts.some((o) => o.value === current)) return opts;
        return [
            {
                value: current,
                label: formatMessage(msg.value.editDialog.planNotInCatalog, { plan: current }),
            },
            ...opts,
        ];
    },
);

interface FormState {
    plan: string;
    endsAt: string;
    note: string;
}

function fromRow(row: PilotRow | null): FormState {
    return {
        plan: row?.plan ?? '',
        endsAt: row?.pilotEndsAt ? row.pilotEndsAt.slice(0, 10) : '',
        note: row?.pilotNote ?? '',
    };
}

const form = reactive<FormState>(fromRow(null));
const initial = ref<FormState>(fromRow(null));
const loading = ref(false);
const error = ref('');
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');

function setEndsAtDays(days: number): void {
    const d = new Date();
    d.setDate(d.getDate() + days);
    form.endsAt = d.toISOString().slice(0, 10);
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            const fresh = fromRow(props.row);
            Object.assign(form, fresh);
            initial.value = { ...fresh };
            error.value = '';
        }
    },
);

// Send only changed fields to the backend. Empty `endsAt` → `null`
// (clear the date), empty note → `null`. This keeps unchanged fields
// stable server-side and the audit log contains only real changes.
const diff = computed<PilotEditPayload>(() => {
    const out: PilotEditPayload = {};
    if (form.plan !== initial.value.plan) out.plan = form.plan;
    if (form.endsAt !== initial.value.endsAt) {
        out.endsAt = form.endsAt ? form.endsAt : null;
    }
    if (form.note !== initial.value.note) {
        out.note = form.note ? form.note : null;
    }
    return out;
});

const isDirty = computed(() => Object.keys(diff.value).length > 0);

function onSubmit(): void {
    if (!isDirty.value || !props.row) return;
    if (props.requireMfa) {
        mfaDescription.value = formatMessage(msg.value.editDialog.mfaDescription, {
            name: props.row.tenant.name,
        });
        mfaError.value = '';
        showMfa.value = true;
        return;
    }
    void doSubmit('');
}

async function doSubmit(code: string): Promise<void> {
    if (!props.row) return;
    loading.value = true;
    error.value = '';
    try {
        const result = await props.submit(props.row.tenant.slug, diff.value, code);
        showMfa.value = false;
        emit('updated', result);
        emit('update:modelValue', false);
    } catch (err) {
        const response = (
            err as {
                response?: {
                    status?: number;
                    data?: { reason?: string; message?: string };
                };
            }
        ).response;
        const status = response?.status;
        const reason = response?.data?.reason;
        if (
            props.requireMfa &&
            status === 401 &&
            (reason === 'MFA_FAILED' || reason === 'MFA_REQUIRED')
        ) {
            mfaError.value = msg.value.mfa.invalidCode;
        } else if (props.requireMfa && status === 401 && reason === 'MFA_NOT_SET_UP') {
            mfaError.value = response?.data?.message ?? msg.value.mfa.notSetUp;
        } else {
            error.value = response?.data?.message ?? common.value.errorSaveFailed;
            showMfa.value = false;
        }
    } finally {
        loading.value = false;
    }
}
</script>

<style src="./pilot-dialog.css" scoped></style>

<style scoped>
.pl-dlg {
    width: 640px;
    max-width: 96vw;
}

.pl-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-muted, var(--sa-muted));
    margin-top: 3px;
}

.pl-dlg__sep {
    color: #cbd5e1;
    margin: 0 6px;
}

.pl-dlg__sub code {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    background: var(--sa-border-soft);
    color: var(--sa-muted-dark, var(--sa-muted-dark));
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11.5px;
}

.pl-dlg__body {
    padding: 20px 22px;
}

.pl-section {
    margin-bottom: 18px;
}

.pl-textarea {
    resize: vertical;
    min-height: 64px;
}
</style>
