<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="pl-dlg">
            <q-card-section class="pl-dlg__head">
                <div>
                    <div class="pl-dlg__title">Pilot-Mandant anlegen</div>
                    <div class="pl-dlg__sub">
                        {{
                            subtitle ??
                            'Neuer Mandant + Initial-Admin werden in einem Schritt angelegt.'
                        }}
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
                <!-- Section 1: Tenant -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">1</span>
                        <div>
                            <div class="pl-section__title">Mandant</div>
                            <div class="pl-section__sub">{{ copy.tenantSubtitle }}</div>
                        </div>
                    </header>
                    <div class="pl-grid">
                        <div class="pl-field pl-field--full">
                            <label>{{ copy.tenantNameLabel }}</label>
                            <input
                                v-model="form.tenant.name"
                                class="pl-input"
                                :placeholder="copy.tenantNamePlaceholder"
                                autofocus
                            />
                        </div>

                        <div class="pl-field pl-field--full">
                            <label>
                                Slug
                                <span class="pl-field__hint"
                                    >wird automatisch aus dem Namen erzeugt</span
                                >
                            </label>
                            <div class="pl-slug-input">
                                <span v-if="slugPrefix" class="pl-slug-input__prefix">{{
                                    slugPrefix
                                }}</span>
                                <input
                                    v-model="form.tenant.slug"
                                    class="pl-input pl-input--flush"
                                    :placeholder="copy.slugPlaceholder"
                                    @input="onSlugInput"
                                />
                            </div>
                            <div v-if="slugConflict" class="pl-field__error">
                                Dieser Slug ist bereits vergeben.
                            </div>
                        </div>

                        <div v-if="showLegalFields" class="pl-field">
                            <label>Rechtsform</label>
                            <input
                                v-model="form.tenant.legalForm"
                                class="pl-input"
                                placeholder="e.V., GmbH, …"
                            />
                        </div>
                        <div v-if="showLegalFields" class="pl-field">
                            <label>
                                USt-IdNr.
                                <span class="pl-field__hint">optional</span>
                            </label>
                            <input
                                v-model="form.tenant.vatId"
                                class="pl-input"
                                placeholder="DE123456789"
                            />
                        </div>
                    </div>
                    <slot name="tenant-extra" :form="form" />
                </section>

                <!-- Section 2: Initial-Admin -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">2</span>
                        <div>
                            <div class="pl-section__title">Initial-Admin</div>
                            <div class="pl-section__sub">
                                Erhält eine Einladungs-E-Mail mit Initial-Passwort.
                            </div>
                        </div>
                    </header>
                    <div class="pl-grid">
                        <div class="pl-field pl-field--full">
                            <label>E-Mail</label>
                            <input
                                v-model="form.admin.email"
                                class="pl-input"
                                :class="{ 'pl-input--invalid': form.admin.email && !emailValid }"
                                type="email"
                                :placeholder="copy.adminEmailPlaceholder"
                            />
                            <div v-if="form.admin.email && !emailValid" class="pl-field__error">
                                Bitte eine gültige E-Mail-Adresse eingeben.
                            </div>
                        </div>
                        <div class="pl-field">
                            <label>Vorname</label>
                            <input
                                v-model="form.admin.firstName"
                                class="pl-input"
                                placeholder="Erika"
                            />
                        </div>
                        <div class="pl-field">
                            <label>Nachname</label>
                            <input
                                v-model="form.admin.lastName"
                                class="pl-input"
                                placeholder="Mustermann"
                            />
                        </div>
                        <div class="pl-field pl-field--full">
                            <label>
                                Initial-Passwort
                                <span class="pl-field__hint"
                                    >leer lassen → automatisch generieren</span
                                >
                            </label>
                            <input
                                v-model="form.admin.initialPassword"
                                class="pl-input"
                                placeholder="•••••••• (automatisch generieren)"
                            />
                        </div>
                    </div>
                </section>

                <!-- Section 3: Pilot configuration -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">3</span>
                        <div>
                            <div class="pl-section__title">Pilot-Konfiguration</div>
                            <div class="pl-section__sub">
                                Plan-Zuweisung, Laufzeit und interne Notiz
                            </div>
                        </div>
                    </header>
                    <div class="pl-grid">
                        <div class="pl-field">
                            <label>Plan</label>
                            <div class="pl-plan-select">
                                <button
                                    v-for="p in normalizedPlanOptions"
                                    :key="p.value"
                                    type="button"
                                    class="pl-plan-opt"
                                    :class="{ 'pl-plan-opt--active': form.pilot.plan === p.value }"
                                    @click="form.pilot.plan = p.value"
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
                                        v-if="form.pilot.plan === p.value"
                                        name="check"
                                        size="16px"
                                        class="pl-plan-opt__check"
                                    />
                                </button>
                            </div>
                        </div>

                        <div class="pl-field">
                            <label>Endet am</label>
                            <div class="pl-end-row">
                                <input v-model="form.pilot.endsAt" class="pl-input" type="date" />
                                <button
                                    v-if="form.pilot.endsAt"
                                    type="button"
                                    class="pl-btn-mini"
                                    title="Auf unbegrenzt setzen"
                                    @click="form.pilot.endsAt = ''"
                                >
                                    <q-icon name="close" size="12px" />
                                    unbegrenzt
                                </button>
                            </div>
                            <div class="pl-end-presets">
                                <button
                                    v-for="p in PRESET_ENDS"
                                    :key="p.days"
                                    type="button"
                                    class="pl-preset-btn"
                                    @click="setEndsAtDays(p.days)"
                                >
                                    +{{ p.label }}
                                </button>
                            </div>
                        </div>

                        <div class="pl-field pl-field--full">
                            <label>
                                Note
                                <span class="pl-field__hint"
                                    >intern · nicht für Kunden sichtbar</span
                                >
                            </label>
                            <textarea
                                v-model="form.pilot.note"
                                class="pl-input pl-textarea"
                                rows="3"
                                :placeholder="copy.notePlaceholder"
                            />
                        </div>
                    </div>
                </section>

                <p v-if="error" class="pl-error">{{ error }}</p>
            </q-card-section>

            <q-card-actions align="right" class="pl-dlg__foot">
                <span v-if="form.admin.email && emailValid" class="pl-foot-hint">
                    <q-icon name="send" size="14px" />
                    Einladung geht an <strong>{{ form.admin.email }}</strong>
                </span>
                <q-btn flat label="Abbrechen" v-close-popup :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    label="Pilot anlegen"
                    :loading="loading"
                    :disable="!isValid"
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
import {
    DEFAULT_PILOT_COPY,
    type PilotCopy,
    type PilotCreatePayload,
    type PilotCreateResult,
} from './types.js';

