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
    <!-- eslint-disable vue/no-mutating-props -->
    <!-- Section: Code & Discount -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionCodeDiscount }}</div>
        <div class="pc-grid pc-grid--2">
            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.codeLabel }}</div>
                <div v-if="mode === 'create'" class="pc-code-input">
                    <input
                        :value="code"
                        class="pc-input pc-input--code"
                        :placeholder="msg.form.codePlaceholder"
                        @input="onCodeInput"
                    />
                    <button type="button" class="pc-btn-mini" @click="onRandomCode">
                        {{ msg.form.codeRandom }}
                    </button>
                </div>
                <input v-else :value="code" class="pc-input pc-input--code" disabled />
                <div class="pc-field__hint">
                    {{ mode === 'create' ? msg.form.codeHint : msg.form.codeStableHint }}
                </div>
            </div>

            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.valueTypeLabel }}</div>
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
            </div>
        </div>

        <div class="pc-field" style="max-width: 280px">
            <div class="pc-field__label">
                {{
                    form.valueType === 'PERCENT'
                        ? msg.form.valuePercentLabel
                        : msg.form.valueAbsoluteLabel
                }}
            </div>
            <input
                v-model.number="form.value"
                class="pc-input"
                type="number"
                min="1"
                :max="form.valueType === 'PERCENT' ? 100 : undefined"
            />
        </div>
    </div>

    <!-- Section: Validity & Duration -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionValidity }}</div>

        <div v-if="plans.length > 0" class="pc-field">
            <div class="pc-field__label">{{ msg.form.plansLabel }}</div>
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
                    <span class="pc-plan-opt__mark" :style="{ background: p.color ?? '#64748b' }" />
                    {{ p.label }}
                </button>
            </div>
            <div class="pc-field__hint">
                {{
                    formatMessage(msg.form.plansHint, {
                        count: form.appliesToPlans.length,
                    })
                }}
            </div>
        </div>

        <div class="pc-grid pc-grid--2">
            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.durationLabel }}</div>
                <div class="pc-seg pc-seg--fill">
                    <button
                        v-for="o in durationOptions"
                        :key="o.k"
                        type="button"
                        class="pc-seg-opt"
                        :class="{ 'pc-seg-opt--active': form.durationType === o.k }"
                        @click="form.durationType = o.k"
                    >
                        {{ o.label }}
                    </button>
                </div>
                <input
                    v-if="form.durationType !== 'ONCE'"
                    v-model.number="form.durationValue"
                    class="pc-input"
                    type="number"
                    min="1"
                    style="margin-top: 8px; max-width: 120px"
                    :placeholder="
                        form.durationType === 'MONTHS'
                            ? msg.form.durationMonthsPlaceholder
                            : msg.form.durationCyclesPlaceholder
                    "
                />
            </div>

            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.maxRedemptionsLabel }}</div>
                <input
                    v-model.number="form.maxRedemptions"
                    class="pc-input"
                    type="number"
                    min="1"
                    :placeholder="msg.form.maxRedemptionsPlaceholder"
                />
                <div class="pc-field__hint">
                    {{
                        mode === 'create'
                            ? msg.form.maxRedemptionsHintCreate
                            : msg.form.maxRedemptionsHintEdit
                    }}
                </div>
            </div>
        </div>

        <div class="pc-grid pc-grid--2">
            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.validFromLabel }}</div>
                <input v-model="form.validFrom" class="pc-input" type="date" />
            </div>
            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.validUntilLabel }}</div>
                <input v-model="form.validUntil" class="pc-input" type="date" />
            </div>
        </div>

        <div v-if="mode === 'edit'" class="pc-grid pc-grid--2">
            <div class="pc-field">
                <div class="pc-field__label">{{ common.status }}</div>
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
                <div class="pc-field__hint">{{ msg.form.statusHint }}</div>
            </div>
        </div>
    </div>

    <!-- Section: Campaign & Note -->
    <div class="pc-section">
        <div class="pc-section__title">{{ msg.form.sectionCampaign }}</div>
        <div v-if="showCampaignTag" class="pc-field">
            <div class="pc-field__label">{{ msg.form.campaignLabel }}</div>
            <input
                v-model="form.campaignTag"
                class="pc-input"
                :placeholder="msg.form.campaignPlaceholder"
            />
            <div class="pc-field__hint">{{ msg.form.campaignHint }}</div>
        </div>
        <div class="pc-field">
            <div class="pc-field__label">{{ msg.form.noteLabel }}</div>
            <textarea
                v-model="form.description"
                class="pc-input"
                rows="2"
                :placeholder="msg.form.notePlaceholder"
            />
        </div>
    </div>

    <!-- Section: Advanced (backend-only fields, collapsed) -->
    <div class="pc-section">
        <button type="button" class="pc-section__toggle" @click="advancedOpen = !advancedOpen">
            <q-icon :name="advancedOpen ? 'expand_more' : 'chevron_right'" size="16px" />
            {{ msg.form.advancedToggle }}
        </button>
        <div v-if="advancedOpen" class="pc-advanced">
            <div class="pc-grid pc-grid--2">
                <div class="pc-field">
                    <div class="pc-field__label">{{ msg.form.billingCycleLabel }}</div>
                    <select v-model="form.appliesToBilling" class="pc-input">
                        <option :value="mode === 'create' ? undefined : null">
                            {{ common.both }}
                        </option>
                        <option value="MONTHLY">{{ common.monthly }}</option>
                        <option value="YEARLY">{{ common.yearly }}</option>
                    </select>
                </div>
                <div class="pc-field">
                    <div class="pc-field__label">{{ msg.form.minAmountLabel }}</div>
                    <input
                        v-model.number="form.minimumPlanAmountGross"
                        class="pc-input"
                        type="number"
                        min="0"
                        :placeholder="msg.form.minAmountPlaceholder"
                    />
                </div>
            </div>
            <div class="pc-grid pc-grid--2">
                <label class="pc-check">
                    <input v-model="form.firstTimeCustomersOnly" type="checkbox" />
                    <span>{{ msg.form.firstTimeOnly }}</span>
                </label>
                <label class="pc-check">
                    <input v-model="form.allowZeroInvoice" type="checkbox" />
                    <span>{{ msg.form.allowZeroInvoice }}</span>
                </label>
            </div>
            <div class="pc-field">
                <div class="pc-field__label">{{ msg.form.revenueAccountLabel }}</div>
                <input
                    v-model="form.revenueDeductionAccount"
                    class="pc-input"
                    :placeholder="msg.form.revenueAccountPlaceholder"
                />
            </div>
        </div>
    </div>

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
import { identityChipStyle } from '../../client/identity-accents.js';
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

