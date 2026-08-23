<template>
    <!-- This block writes into the `form` prop, which both dialogs create as a
         `reactive()` object and hand down; the type is named
         `PromoCodeSharedForm` for exactly that reason. A deliberate shared-state
         contract, not an oversight.

         It is still the wrong shape: the field block cannot be reused with a
         one-way owner, and the two dialogs around it are 115 lines of clone.
         Both are replaced by `AdminFormDialog` + `AdminFieldGrid`, which own the
         submit lifecycle instead of sharing a mutable object. Until then the
         rule stays sharp everywhere else rather than being weakened repo-wide. -->
    <!-- Section: Code & Discount -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionCodeDiscount }}</div>
        <AdminFieldGrid>
            <AdminField
                :label="msg.form.codeLabel"
                :hint="mode === 'create' ? msg.form.codeHint : msg.form.codeStableHint"
            >
                <q-input
                    :model-value="code"
                    outlined
                    dense
                    class="pc-code"
                    :disable="mode !== 'create'"
                    :placeholder="mode === 'create' ? msg.form.codePlaceholder : undefined"
                    @update:model-value="onCodeInput"
                >
                    <template v-if="mode === 'create'" #after>
                        <q-btn
                            flat
                            dense
                            no-caps
                            :label="msg.form.codeRandom"
                            @click="onRandomCode"
                        />
                    </template>
                </q-input>
            </AdminField>

            <AdminField :label="msg.form.valueTypeLabel">
                <div class="pc-type-grid">
                    <button
                        v-for="o in typeOptions"
                        :key="o.k"
                        type="button"
                        class="pc-type-opt"
                        :class="{ 'pc-type-opt--active': form.valueType === o.k }"
                        @click="form.valueType = o.k"
                    >
                        <div class="pc-type-opt__label">{{ o.label }}</div>
                        <div class="pc-type-opt__sub">{{ o.sub }}</div>
                    </button>
                </div>
            </AdminField>
        </AdminFieldGrid>

        <AdminField
            class="pc-field--narrow"
            :label="
                form.valueType === 'PERCENT'
                    ? msg.form.valuePercentLabel
                    : msg.form.valueAbsoluteLabel
            "
        >
            <q-input
                v-model.number="form.value"
                outlined
                dense
                type="number"
                min="1"
                :max="form.valueType === 'PERCENT' ? 100 : undefined"
            />
        </AdminField>
    </div>

    <!-- Section: Validity & Duration -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionValidity }}</div>

        <AdminField
            v-if="plans.length > 0"
            :label="msg.form.plansLabel"
            :hint="formatMessage(msg.form.plansHint, { count: form.appliesToPlans.length })"
        >
            <div class="pc-plan-pick">
                <button
                    v-for="p in plans"
                    :key="p.key"
                    type="button"
                    class="pc-plan-opt"
                    :class="{ 'pc-plan-opt--on': isPlanSelected(p.key) }"
                    :style="planChipStyle(p)"
                    @click="togglePlan(p.key)"
                >
                    <span
                        class="pc-plan-opt__mark"
                        :style="{ background: p.color ?? IDENTITY_NEUTRAL }"
                    />
                    {{ p.label }}
                </button>
            </div>
        </AdminField>

        <AdminFieldGrid>
            <AdminField :label="msg.form.durationLabel">
                <div class="pc-seg pc-seg--fill">
                    <q-btn
                        v-for="o in durationOptions"
                        :key="o.k"
                        class="pc-seg-opt"
                        flat
                        dense
                        no-caps
                        :label="o.label"
                        :class="{ 'pc-seg-opt--active': form.durationType === o.k }"
                        @click="form.durationType = o.k"
                    />
                </div>
                <q-input
                    v-if="form.durationType !== 'ONCE'"
                    v-model.number="form.durationValue"
                    outlined
                    dense
                    type="number"
                    min="1"
                    class="pc-duration-value"
                    :placeholder="
                        form.durationType === 'MONTHS'
                            ? msg.form.durationMonthsPlaceholder
                            : msg.form.durationCyclesPlaceholder
                    "
                />
            </AdminField>

            <AdminField
                :label="msg.form.maxRedemptionsLabel"
                :hint="
                    mode === 'create'
                        ? msg.form.maxRedemptionsHintCreate
                        : msg.form.maxRedemptionsHintEdit
                "
            >
                <q-input
                    v-model.number="form.maxRedemptions"
                    outlined
                    dense
                    type="number"
                    min="1"
                    :placeholder="msg.form.maxRedemptionsPlaceholder"
                />
            </AdminField>
        </AdminFieldGrid>

        <AdminFieldGrid>
            <AdminField :label="msg.form.validFromLabel">
                <q-input v-model="form.validFrom" outlined dense type="date" />
            </AdminField>
            <AdminField :label="msg.form.validUntilLabel">
                <q-input v-model="form.validUntil" outlined dense type="date" />
            </AdminField>
        </AdminFieldGrid>

        <AdminFieldGrid v-if="mode === 'edit'">
            <AdminField :label="common.status" :hint="msg.form.statusHint">
                <div class="pc-seg pc-status">
                    <button
                        v-for="o in statusOptions"
                        :key="o.k"
                        type="button"
                        class="pc-seg-opt"
                        :class="{ 'pc-seg-opt--active': form.status === o.k }"
                        @click="form.status = o.k"
                    >
                        <q-icon :name="o.icon" size="14px" />
                        {{ o.label }}
                    </button>
                </div>
            </AdminField>
        </AdminFieldGrid>
    </div>

    <!-- Section: Campaign & Note -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionCampaign }}</div>
        <AdminField
            v-if="showCampaignTag"
            :label="msg.form.campaignLabel"
            :hint="msg.form.campaignHint"
        >
            <q-input
                v-model="form.campaignTag"
                outlined
                dense
                :placeholder="msg.form.campaignPlaceholder"
            />
        </AdminField>
        <AdminField :label="msg.form.noteLabel">
            <q-input
                v-model="form.description"
                outlined
                dense
                type="textarea"
                :rows="2"
                :placeholder="msg.form.notePlaceholder"
            />
        </AdminField>
    </div>

    <!-- Section: Advanced (backend-only fields, collapsed).

         An `AdminAccordion` rather than a fourth `.pc-section`: this is the one
         section of the four that opens, and the package has one way of saying
         that. It reads as `bg-surface` where its three siblings are
         `bg-surface-raised` — the section that behaves differently is the one
         that looks different, and the radius is the same rung either way. -->
    <AdminAccordion v-model:open="advancedOpen">
        <template #header>
            <span class="pc-section__title pc-section__title--inline">
                {{ msg.form.advancedToggle }}
            </span>
        </template>
        <div class="pc-advanced">
            <AdminFieldGrid>
                <AdminField :label="msg.form.billingCycleLabel">
                    <q-select
                        v-model="form.appliesToBilling"
                        outlined
                        dense
                        emit-value
                        map-options
                        :options="billingCycleOptions"
                    />
                </AdminField>
                <AdminField :label="msg.form.minAmountLabel">
                    <q-input
                        v-model.number="form.minimumPlanAmountGross"
                        outlined
                        dense
                        type="number"
                        min="0"
                        :placeholder="msg.form.minAmountPlaceholder"
                    />
                </AdminField>
            </AdminFieldGrid>
            <AdminFieldGrid>
                <q-checkbox
                    v-model="form.firstTimeCustomersOnly"
                    dense
                    :label="msg.form.firstTimeOnly"
                />
                <q-checkbox
                    v-model="form.allowZeroInvoice"
                    dense
                    :label="msg.form.allowZeroInvoice"
                />
            </AdminFieldGrid>
            <AdminField :label="msg.form.revenueAccountLabel">
                <q-input
                    v-model="form.revenueDeductionAccount"
                    outlined
                    dense
                    :placeholder="msg.form.revenueAccountPlaceholder"
                />
            </AdminField>
        </div>
    </AdminAccordion>

    <!-- Live preview -->
    <div class="pc-preview">
        <div class="pc-preview__eyebrow">{{ msg.form.previewEyebrow }}</div>
        <div class="pc-preview__body">
            <code class="pc-preview__code">{{ code || 'CODE' }}</code>
            <span class="pc-preview__disc">{{ previewValue }}</span>
            <span class="pc-preview__meta">{{ previewMeta }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import AdminField from '../../ui/page/AdminField.vue';
import AdminFieldGrid from '../../ui/page/AdminFieldGrid.vue';
import { IDENTITY_NEUTRAL, identityChipStyle } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { PromoCodeDurationType, PromoCodePlanOption, PromoCodeValueType } from './types.js';

// The form body shared by both promo-code dialogs.
//
// Create and edit show the same sections and differ in a handful of
// enumerable points: the code is only editable on create, the status only on
// edit, two hint texts swap, and an empty billing cycle is `undefined` on
// create (omit the field) but `null` on edit (clear the field). Hence a `mode`
// rather than slots: slot content carries the parent's scope, so the shared
// `.pc-*` rules would never reach it.
//
// This component is internal to the two dialogs and not part of the public
// surface.

/** The fields both dialogs share. `status` exists on edit only. */
export interface PromoCodeSharedForm {
    valueType: PromoCodeValueType;
    value: number;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    maxRedemptions: number | null;
    validFrom: string;
    validUntil: string;
    appliesToPlans: string[];
    appliesToBilling?: 'MONTHLY' | 'YEARLY' | null;
    firstTimeCustomersOnly: boolean;
    minimumPlanAmountGross: number | null;
    allowZeroInvoice: boolean;
    campaignTag: string;
    revenueDeductionAccount: string;
    description: string;
    status?: 'ACTIVE' | 'PAUSED';
}

/**
 * The form this component edits.
 *
 * A model, not a prop: the fields write into it on every keystroke, and a prop
 * that is written to is what `vue/no-mutating-props` exists to catch. The two
 * `eslint-disable` blocks this replaces were the last ones in the package —
 * they had been there since the file was a shared mutable object passed down
 * from whichever dialog happened to own it.
 *
 * `defineModel` keeps the parent in charge of the value while letting the
 * fields write to it directly, so nothing here has to emit twenty-one times.
 */
const form = defineModel<PromoCodeSharedForm>('form', { required: true });

const props = withDefaults(
    defineProps<{
        mode: 'create' | 'edit';
        /** Editable on create, display-only on edit. */
        code: string;
        showCampaignTag?: boolean;
        plans?: readonly PromoCodePlanOption[];
    }>(),
    { showCampaignTag: true, plans: () => [] },
);

const emit = defineEmits<{ (e: 'update:code', v: string): void }>();

const msg = useSaMessages('promos');
const common = useSaMessages('common');

const typeOptions = computed<ReadonlyArray<{ k: PromoCodeValueType; label: string; sub: string }>>(
    () => [
        {
            k: 'PERCENT',
            label: msg.value.form.valueTypePercent,
            sub: msg.value.form.valueTypePercentSub,
        },
        {
            k: 'ABSOLUTE',
            label: msg.value.form.valueTypeAbsolute,
            sub: msg.value.form.valueTypeAbsoluteSub,
        },
    ],
);

const durationOptions = computed<ReadonlyArray<{ k: PromoCodeDurationType; label: string }>>(() => [
    { k: 'ONCE', label: msg.value.form.durationOnce },
    { k: 'MONTHS', label: msg.value.form.durationMonths },
    { k: 'BILLING_CYCLES', label: msg.value.form.durationBillingCycles },
]);

/**
 * `undefined` on create and `null` on edit both mean "either cycle".
 *
 * The two are not interchangeable here: create omits the field from the payload
 * and edit clears it, which is the distinction the hand-written `<option>` also
 * carried.
 */
const billingCycleOptions = computed(() => [
    { value: props.mode === 'create' ? undefined : null, label: common.value.both },
    { value: 'MONTHLY', label: common.value.monthly },
    { value: 'YEARLY', label: common.value.yearly },
]);

const statusOptions = computed<
    ReadonlyArray<{ k: 'ACTIVE' | 'PAUSED'; label: string; icon: string }>
>(() => [
    { k: 'ACTIVE', label: common.value.active, icon: 'play_arrow' },
    { k: 'PAUSED', label: msg.value.form.statusPaused, icon: 'pause' },
]);

/**
 * The code round-trips through the caller so its form stays the source of truth.
 *
 * `q-input` hands over the value rather than the event, which is also why the
 * field is bound one-way: the normalisation below has to run between what was
 * typed and what is shown, and `v-model` would show the raw keystroke first.
 */
function onCodeInput(value: string | number | null): void {
    const raw = String(value ?? '');
    emit('update:code', raw.toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
}

function onRandomCode(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    emit('update:code', s);
}

function isPlanSelected(key: string): boolean {
    return form.value.appliesToPlans.includes(key);
}

function togglePlan(key: string): void {
    // Same shared-`form` contract as the template above (see the comment there).
    if (form.value.appliesToPlans.includes(key)) {
        form.value.appliesToPlans = form.value.appliesToPlans.filter((k) => k !== key);
    } else {
        form.value.appliesToPlans = [...form.value.appliesToPlans, key];
    }
}

function planChipStyle(p: PromoCodePlanOption): Record<string, string> {
    if (!isPlanSelected(p.key) || !p.color) return {};
    return { ...identityChipStyle(p.color), borderColor: p.color };
}

const previewValue = computed(() => {
    if (form.value.valueType === 'PERCENT') return `\u2212${form.value.value || 0}%`;
    return `\u2212${form.value.value || 0} \u20ac`;
});

const previewMeta = computed(() => {
    const parts: string[] = [];
    const count = form.value.durationValue || 0;
    if (form.value.durationType === 'ONCE') parts.push(msg.value.form.previewOnce);
    else if (form.value.durationType === 'MONTHS')
        parts.push(formatMessage(msg.value.form.previewMonths, { count }));
    else parts.push(formatMessage(msg.value.form.previewCycles, { count }));
    parts.push(
        form.value.appliesToPlans.length > 0
            ? form.value.appliesToPlans.join(', ')
            : props.plans.length > 0
              ? msg.value.form.previewAllPlans
              : msg.value.form.previewNoPlanFilter,
    );
    if (form.value.maxRedemptions)
        parts.push(formatMessage(msg.value.form.previewMax, { count: form.value.maxRedemptions }));
    return parts.join(' \u00b7 ');
});

const advancedOpen = defineModel<boolean>('advancedOpen', { default: false });
</script>

<style scoped>
.pc-section {
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-4) var(--sa-space-5);
    background: var(--sa-color-bg-surface-raised);
}

.pc-section__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
    margin-bottom: var(--sa-space-4);
    letter-spacing: var(--sa-tracking-normal);
}

