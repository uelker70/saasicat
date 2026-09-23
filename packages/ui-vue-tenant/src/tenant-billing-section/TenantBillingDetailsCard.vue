<template>
    <TenantCardSection v-if="billing.available.value" class="sp-billing-details">
        <section :aria-labelledby="headingId">
            <h3 :id="headingId" class="sp-billing-details__title">
                {{ i18n.billingDetailsTitle }}
            </h3>

            <p v-if="billing.loading.value && !current" class="sp-billing-details__sub">
                {{ i18n.loading }}
            </p>
            <p v-else-if="billing.error.value" class="sp-billing-details__error" role="alert">
                {{ i18n.billingDetailsLoadFailed }}
            </p>
            <template v-else-if="current">
                <dl class="sp-billing-details__identity">
                    <div v-for="row in identity" :key="row.label" class="sp-billing-details__row">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.value ?? i18n.billingDetailsNotStated }}</dd>
                    </div>
                </dl>
                <p class="sp-billing-details__sub">{{ i18n.billingDetailsIdentityNote }}</p>

                <div class="sp-billing-details__fields">
                    <label
                        v-for="field in CONTACT_FIELDS"
                        :key="field"
                        class="sp-billing-details__field"
                        :class="`sp-billing-details__field--${field}`"
                    >
                        <span class="sp-billing-details__label">{{ labelOf(field) }}</span>
                        <input
                            v-model="draft[field]"
                            class="sp-billing-details__input"
                            :type="field === 'invoiceEmail' ? 'email' : 'text'"
                            :autocomplete="AUTOCOMPLETE[field]"
                            :required="field !== 'addressLine2'"
                            :maxlength="field === 'country' ? 2 : undefined"
                            :aria-describedby="field === 'country' ? countryHintId : undefined"
                            :aria-invalid="refusedField === field ? 'true' : undefined"
                        />
                        <span
                            v-if="field === 'country'"
                            :id="countryHintId"
                            class="sp-billing-details__hint"
                        >
                            {{ i18n.billingDetailsCountryHint }}
                        </span>
                    </label>
                </div>

                <p v-if="saveFailure" class="sp-billing-details__error" role="alert">
                    {{ saveFailure }}
                </p>
                <p v-else-if="saved" class="sp-billing-details__saved" role="status">
                    {{ i18n.billingDetailsSaved }}
                </p>
                <div class="sp-billing-details__actions">
                    <TenantButton :loading="saving" :disabled="!changed" @click="onSave">
                        {{ i18n.billingDetailsSave }}
                    </TenantButton>
                </div>
            </template>
        </section>
    </TenantCardSection>
</template>

<script setup lang="ts">
import {
    httpStatusOf,
    isAdminError,
    useTenantBillingDetails,
    type HttpClient,
    type TenantBillingContactChange,
    type TenantBillingContactField,
    type TenantBillingDetailsShape,
} from '@saasicat/ui-vue';
import { computed, reactive, ref, useId, watch } from 'vue';

import { messageParts } from '../message-parts.js';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';

// Whom the subscription is billed to. Shown only to a user the server lets see
// it — anyone else gets a 403, and the card does not render. The tenant edits
// how it is reached; the legal name and the tax identifiers are the party its
// contracts are concluded with, so they are shown, and the operator corrects
// them. Only the fields that changed are sent.

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
}>();

const CONTACT_FIELDS: readonly TenantBillingContactField[] = [
    'addressLine1',
    'addressLine2',
    'postalCode',
    'city',
    'country',
    'invoiceEmail',
];

const AUTOCOMPLETE: Record<TenantBillingContactField, string> = {
    addressLine1: 'address-line1',
    addressLine2: 'address-line2',
    postalCode: 'postal-code',
    city: 'address-level2',
    country: 'country',
    invoiceEmail: 'email',
};

const i18n = useTenantI18n();
const billing = useTenantBillingDetails({ http: props.http, apiPrefix: props.apiPrefix });
const headingId = `sp-billing-details-${useId()}`;
const countryHintId = `sp-billing-details-country-${useId()}`;

const current = computed(() => billing.details.value);
const draft = reactive<Record<TenantBillingContactField, string>>(emptyDraft());
const saving = ref(false);
const saved = ref(false);
const saveFailure = ref<string | null>(null);
const refusedField = ref<string | null>(null);

watch(current, (details) => Object.assign(draft, draftOf(details)), { immediate: true });

