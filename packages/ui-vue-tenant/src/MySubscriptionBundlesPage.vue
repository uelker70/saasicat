<template>
    <div class="msb">
        <header class="msb-head">
            <div>
                <h2 class="msb-title">{{ effectiveI18n.myBundlesTitle }}</h2>
                <p class="msb-sub">{{ effectiveI18n.myBundlesSubtitle }}</p>
            </div>
            <TenantButton variant="solid" tone="accent" @click="openAddDialog">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{{ effectiveI18n.bundleBookAction }}</span>
            </TenantButton>
        </header>

        <div v-if="error" class="msb-error" role="alert">
            <strong>{{ effectiveI18n.errorLabel }}:</strong> {{ error.message }}
        </div>

        <div v-if="loading && bundles.length === 0" class="msb-loading">
            {{ effectiveI18n.loading }}
        </div>

        <div v-else-if="bundles.length === 0" class="msb-empty">
            {{ effectiveI18n.myBundlesEmptyPrefix }}
            <TenantButton variant="quiet" tone="accent" @click="openAddDialog">
                {{ effectiveI18n.bundleBookAction }}
            </TenantButton>
            {{ effectiveI18n.myBundlesEmptySuffix }}
        </div>

        <div v-else class="msb-list">
            <article v-for="b in bundles" :key="b.id" class="msb-card" :class="cardStatusClass(b)">
                <header class="msb-card-head">
                    <div>
                        <div class="msb-card-title">
                            <span class="msb-card-key">{{ resolveBundleKey(b) }}</span>
                            <span class="msb-chip" :class="`msb-chip--${statusOf(b)}`">
                                {{ statusLabel(b) }}
                            </span>
                        </div>
                        <div class="msb-card-meta">
                            {{ effectiveI18n.myBundlesBookedSince }} {{ formatDate(b.startedAt) }}
                            <template v-if="b.minimumTermEndsAt">
                                · {{ effectiveI18n.bundleMinimumTermUntil }}
                                {{ formatDate(b.minimumTermEndsAt) }}
                            </template>
                        </div>
                    </div>
                    <TenantButton
                        v-if="b.canceledAt === null"
                        tone="danger"
                        :loading="cancellingId === b.id"
                        @click="onCancel(b)"
                    >
                        {{
                            cancellingId === b.id
                                ? effectiveI18n.myBundlesCancelInProgress
                                : effectiveI18n.bundleCancelAction
                        }}
                    </TenantButton>
                </header>
                <div v-if="b.canceledAt !== null" class="msb-cancel-info">
                    {{ effectiveI18n.myBundlesCanceledAt }} {{ formatDate(b.canceledAt) }} ·
                    {{ effectiveI18n.myBundlesRunsUntil }}
                    <strong>{{ formatDate(b.canceledEffectiveAt) }}</strong>
                </div>
            </article>
        </div>

        <!-- Add dialog: uses public catalog bundles when the wrapper provides them. -->
        <TenantDialog
            v-model="addOpen"
            :title="effectiveI18n.bundleBookAction"
            :close-label="effectiveI18n.wizardClose"
            size="md"
        >
            <div class="msb-dialog-form">
                <!-- Selection list via public catalog, otherwise fallback to direct UUID input. -->
                <template v-if="bookable.length > 0">
                    <label class="msb-field">
                        <span class="msb-field-label">
                            {{ effectiveI18n.myBundlesAddBundleLabel }}
                        </span>
                        <select v-model="addForm.bundleVersionId" class="msb-input">
                            <option value="">
                                {{ effectiveI18n.myBundlesAddSelectPlaceholder }}
                            </option>
                            <option
                                v-for="b in bookable"
                                :key="b.bundleVersionId"
                                :value="b.bundleVersionId"
                            >
                                {{ b.label }} ({{ b.bundleKey }})
                                <template v-if="b.monthlyNet !== null">
                                    — {{ b.monthlyNet }}
                                    {{ effectiveI18n.myBundlesPricePerMonthShort }}
                                </template>
                            </option>
                        </select>
                        <span v-if="hiddenBecauseIncompatible > 0" class="msb-field-hint">
                            {{ hiddenBecauseIncompatible }}
                            {{ effectiveI18n.myBundlesHiddenIncompatible }}
                            <code>{{ currentPlanKey }}</code
                            >.
                        </span>
                    </label>
                </template>
                <template v-else>
                    <label class="msb-field">
                        <span class="msb-field-label">
                            {{ effectiveI18n.myBundlesBundleVersionIdLabel }}
                        </span>
                        <input
                            v-model="addForm.bundleVersionId"
                            class="msb-input"
                            :placeholder="effectiveI18n.myBundlesBundleVersionIdPlaceholder"
                        />
                        <!-- Integration hint for the embedding app, not for tenants. -->
                        <span class="msb-field-hint">
                            From the public marketing catalog. Pass
                            <code>availableBundles</code>
                            as a prop to get a dropdown here.
                        </span>
                    </label>
                </template>
                <label class="msb-field">
                    <span class="msb-field-label">
                        {{ effectiveI18n.myBundlesMinimumTermLabel }}
                    </span>
                    <input
                        v-model.number="addForm.minimumTermMonths"
                        type="number"
                        min="0"
                        max="120"
                        class="msb-input"
                        :placeholder="effectiveI18n.myBundlesMinimumTermPlaceholder"
                    />
                </label>
                <div v-if="addError" class="msb-error">{{ addError }}</div>
            </div>

            <template #footer>
                <TenantButton @click="closeAddDialog">
                    {{ effectiveI18n.bundlePreviewClose }}
                </TenantButton>
                <TenantButton
                    variant="solid"
                    tone="accent"
                    :loading="adding"
                    :disabled="!canSubmit"
                    @click="submitAdd"
                >
                    {{
                        adding
                            ? effectiveI18n.myBundlesBookInProgress
                            : effectiveI18n.bundleBookAction
                    }}
                </TenantButton>
            </template>
        </TenantDialog>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { SubscriptionBundleRecord } from '@saasicat/core';
