<template>
    <!-- The chrome is AdminDialog's; the submit lifecycle is not AdminFormDialog's.
     A failure here goes to one of two places depending on the response reason —
     an invalid or missing second factor belongs in the MFA prompt, everything
     else in this dialog — and a component that owns the error cannot make that
     split. Rather than widen AdminFormDialog for one caller, the two dialogs
     that re-prompt keep their own handler. -->
    <AdminDialog
        :model-value="modelValue"
        :title="msg.createDialog.title"
        :subtitle="subtitle ?? msg.createDialog.subtitle"
        size="lg"
        persistent
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div>
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
                                    :style="{ background: p.color ?? IDENTITY_NEUTRAL }"
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
        </div>
        <template #footer>
            <AdminBanner v-if="error" tone="negative">{{ error }}</AdminBanner>
            <div class="sa-dialog__actions">
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
            </div>
        </template>
    </AdminDialog>

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
import MfaPromptDialog from '../../ui/overlay/MfaPromptDialog.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import { IDENTITY_NEUTRAL } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { looksLikeEmail, trimChar } from '../../client/text-shape.js';
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
    return trimChar(
        s
            .toLowerCase()
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '-'),
        '-',
    );
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

const emailValid = computed(() => looksLikeEmail(form.admin.email));
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
.pl-foot-hint {
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    background: var(--sa-color-accent-surface-strong);
    border: 1px solid var(--sa-color-info-border);
    border-radius: var(--sa-radius-pill);
    padding: var(--sa-space-2) var(--sa-space-4);
}

.pl-section {
    margin-bottom: var(--sa-space-6);
}

.pl-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sa-space-4) var(--sa-space-4);
}

.pl-field {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}

.pl-field--full {
    grid-column: 1 / -1;
}

.pl-field label {
    font: 600 var(--sa-text-xs) var(--sa-font-body, system-ui, sans-serif);
    letter-spacing: var(--sa-tracking-wide);
    text-transform: uppercase;
    color: var(--sa-color-fg-muted);
    display: flex;
    align-items: baseline;
    gap: var(--sa-space-2);
}

.pl-field__hint {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-xs);
}

.pl-field__error {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-negative-fg);
}

.pl-input--invalid {
    border-color: var(--sa-color-negative-border);
}

.pl-input::placeholder {
    color: var(--sa-color-fg-disabled);
}

.pl-textarea {
    resize: vertical;
    min-height: 64px;
    font-family: var(--sa-font-body, system-ui, sans-serif);
}

.pl-slug-input {
    display: flex;
    align-items: stretch;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    overflow: hidden;
}

.pl-slug-input__prefix {
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-subtle);
    font: 500 var(--sa-text-sm) var(--sa-font-mono, ui-monospace, monospace);
    border-right: 1px solid var(--sa-color-border);
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
