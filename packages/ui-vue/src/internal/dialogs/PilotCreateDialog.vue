<template>
    <!-- The chrome is AdminDialog's, the submit lifecycle not AdminFormDialog's:
     the footer carries the invitation hint, and `created` hands the page what
     the route answered. A refused second factor keeps the prompt open
     (`useMfaPrompt().run`); any other refusal is worded in the banner. -->
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
                        <q-input
                            v-model="form.tenant.name"
                            outlined
                            dense
                            :maxlength="subscriberIdentityMaxLengthOf('legalName')"
                            :placeholder="copy.tenantNamePlaceholder"
                            autofocus
                        />
                    </div>

                    <div class="pl-field pl-field--full">
                        <label>
                            {{ msg.form.slugLabel }}
                            <span class="pl-field__hint">{{ msg.form.slugHint }}</span>
                        </label>
                        <q-input
                            v-model="form.tenant.slug"
                            outlined
                            dense
                            :placeholder="copy.slugPlaceholder"
                            :error="slugConflict"
                            :error-message="slugConflict ? msg.form.slugConflict : undefined"
                            @update:model-value="onSlugInput"
                        >
                            <template v-if="slugPrefix" #prepend>
                                <span class="pl-slug-prefix">{{ slugPrefix }}</span>
                            </template>
                        </q-input>
                    </div>

                    <div v-if="showLegalFields" class="pl-field">
                        <label>{{ msg.createDialog.legalFormLabel }}</label>
                        <q-input
                            v-model="form.tenant.legalForm"
                            outlined
                            dense
                            :placeholder="msg.createDialog.legalFormPlaceholder"
                        />
                    </div>
                    <div v-if="showLegalFields" class="pl-field">
                        <label>
                            {{ msg.createDialog.vatIdLabel }}
                            <span class="pl-field__hint">{{ msg.createDialog.vatIdHint }}</span>
                        </label>
                        <q-input
                            v-model="form.tenant.vatId"
                            outlined
                            dense
                            :maxlength="subscriberIdentityMaxLengthOf('vatId')"
                            :placeholder="msg.createDialog.vatIdPlaceholder"
                        />
                    </div>

                    <p class="pl-section__sub pl-field--full">
                        {{
                            addressRequired
                                ? msg.createDialog.subscriberAddressRequired
                                : msg.createDialog.subscriberAddressOptional
                        }}
                    </p>
                    <div
                        v-for="field in addressFields"
                        :key="field.key"
                        class="pl-field"
                        :class="{ 'pl-field--full': field.key === 'addressLine1' }"
                    >
                        <label :for="field.id">
                            {{ field.label }}
                            <span v-if="field.hint" class="pl-field__hint">{{ field.hint }}</span>
                        </label>
                        <q-input
                            v-model="form.subscriber[field.key]"
                            :for="field.id"
                            outlined
                            dense
                            :maxlength="field.maxlength"
                            :placeholder="field.placeholder"
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
                        <q-input
                            v-model="form.admin.email"
                            outlined
                            dense
                            type="email"
                            :placeholder="copy.adminEmailPlaceholder"
                            :error="Boolean(form.admin.email) && !emailValid"
                            :error-message="msg.createDialog.emailInvalid"
                        />
                    </div>
                    <div class="pl-field">
                        <label>{{ msg.createDialog.firstNameLabel }}</label>
                        <q-input
                            v-model="form.admin.firstName"
                            outlined
                            dense
                            :placeholder="msg.createDialog.firstNamePlaceholder"
                        />
                    </div>
                    <div class="pl-field">
                        <label>{{ msg.createDialog.lastNameLabel }}</label>
                        <q-input
                            v-model="form.admin.lastName"
                            outlined
                            dense
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
                        <q-input
                            v-model="form.admin.initialPassword"
                            outlined
                            dense
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
                            <!-- @optionSurface
                                 A plan option with a colour dot, one of a group — a radio in chip form. -->
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
                            <q-input v-model="form.pilot.endsAt" outlined dense type="date" />
                            <q-btn
                                v-if="form.pilot.endsAt"
                                flat
                                dense
                                no-caps
                                icon="close"
                                :label="common.unlimited"
                                :title="msg.form.endsAtClearTitle"
                                @click="form.pilot.endsAt = ''"
                            />
                        </div>
                        <div class="pl-end-presets">
                            <q-btn
                                v-for="p in presetEnds"
                                :key="p.days"
                                flat
                                dense
                                no-caps
                                :label="`+${p.label}`"
                                @click="setEndsAtDays(p.days)"
                            />
                        </div>
                    </div>

                    <div class="pl-field pl-field--full">
                        <label>
                            {{ msg.form.noteLabel }}
                            <span class="pl-field__hint">{{ msg.form.noteHint }}</span>
                        </label>
                        <q-input
                            v-model="form.pilot.note"
                            outlined
                            dense
                            type="textarea"
                            :rows="3"
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
        :model-value="mfa.show.value"
        :description="mfa.description.value"
        :error="mfa.error.value"
        :setup-hint="mfaSetupHint"
        @update:model-value="mfa.onVisibility"
        @confirm="mfa.onConfirm"
    />