import type { HttpClient } from '@saasicat/ui-vue';

import { useSuperAdminI18n } from '@saasicat/ui-vue';
import { useTenantSubscriptionBundles } from '@saasicat/ui-vue';
import { defaultTenantPlanSectionI18n, type TenantPlanSectionI18n } from './default-i18n.js';
import TenantButton from './ui/TenantButton.vue';
import TenantDialog from './ui/TenantDialog.vue';

// MySubscriptionBundlesPage — tenant self-service page "Meine Bundles".
// The hosting app embeds the page
// via route and passes the `billingEndpoint` through. The composable calls
// `/billing/subscription-bundles`. The bundle label resolution comes
// from the consumer (optional via the `bundleLabels` prop) — otherwise we
// show the `bundleVersionId`.

interface BookableBundle {
    bundleKey: string;
    label: string;
    bundleVersionId: string;
    monthlyNet: number | null;
    description?: string;
    /** Plan keys the bundle is compatible with. Empty = universal. */
    compatiblePlanKeys: string[];
}

const props = withDefaults(
    defineProps<{
        billingEndpoint: string;
        /**
         * App-specific HTTP adapter, as every other tenant-facing component
         * takes. Without it this page fell through to `defaultHttpClient()`,
         * so an app using axios with an auth interceptor got a bare `fetch()`
         * here and nowhere else — and no fixture could reach it either.
         */
        http?: HttpClient;
        /**
         * Mapping `bundleVersionId → BundleKey/Label` (the consumer can
         * preload this from the public catalog). Without a mapping we show the
         * bundleVersionId as a fallback.
         */
        bundleLabels?: Record<string, { bundleKey: string; label?: string }>;
        /**
         * Bookable bundles for the add dialog — come from the consumer via
         * `PublicMarketingCatalogResponse.bundles`. Empty = the page shows the
         * UUID fallback input.
         */
        availableBundles?: BookableBundle[];
        /**
         * Current plan key of the tenant — for the plan-compat preselection
         * in the dropdown. If not set: no filtering.
         */
        currentPlanKey?: string | null;
        /** i18n overrides — missing keys fall back to the active locale's map. */
        i18n?: Partial<TenantPlanSectionI18n>;
    }>(),
    {
        bundleLabels: () => ({}),
        availableBundles: () => [],
        currentPlanKey: null,
    },
);

