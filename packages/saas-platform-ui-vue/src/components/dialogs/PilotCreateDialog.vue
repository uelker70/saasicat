<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="emit('update:modelValue', $event)"
    >
        <q-card class="pl-dlg">
            <q-card-section class="pl-dlg__head">
                <div>
                    <div class="pl-dlg__title">{{ msg.createDialog.title }}</div>
                    <div class="pl-dlg__sub">{{ subtitle ?? msg.createDialog.subtitle }}</div>
                </div>
                <q-btn
                    v-close-popup
                    class="pl-dlg__close"
                    flat
                    dense
                    round
                    icon="close"
                    :disable="loading"
                />
            </q-card-section>

            <q-card-section class="pl-dlg__body">
                <!-- Section 1: Tenant -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">1</span>
                        <div>
                            <div class="pl-section__title">
                                {{ msg.createDialog.sectionTenant }}
                            </div>
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
                                {{ msg.form.slugLabel }}
                                <span class="pl-field__hint">{{ msg.form.slugHint }}</span>
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
                                {{ msg.form.slugConflict }}
                            </div>
                        </div>

                        <div v-if="showLegalFields" class="pl-field">
                            <label>{{ msg.createDialog.legalFormLabel }}</label>
                            <input
                                v-model="form.tenant.legalForm"
                                class="pl-input"
                                :placeholder="msg.createDialog.legalFormPlaceholder"
                            />
                        </div>
                        <div v-if="showLegalFields" class="pl-field">
                            <label>
                                {{ msg.createDialog.vatIdLabel }}
                                <span class="pl-field__hint">{{ msg.createDialog.vatIdHint }}</span>
                            </label>
                            <input
                                v-model="form.tenant.vatId"
                                class="pl-input"
                                :placeholder="msg.createDialog.vatIdPlaceholder"
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
                            <div class="pl-section__title">{{ msg.createDialog.sectionAdmin }}</div>
                            <div class="pl-section__sub">
                                {{ msg.createDialog.sectionAdminSub }}
                            </div>
                        </div>
                    </header>
                    <div class="pl-grid">
                        <div class="pl-field pl-field--full">
                            <label>{{ msg.createDialog.emailLabel }}</label>
                            <input
                                v-model="form.admin.email"
                                class="pl-input"
                                :class="{ 'pl-input--invalid': form.admin.email && !emailValid }"
                                type="email"
                                :placeholder="copy.adminEmailPlaceholder"
                            />
                            <div v-if="form.admin.email && !emailValid" class="pl-field__error">
                                {{ msg.createDialog.emailInvalid }}
                            </div>
                        </div>
                        <div class="pl-field">
                            <label>{{ msg.createDialog.firstNameLabel }}</label>
                            <input
                                v-model="form.admin.firstName"
                                class="pl-input"
                                :placeholder="msg.createDialog.firstNamePlaceholder"
                            />
                        </div>
                        <div class="pl-field">
                            <label>{{ msg.createDialog.lastNameLabel }}</label>
                            <input
                                v-model="form.admin.lastName"
                                class="pl-input"
                                :placeholder="msg.createDialog.lastNamePlaceholder"
                            />
                        </div>
                        <div class="pl-field pl-field--full">
                            <label>
                                {{ msg.createDialog.initialPasswordLabel }}
                                <span class="pl-field__hint">{{
                                    msg.createDialog.initialPasswordHint
                                }}</span>
                            </label>
                            <input
                                v-model="form.admin.initialPassword"
                                class="pl-input"
                                :placeholder="msg.createDialog.initialPasswordPlaceholder"
                            />
                        </div>
                    </div>
                </section>

                <!-- Section 3: Pilot configuration -->
                <section class="pl-section">
                    <header class="pl-section__head">
                        <span class="pl-section__num">3</span>
                        <div>
                            <div class="pl-section__title">{{ msg.createDialog.sectionPilot }}</div>
                            <div class="pl-section__sub">
                                {{ msg.createDialog.sectionPilotSub }}
                            </div>
                        </div>
                    </header>
                    <div class="pl-grid">
                        <div class="pl-field">
                            <label>{{ msg.form.planLabel }}</label>
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
                            <label>{{ msg.form.endsAtLabel }}</label>
                            <div class="pl-end-row">
                                <input v-model="form.pilot.endsAt" class="pl-input" type="date" />
                                <button
                                    v-if="form.pilot.endsAt"
                                    type="button"
                                    class="pl-btn-mini"
                                    :title="msg.form.endsAtClearTitle"
                                    @click="form.pilot.endsAt = ''"
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
                        </div>

                        <div class="pl-field pl-field--full">
                            <label>
                                {{ msg.form.noteLabel }}
                                <span class="pl-field__hint">{{ msg.form.noteHint }}</span>
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
                    {{ msg.createDialog.invitationHint }} <strong>{{ form.admin.email }}</strong>
                </span>
                <q-btn v-close-popup flat :label="common.cancel" :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="msg.createAction"
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
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { PilotCopy, PilotCreatePayload, PilotCreateResult } from './types.js';

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

const msg = useSaMessages('pilots');
const common = useSaMessages('common');

const presetEnds = computed<ReadonlyArray<{ label: string; days: number }>>(() => [
    { label: msg.value.form.preset30Days, days: 30 },
    { label: msg.value.form.preset90Days, days: 90 },
    { label: msg.value.form.preset6Months, days: 180 },
    { label: msg.value.form.preset1Year, days: 365 },
]);

const copy = computed<Required<PilotCopy>>(() => ({ ...msg.value.copyDefaults, ...props.copy }));

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
        mfaDescription.value = formatMessage(msg.value.createDialog.mfaDescription, {
            name: form.tenant.name,
            plan: form.pilot.plan,
        });
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
            mfaError.value = msg.value.mfa.invalidCode;
        } else if (props.requireMfa && status === 401 && reason === 'MFA_NOT_SET_UP') {
            mfaError.value = response?.data?.message ?? msg.value.mfa.notSetUp;
        } else {
            error.value = response?.data?.message ?? common.value.createFailed;
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
    width: 760px;
    max-width: 96vw;
}

.pl-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-muted);
    margin-top: 3px;
    line-height: 1.4;
}

.pl-dlg__body {
    padding: 20px 22px;
    max-height: 72vh;
    overflow-y: auto;
}

.pl-foot-hint {
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--sa-muted-dark);
    background: var(--sa-primary-50);
    border: 1px solid #bfdbfe;
    border-radius: 999px;
    padding: 4px 12px;
}

.pl-section {
    margin-bottom: 20px;
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
    color: var(--sa-muted);
    display: flex;
    align-items: baseline;
    gap: 6px;
}

.pl-field__hint {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--sa-muted-light);
    font-size: 11px;
}

.pl-field__error {
    font-size: 11.5px;
    color: #b91c1c;
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
    border: 1px solid var(--sa-border);
    border-radius: 8px;
    overflow: hidden;
}

.pl-slug-input__prefix {
    padding: 9px 12px;
    background: var(--sa-bg-surface-2);
    color: var(--sa-muted-light);
    font: 500 12px var(--sa-font-mono, ui-monospace, monospace);
    border-right: 1px solid var(--sa-border);
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
</style>