</template>

<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import {
    addDaysToDay,
    subscriberContactMaxLengthOf,
    subscriberIdentityMaxLengthOf,
} from '@saasicat/core';
import MfaPromptDialog from '../../ui/overlay/MfaPromptDialog.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import { IDENTITY_NEUTRAL } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { looksLikeEmail, trimChar } from '../../client/text-shape.js';
import {
    PILOT_SUBSCRIBER_ADDRESS_FIELDS,
    pilotAddressGaps,
    pilotSubscriberOf,
    type PilotSubscriberAddressField,
    type PilotSubscriberAddressForm,
} from '../../client/pilot-subscriber-address.js';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useMfaPrompt } from '../../vue/use-mfa-prompt.js';
import { useAdminErrorText, useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { useSuperAdminManifest } from '../../vue/use-super-admin-context.js';
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
const days = useInstallationDays();

const presetEnds = computed<ReadonlyArray<{ label: string; days: number }>>(() => [
    { label: msg.value.form.preset30Days, days: 30 },
    { label: msg.value.form.preset90Days, days: 90 },
    { label: msg.value.form.preset6Months, days: 180 },
    { label: msg.value.form.preset1Year, days: 365 },
]);

const copy = computed<Required<PilotCopy>>(() => ({ ...msg.value.copyDefaults, ...props.copy }));

// Where a tax adapter decides, a contract needs the subscriber's full address
// (`SC-PRIC-069`); the manifest says so. Without a manifest the route still
// refuses an incomplete one, and the banner shows its sentence.
const addressRequired = useSuperAdminManifest()?.subscriberAddressRequired === true;

function emptyAddress(): PilotSubscriberAddressForm {
    return { addressLine1: '', addressLine2: '', postalCode: '', city: '', country: '' };
}

// One id per mounted dialog, so each label names its own input.
const addressIdPrefix = useId();

const addressFields = computed(() => {
    const texts = msg.value.createDialog;
    const shown: Record<PilotSubscriberAddressField, { label: string; placeholder: string }> = {
        addressLine1: {
            label: texts.addressLine1Label,
            placeholder: texts.addressLine1Placeholder,
        },
        addressLine2: {
            label: texts.addressLine2Label,
            placeholder: texts.addressLine2Placeholder,
        },
        postalCode: { label: texts.postalCodeLabel, placeholder: texts.postalCodePlaceholder },
        city: { label: texts.cityLabel, placeholder: texts.cityPlaceholder },
        country: { label: texts.countryLabel, placeholder: texts.countryPlaceholder },
    };
    const hintOf = (key: PilotSubscriberAddressField): string => {
        if (key === 'country') return texts.countryHint;
        if (key === 'addressLine2' || !addressRequired) return texts.addressOptionalHint;
        return '';
    };
    return PILOT_SUBSCRIBER_ADDRESS_FIELDS.map((key) => ({
        key,
        id: `${addressIdPrefix}-${key}`,
        ...shown[key],
        hint: hintOf(key),
        maxlength: subscriberContactMaxLengthOf(key),
    }));
});

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
        subscriber: emptyAddress(),
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
const mfa = useMfaPrompt();
const errorText = useAdminErrorText();
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
        !!form.pilot.plan &&
        pilotAddressGaps(form.subscriber, addressRequired).length === 0,
);

function setEndsAtDays(count: number): void {
    form.pilot.endsAt = addDaysToDay(days.today(), count);
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            const fresh = emptyForm();
            Object.assign(form.tenant, fresh.tenant);
            Object.assign(form.subscriber, fresh.subscriber);
            Object.assign(form.admin, fresh.admin);
            Object.assign(form.pilot, fresh.pilot);
            error.value = '';
            slugTouched.value = false;
        }
    },
);

function payloadOf(): PilotCreatePayload {
    const payload: PilotCreatePayload = {
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
    };
    // Left out rather than empty: a route that refuses unknown keys would
    // otherwise refuse every pilot created without an address.
    const subscriber = pilotSubscriberOf(form.subscriber);
    if (subscriber) payload.subscriber = subscriber;
    return payload;
}

async function create(payload: PilotCreatePayload, code: string): Promise<PilotCreateResult> {
    loading.value = true;
    try {
        return await props.submit(payload, code);
    } finally {
        loading.value = false;
    }
}

async function onSubmit(): Promise<void> {
    if (!isValid.value) return;
    const payload = payloadOf();
    error.value = '';
    try {
        if (!props.requireMfa) {
            created(await create(payload, ''));
            return;
        }
        const outcome = await mfa.run(
            formatMessage(msg.value.createDialog.mfaDescription, {
                name: payload.tenant.name,
                plan: payload.pilot.plan,
            }),
            msg.value.mfa.invalidCode,
            (code) => create(payload, code),
        );
        if (outcome.done) created(outcome.value);
    } catch (err) {
        error.value = errorText(err);
    }
}

function created(result: PilotCreateResult): void {
    emit('created', result);
    emit('update:modelValue', false);
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
</style>