const { locale, intlLocale } = useSuperAdminI18n();

const effectiveI18n = computed<TenantPlanSectionI18n>(() => ({
    ...defaultTenantPlanSectionI18n(locale.value),
    ...(props.i18n ?? {}),
}));

const { bundles, loading, error, load, add, cancel } = useTenantSubscriptionBundles({
    billingEndpoint: props.billingEndpoint,
    http: props.http,
});

onMounted(() => load());

// ─── Add dialog ─────────────────────────────────────────────
const addOpen = ref(false);
const adding = ref(false);
const addError = ref<string | null>(null);
const addForm = reactive<{ bundleVersionId: string; minimumTermMonths: number | null }>({
    bundleVersionId: '',
    minimumTermMonths: null,
});

const canSubmit = computed(() => addForm.bundleVersionId.trim().length > 0);

/**
 * Filters `availableBundles` down to those compatible with the current
 * plan. Empty `compatiblePlanKeys` = universal.
 * Already-booked bundles (same `bundleVersionId`, not canceled) are
 * hidden — idempotency protection complementing the backend.
 */
const bookable = computed<BookableBundle[]>(() => {
    const bookedActive = new Set(
        bundles.value.filter((b) => b.canceledAt === null).map((b) => b.bundleVersionId),
    );
    return props.availableBundles.filter((b) => {
        if (bookedActive.has(b.bundleVersionId)) return false;
        if (b.compatiblePlanKeys.length === 0) return true;
        if (!props.currentPlanKey) return true;
        return b.compatiblePlanKeys.includes(props.currentPlanKey);
    });
});

const hiddenBecauseIncompatible = computed(() => {
    if (!props.currentPlanKey) return 0;
    return props.availableBundles.filter(
        (b) =>
            b.compatiblePlanKeys.length > 0 &&
            !b.compatiblePlanKeys.includes(props.currentPlanKey!),
    ).length;
});

/** Auto label lookup from availableBundles (in addition to the bundleLabels prop). */
const labelsMap = computed<Record<string, { bundleKey: string; label?: string }>>(() => {
    const merged: Record<string, { bundleKey: string; label?: string }> = {
        ...props.bundleLabels,
    };
    for (const b of props.availableBundles) {
        if (!merged[b.bundleVersionId]) {
            merged[b.bundleVersionId] = { bundleKey: b.bundleKey, label: b.label };
        }
    }
    return merged;
});

function openAddDialog(): void {
    addForm.bundleVersionId = '';
    addForm.minimumTermMonths = null;
    addError.value = null;
    addOpen.value = true;
}

function closeAddDialog(): void {
    addOpen.value = false;
}

async function submitAdd(): Promise<void> {
    if (!canSubmit.value || adding.value) return;
    adding.value = true;
    addError.value = null;
    try {
        await add({
            bundleVersionId: addForm.bundleVersionId.trim(),
            minimumTermMonths:
                addForm.minimumTermMonths === null ? undefined : addForm.minimumTermMonths,
        });
        addOpen.value = false;
    } catch (err) {
        addError.value = err instanceof Error ? err.message : String(err);
    } finally {
        adding.value = false;
    }
}

// ─── Cancel ─────────────────────────────────────────────────
const cancellingId = ref<string | null>(null);