const props = withDefaults(
    defineProps<{
        mode: 'create' | 'edit';
        form: PromoCodeSharedForm;
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

const statusOptions = computed<
    ReadonlyArray<{ k: 'ACTIVE' | 'PAUSED'; label: string; icon: string }>
>(() => [
    { k: 'ACTIVE', label: common.value.active, icon: 'play_arrow' },
    { k: 'PAUSED', label: msg.value.form.statusPaused, icon: 'pause' },
]);

/** The code round-trips through the caller so its form stays the source of truth. */
function onCodeInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    emit('update:code', raw.toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
}

function onRandomCode(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    emit('update:code', s);
}

function isPlanSelected(key: string): boolean {
    return props.form.appliesToPlans.includes(key);
}

function togglePlan(key: string): void {
    // Same shared-`form` contract as the template above (see the comment there).
    /* eslint-disable vue/no-mutating-props */
    if (props.form.appliesToPlans.includes(key)) {
        props.form.appliesToPlans = props.form.appliesToPlans.filter((k) => k !== key);
    } else {
        props.form.appliesToPlans = [...props.form.appliesToPlans, key];
    }
    /* eslint-enable vue/no-mutating-props */
}

function planChipStyle(p: PromoCodePlanOption): Record<string, string> {
    if (!isPlanSelected(p.key) || !p.color) return {};
    return { ...identityChipStyle(p.color), borderColor: p.color };
}

const previewValue = computed(() => {
    if (props.form.valueType === 'PERCENT') return `\u2212${props.form.value || 0}%`;
    return `\u2212${props.form.value || 0} \u20ac`;
});

const previewMeta = computed(() => {
    const parts: string[] = [];
    const count = props.form.durationValue || 0;
    if (props.form.durationType === 'ONCE') parts.push(msg.value.form.previewOnce);
    else if (props.form.durationType === 'MONTHS')
        parts.push(formatMessage(msg.value.form.previewMonths, { count }));
    else parts.push(formatMessage(msg.value.form.previewCycles, { count }));
    parts.push(
        props.form.appliesToPlans.length > 0
            ? props.form.appliesToPlans.join(', ')
            : props.plans.length > 0
              ? msg.value.form.previewAllPlans
              : msg.value.form.previewNoPlanFilter,
    );
    if (props.form.maxRedemptions)
        parts.push(formatMessage(msg.value.form.previewMax, { count: props.form.maxRedemptions }));
    return parts.join(' \u00b7 ');
});

const advancedOpen = defineModel<boolean>('advancedOpen', { default: false });
</script>

<style scoped>
.pc-section {
    border: 1px solid var(--sa-color-border);
    border-radius: 10px;
    padding: 14px 16px;
    background: var(--sa-color-bg-surface-raised);
}

.pc-section__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
    margin-bottom: 12px;
    letter-spacing: -0.005em;
}

.pc-section__toggle {
    border: 0;
    background: transparent;
    cursor: pointer;
    font: 600 var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-color-fg-secondary);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
}