// Platform pilot-create dialog (sim layout: 3 numbered sections,
// slug-prefix display, plan-tile picker, ends-at quick-sets, footer hint).
// The app provides plan options + submit handler. Custom fields per app via
// the `tenant-extra` slot; consumers can toggle `showLegalFields` /
// `slugPrefix` / `existingSlugs`.

/** Plan option either as a key (string) or with a readable label + color. */
type PlanOption = string | { label?: string; value: string; color?: string };

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        planOptions: readonly PlanOption[];
        defaultPlan?: string;
        subtitle?: string;
        /** Tenant-specific labels/placeholders; neutral defaults otherwise. */
        copy?: PilotCopy;
        showLegalFields?: boolean;
        /** Optional prefix before the slug input (e.g. "example.com /"). */
        slugPrefix?: string;
        /** Known slugs for the conflict check (prevents submit). */
        existingSlugs?: readonly string[];
        requireMfa?: boolean;
        mfaSetupHint?: string;
        submit: (payload: PilotCreatePayload, mfaCode: string) => Promise<PilotCreateResult>;
    }>(),
    {
        showLegalFields: true,
        requireMfa: true,
        existingSlugs: () => [],
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'created', result: PilotCreateResult): void;
}>();

const PRESET_ENDS: ReadonlyArray<{ label: string; days: number }> = [
    { label: '30 Tage', days: 30 },
    { label: '90 Tage', days: 90 },
    { label: '6 Monate', days: 180 },
    { label: '1 Jahr', days: 365 },
];

const copy = computed<Required<PilotCopy>>(() => ({ ...DEFAULT_PILOT_COPY, ...props.copy }));

const normalizedPlanOptions = computed<Array<{ value: string; label: string; color?: string }>>(
    () =>
        props.planOptions.map((opt) => {
            if (typeof opt === 'string') return { value: opt, label: opt };
            return { value: opt.value, label: opt.label ?? opt.value, color: opt.color };
        }),
);

function defaultPlanValue(): string {
    if (props.defaultPlan) return props.defaultPlan;
    return normalizedPlanOptions.value[0]?.value ?? '';
}

function emptyForm() {
    return {
        tenant: { name: '', slug: '', legalForm: '', vatId: '' },
        admin: { email: '', firstName: '', lastName: '', initialPassword: '' },
        pilot: {
            plan: defaultPlanValue(),
            note: '',
            endsAt: '',
        },
    };
}

