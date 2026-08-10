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

<style scoped>
.pl-dlg {
    width: 640px;
    max-width: 96vw;
}
.pl-dlg__head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
}
.pl-dlg__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 17px;
    color: var(--sa-heading, #0f172a);
    letter-spacing: -0.015em;
}
.pl-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-muted, #64748b);
    margin-top: 3px;
}
.pl-dlg__sep {
    color: #cbd5e1;
    margin: 0 6px;
}
.pl-dlg__sub code {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    background: #f1f5f9;
    color: var(--sa-muted-dark, #475569);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11.5px;
}
.pl-dlg__close {
    margin-left: auto;
}
.pl-dlg__body {
    padding: 20px 22px;
}
.pl-dlg__foot {
    border-top: 1px solid var(--sa-border, #e2e8f0);
    background: #fbfbfd;
    padding: 12px 18px;
}

.pl-section {
    margin-bottom: 18px;
}
.pl-section:last-of-type {
    margin-bottom: 4px;
}
.pl-section__head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f1f5f9;
}
.pl-section__num {
    width: 24px;
    height: 24px;
    background: #eff6ff;
    color: #1d4ed8;
    border-radius: 50%;
    font: 700 12px var(--sa-font-body, system-ui, sans-serif);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pl-section__title {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
    letter-spacing: -0.005em;
}
.pl-section__sub {
    font-size: 11.5px;
    color: #94a3b8;
    margin-top: 2px;
}

.pl-input {
    width: 100%;
    padding: 9px 12px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    font: 13px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-body, #1e293b);
    outline: 0;
    transition:
        border-color 0.12s,
        box-shadow 0.12s;
}
.pl-input:focus {
    border-color: var(--sa-primary, #3f6bff);
    box-shadow: 0 0 0 3px rgba(63, 107, 255, 0.12);
}
.pl-textarea {
    resize: vertical;
    min-height: 64px;
}

.pl-plan-select {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.pl-plan-opt {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 11px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    font-family: var(--sa-font-body, system-ui, sans-serif);
    transition:
        border-color 0.12s,
        background 0.12s;
}
.pl-plan-opt:hover {
    border-color: #93c5fd;
    background: #fafbff;
}
.pl-plan-opt--active {
    border-color: var(--sa-primary, #2563eb);
    background: #eff6ff;
    box-shadow: 0 0 0 1px var(--sa-primary, #2563eb) inset;
}
.pl-plan-opt__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
}
.pl-plan-opt__text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}
.pl-plan-opt__key {
    font: 700 11px var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.05em;
    color: var(--sa-heading, #0f172a);
}
.pl-plan-opt__label {
    font-size: 11px;
    color: var(--sa-muted, #64748b);
    margin-top: 1px;
}
.pl-plan-opt__check {
    color: #1d4ed8;
}

.pl-end-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
.pl-end-row .pl-input {
    flex: 1;
}
.pl-btn-mini {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 7px 10px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 7px;
    color: var(--sa-muted-dark, #475569);
    font: 500 11.5px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    white-space: nowrap;
}
.pl-btn-mini:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
}
.pl-end-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
}
.pl-preset-btn {
    padding: 4px 9px;
    background: #fff;
    border: 1px dashed #cbd5e1;
    border-radius: 999px;
    font: 600 11px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-muted-dark, #475569);
    cursor: pointer;
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}
.pl-preset-btn:hover {
    background: #eff6ff;
    border-color: #93c5fd;
    border-style: solid;
    color: #1d4ed8;
}

.pl-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    margin: 12px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
}
</style>