/* The same title, in a header that already spaces itself. */
.pc-section__title--inline {
    margin-bottom: 0;
}

.pc-advanced {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-4);
}

.pc-field {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}

/* The generator sits in the field's `after` slot; without this it reads as a
 * second field rather than as part of the one it belongs to. */
.pc-code :deep(.q-field__after) {
    padding-left: var(--sa-space-2);
}

/* A count, not a measurement — the field would otherwise stretch to the grid. */
.pc-duration-value,
.pc-field--narrow {
    max-width: 280px;
}

.pc-type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sa-space-2);
}

.pc-type-opt {
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-3);
    text-align: left;
    cursor: pointer;
    transition:
        border-color 0.1s,
        background 0.1s;
}

.pc-type-opt:hover {
    border-color: var(--sa-color-border-strong);
}

.pc-type-opt--active {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface);
}

.pc-type-opt__label {
    font: 600 var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-color-fg-heading);
}

.pc-type-opt__sub {
    font: var(--sa-text-sm) var(--sa-font-mono, ui-monospace, monospace);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-0);
}

.pc-plan-pick {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
}

.pc-plan-opt {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-pill);
    padding: var(--sa-space-2) var(--sa-space-4) var(--sa-space-2) var(--sa-space-3);
    font: 600 var(--sa-text-sm) var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-color-fg-secondary);
    transition:
        border-color 0.1s,
        background 0.1s;
}