const form = reactive(emptyForm());
const loading = ref(false);
const error = ref('');
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
const slugTouched = ref(false);

function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function onSlugInput(): void {
    slugTouched.value = true;
    form.tenant.slug = slugify(form.tenant.slug);
}

watch(
    () => form.tenant.name,
    (name) => {
        if (!slugTouched.value) form.tenant.slug = slugify(name);
    },
);

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin.email));
const slugConflict = computed(
    () => !!form.tenant.slug && props.existingSlugs.includes(form.tenant.slug),
);

const isValid = computed(
    () =>
        !!form.tenant.name.trim() &&
        !!form.tenant.slug.trim() &&
        !slugConflict.value &&
        emailValid.value &&
        !!form.admin.firstName.trim() &&
        !!form.admin.lastName.trim() &&
        !!form.pilot.plan,
);

function setEndsAtDays(days: number): void {
    const d = new Date();
    d.setDate(d.getDate() + days);
    form.pilot.endsAt = d.toISOString().slice(0, 10);
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            const fresh = emptyForm();
            Object.assign(form.tenant, fresh.tenant);
            Object.assign(form.admin, fresh.admin);
            Object.assign(form.pilot, fresh.pilot);
            error.value = '';
            slugTouched.value = false;
        }
    },
);

function onSubmit(): void {
    if (!isValid.value) return;
    if (props.requireMfa) {
        mfaDescription.value = `Pilot-Mandant "${form.tenant.name}" anlegen — Plan ${form.pilot.plan}.`;
        mfaError.value = '';
        showMfa.value = true;
        return;
    }
    void doSubmit('');
}

async function doSubmit(code: string): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
        const result = await props.submit(
            {
                tenant: {
                    name: form.tenant.name,
                    slug: form.tenant.slug || undefined,
                    legalForm: form.tenant.legalForm || undefined,
                    vatId: form.tenant.vatId || undefined,
                },
                admin: {
                    email: form.admin.email,
                    firstName: form.admin.firstName,
                    lastName: form.admin.lastName,
                    initialPassword: form.admin.initialPassword || undefined,
                },
                pilot: {
                    plan: form.pilot.plan,
                    note: form.pilot.note || undefined,
                    endsAt: form.pilot.endsAt || undefined,
                },
            },
            code,
        );
        showMfa.value = false;
        emit('created', result);
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
            mfaError.value = 'TOTP-Code ungültig.';
        } else if (props.requireMfa && status === 401 && reason === 'MFA_NOT_SET_UP') {
            mfaError.value =
                response?.data?.message ?? 'MFA ist für diesen Account nicht eingerichtet.';
        } else {
            error.value = response?.data?.message ?? 'Anlegen fehlgeschlagen';
            showMfa.value = false;
        }
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.pl-dlg {
    width: 760px;
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
    line-height: 1.4;
}
.pl-dlg__close {
    margin-left: auto;
}
.pl-dlg__body {
    padding: 20px 22px;
    max-height: 72vh;
    overflow-y: auto;
}
.pl-dlg__foot {
    border-top: 1px solid var(--sa-border, #e2e8f0);
    background: #fbfbfd;
    padding: 12px 18px;
}
.pl-foot-hint {
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--sa-muted-dark, #475569);
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 999px;
    padding: 4px 12px;
}

.pl-section {
    margin-bottom: 20px;
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

.pl-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 14px;
}
.pl-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.pl-field--full {
    grid-column: 1 / -1;
}
.pl-field label {
    font: 600 11px var(--sa-font-body, system-ui, sans-serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--sa-muted, #64748b);
    display: flex;
    align-items: baseline;
    gap: 6px;
}
.pl-field__hint {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: #94a3b8;
    font-size: 11px;
}
.pl-field__error {
    font-size: 11.5px;
    color: #b91c1c;
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
.pl-input--invalid {
    border-color: #fca5a5;
}
.pl-input::placeholder {
    color: #cbd5e1;
}
.pl-textarea {
    resize: vertical;
    min-height: 64px;
    font-family: var(--sa-font-body, system-ui, sans-serif);
}

.pl-slug-input {
    display: flex;
    align-items: stretch;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    overflow: hidden;
}
.pl-slug-input__prefix {
    padding: 9px 12px;
    background: #f8fafc;
    color: #94a3b8;
    font: 500 12px var(--sa-font-mono, ui-monospace, monospace);
    border-right: 1px solid var(--sa-border, #e2e8f0);
    white-space: nowrap;
}
.pl-input--flush {
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
}
.pl-input--flush:focus {
    box-shadow: none !important;
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