.pc-advanced {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
}

.pc-grid {
    display: grid;
    gap: 12px;
    margin-bottom: 12px;
}

.pc-grid--2 {
    grid-template-columns: 1fr 1fr;
}

@media (max-width: 599.98px) {
    .pc-grid--2 {
        grid-template-columns: 1fr;
    }
}

.pc-grid:last-child {
    margin-bottom: 0;
}

.pc-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.pc-field__label {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.pc-field__hint {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
}

.pc-input {
    width: 100%;
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: 7px;
    padding: 8px 10px;
    font: var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-color-fg-body);
    outline: 0;
}

.pc-input:focus {
    border-color: var(--sa-color-accent);
    box-shadow: 0 0 0 3px var(--sa-shadow-tint-3);
}

.pc-input--code {
    font: 600 var(--sa-text-lg) var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

textarea.pc-input {
    font: var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    resize: vertical;
}

.pc-code-input {
    display: flex;
    gap: 8px;
    align-items: center;
}

.pc-btn-mini {
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 var(--sa-text-sm) var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-color-fg-secondary);
}

.pc-btn-mini:hover {
    background: var(--sa-color-border-soft);
}

.pc-type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}

.pc-type-opt {
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: 8px;
    padding: 8px 10px;
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
    margin-top: 1px;
}

.pc-plan-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.pc-plan-opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: 999px;
    padding: 5px 12px 5px 8px;
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
    gap: 4px;
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
    border-radius: 7px;
    padding: 6px 10px;
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

.pc-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: var(--sa-text-md) var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-color-fg-body);
    cursor: pointer;
}

.pc-preview {
    background: var(--sa-color-accent-surface-soft);
    border: 1px solid var(--sa-color-accent-border);
    border-radius: 10px;
    padding: 12px 14px;
}

.pc-preview__eyebrow {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    color: var(--sa-color-accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
}

.pc-preview__body {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.pc-preview__code {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: 6px;
    padding: 3px 8px;
    font: 600 var(--sa-text-md) var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
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