const identity = computed(() => [
    { label: i18n.value.billingDetailsCustomerNumber, value: current.value?.customerNumber },
    { label: i18n.value.billingDetailsLegalName, value: current.value?.legalName },
    { label: i18n.value.billingDetailsVatId, value: current.value?.vatId },
    { label: i18n.value.billingDetailsTaxNumber, value: current.value?.taxNumber },
]);

const change = computed<TenantBillingContactChange>(() => {
    const loaded = draftOf(current.value);
    const named: TenantBillingContactChange = {};
    for (const field of CONTACT_FIELDS) {
        if (draft[field] !== loaded[field]) named[field] = draft[field].trim() || null;
    }
    return named;
});
const changed = computed(() => Object.keys(change.value).length > 0);
// "Saved" describes the details as they were saved, not an edit made after it.
watch(changed, (edited) => {
    if (edited) saved.value = false;
});

const LABEL_KEYS = {
    addressLine1: 'billingDetailsAddressLine1',
    addressLine2: 'billingDetailsAddressLine2',
    postalCode: 'billingDetailsPostalCode',
    city: 'billingDetailsCity',
    country: 'billingDetailsCountry',
    invoiceEmail: 'billingDetailsInvoiceEmail',
} as const;

function labelOf(field: TenantBillingContactField): string {
    return i18n.value[LABEL_KEYS[field]];
}

async function onSave(): Promise<void> {
    saving.value = true;
    saved.value = false;
    saveFailure.value = null;
    refusedField.value = null;
    try {
        await billing.save(change.value);
        saved.value = true;
    } catch (error) {
        // Said on the card rather than thrown on: a click handler's rejection
        // reaches no caller, and the person needs to know nothing was saved.
        saveFailure.value = failureOf(error);
    } finally {
        saving.value = false;
    }
}

/** The field a refusal names, where the server named one of the fields shown here. */
function refusedFieldOf(error: unknown): TenantBillingContactField | null {
    if (!isAdminError(error) || httpStatusOf(error) !== 422) return null;
    const field = (error.body as { params?: { field?: unknown } } | undefined)?.params?.field;
    return CONTACT_FIELDS.find((known) => known === field) ?? null;
}

function failureOf(error: unknown): string {
    const field = refusedFieldOf(error);
    if (!field) return i18n.value.billingDetailsSaveFailed;
    refusedField.value = field;
    return messageParts(i18n.value.billingDetailsFieldInvalid, { field: labelOf(field) })
        .map((part) => part.text)
        .join('');
}

function emptyDraft(): Record<TenantBillingContactField, string> {
    return draftOf(null);
}

function draftOf(
    details: TenantBillingDetailsShape | null,
): Record<TenantBillingContactField, string> {
    const draft = {} as Record<TenantBillingContactField, string>;
    for (const field of CONTACT_FIELDS) draft[field] = details?.[field] ?? '';
    return draft;
}
</script>

<style scoped>
.sp-billing-details__title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    line-height: var(--sa-leading-md);
    margin: 0 0 var(--sa-space-3);
}
.sp-billing-details__identity {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--sa-space-2) var(--sa-space-4);
    margin: 0;
}
.sp-billing-details__row {
    display: contents;
}
.sp-billing-details__row dt {
    color: var(--sa-color-fg-secondary);
}
.sp-billing-details__row dd {
    margin: 0;
    color: var(--sa-color-fg-body);
    overflow-wrap: anywhere;
}
.sp-billing-details__sub,
.sp-billing-details__hint {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
.sp-billing-details__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--sa-space-4);
    margin-top: var(--sa-space-5);
}
.sp-billing-details__field {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
    min-width: 0;
}
.sp-billing-details__label {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.sp-billing-details__input {
    padding: var(--sa-space-3);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-field);
    font-family: inherit;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
    background: var(--sa-color-bg-surface);
    min-width: 0;
}
.sp-billing-details__input:focus-visible {
    outline: 2px solid var(--sa-color-accent);
    outline-offset: 1px;
}
.sp-billing-details__input[aria-invalid='true'] {
    border-color: var(--sa-color-negative-border);
}
.sp-billing-details__error {
    margin: var(--sa-space-3) 0 0;
    color: var(--sa-color-negative-fg);
}
.sp-billing-details__saved {
    margin: var(--sa-space-3) 0 0;
    color: var(--sa-color-positive-fg);
}
.sp-billing-details__actions {
    margin-top: var(--sa-space-4);
}
</style>