async function onCancel(b: SubscriptionBundleRecord): Promise<void> {
    const ok = window.confirm(effectiveI18n.value.myBundlesCancelConfirm);
    if (!ok) return;
    cancellingId.value = b.id;
    try {
        await cancel(b.id);
    } finally {
        cancellingId.value = null;
    }
}

// ─── Display helpers ────────────────────────────────────────
function resolveBundleKey(b: SubscriptionBundleRecord): string {
    const meta = labelsMap.value[b.bundleVersionId];
    return meta?.label || meta?.bundleKey || b.bundleVersionId;
}

function statusOf(b: SubscriptionBundleRecord): 'active' | 'canceled-pending' | 'canceled' {
    if (b.canceledAt === null) return 'active';
    if (b.canceledEffectiveAt && b.canceledEffectiveAt.getTime() > Date.now()) {
        return 'canceled-pending';
    }
    return 'canceled';
}

function statusLabel(b: SubscriptionBundleRecord): string {
    const s = statusOf(b);
    if (s === 'active') return effectiveI18n.value.statusActive;
    if (s === 'canceled-pending') return effectiveI18n.value.myBundlesStatusCanceledPending;
    return effectiveI18n.value.myBundlesStatusEnded;
}

function cardStatusClass(b: SubscriptionBundleRecord): string {
    return `msb-card--${statusOf(b)}`;
}

function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(intlLocale.value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}
</script>

<style scoped>
.msb {
    padding: var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-5);
    font-family:
        'Inter',
        -apple-system,
        BlinkMacSystemFont,
        system-ui,
        sans-serif;
    color: var(--sa-color-fg-heading);
}
.msb-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--sa-space-5);
}
.msb-title {
    margin: 0;
    font-size: var(--sa-text-xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-normal);
}
.msb-sub {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-md);
    max-width: 580px;
    line-height: 1.5;
}
.msb-loading {
    padding: var(--sa-space-8);
    text-align: center;
    color: var(--sa-color-fg-muted);
}
.msb-empty {
    padding: var(--sa-space-8) var(--sa-space-7);
    text-align: center;
    background: var(--sa-color-bg-surface);
    border: 1px dashed var(--sa-color-border-strong);
    border-radius: var(--sa-radius-card);
    color: var(--sa-color-fg-secondary);
}
.msb-error {
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-negative-surface);
    border: 1px solid var(--sa-color-negative-border);
    border-radius: var(--sa-radius-field);
    color: var(--sa-color-negative-fg);
    font-size: var(--sa-text-md);
}
.msb-list {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.msb-card {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    padding: var(--sa-space-4) var(--sa-space-5);
}
.msb-card--canceled-pending {
    border-color: var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
}
.msb-card--canceled {
    opacity: 0.65;
}
.msb-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sa-space-4);
}
.msb-card-title {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.msb-card-key {
    font:
        700 var(--sa-text-md) 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: var(--sa-tracking-wide);
}
.msb-card-meta {
    margin-top: var(--sa-space-2);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-muted);
}
.msb-chip {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
}
.msb-chip--active {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
}
.msb-chip--canceled-pending {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.msb-chip--canceled {
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
}
.msb-cancel-info {
    margin-top: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-warning-surface);
    border: 1px solid var(--sa-color-warning-border);
    border-radius: var(--sa-radius-badge);
    color: var(--sa-color-warning-fg);
    font-size: var(--sa-text-md);
}

/* The dialog fields keep a column gap the shell's body cannot give them: the
 * body pads a block, and this one is a stack of three labelled controls. */
.msb-dialog-form {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-4);
}
.msb-field {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.msb-field-label {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.msb-field-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.msb-input {
    padding: var(--sa-space-3) var(--sa-space-3);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-badge);
    font-family: inherit;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
    background: var(--sa-color-bg-surface);
}
</style>