.pc-plan-opt:hover {
    border-color: var(--sa-color-border-strong);
}

.pc-plan-opt--on {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
}

.pc-plan-opt__mark {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

/* One segmented control for both the duration and the status row. They are the
 * same thing — a row of buttons of which one is chosen — and the status row had
 * NO rules at all, so it rendered as raw browser buttons: white boxes on a dark
 * dialog. Sharing the recipe is what makes the two look alike without either
 * restating it. */
.pc-seg {
    display: flex;
    gap: var(--sa-space-2);
}
/* The duration options divide the row; the status options size to their label. */
.pc-seg--fill .pc-seg-opt {
    flex: 1;
}

.pc-seg-opt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sa-gap-inline);
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-control);
    padding: var(--sa-space-2) var(--sa-space-3);
    font: 500 var(--sa-text-sm) var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-color-fg-secondary);
}

.pc-seg-opt:hover {
    border-color: var(--sa-color-border-strong);
}

/* `-accent-strong` on `-surface-strong`, which is what the design guide
 * prescribes for accent text on a tint. The chosen option used to pair plain
 * `--sa-color-accent` with the 8 % wash of itself: in dark mode that is the
 * brand blue on a near-black blue, and the selected state was the one you could
 * read least — the opposite of what selecting something should do. */
.pc-seg-opt--active {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
}

.pc-preview {
    background: var(--sa-color-accent-surface-soft);
    border: 1px solid var(--sa-color-accent-border);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-4) var(--sa-space-4);
}

.pc-preview__eyebrow {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    color: var(--sa-color-accent);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    margin-bottom: var(--sa-space-2);
}

.pc-preview__body {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}

.pc-preview__code {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-1) var(--sa-space-3);
    font: 600 var(--sa-text-md) var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: var(--sa-tracking-wide);
    color: var(--sa-color-fg-heading);
}

.pc-preview__disc {
    font: 700 var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-color-positive-fg);
}

.pc-preview__meta {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
}
</style>
