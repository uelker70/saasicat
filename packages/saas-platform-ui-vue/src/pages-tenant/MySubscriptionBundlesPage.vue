<template>
    <div class="msb">
        <header class="msb-head">
            <div>
                <h2 class="msb-title">Meine Bundles</h2>
                <p class="msb-sub">
                    Eigenständig gebuchte Add-On-Pakete zu deinem Plan. Mindestlaufzeit +
                    Kündigungs- Termin pro Bundle.
                </p>
            </div>
            <button class="msb-btn msb-btn--primary" type="button" @click="openAddDialog">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Bundle buchen</span>
            </button>
        </header>

        <div v-if="error" class="msb-error" role="alert">
            <strong>Fehler:</strong> {{ error.message }}
        </div>

        <div v-if="loading && bundles.length === 0" class="msb-loading">Lade …</div>

        <div v-else-if="bundles.length === 0" class="msb-empty">
            Du hast noch kein Bundle gebucht. Über
            <button type="button" class="msb-empty-link" @click="openAddDialog">
                Bundle buchen
            </button>
            kannst du dein Paket um zusätzliche Features &amp; Quotas erweitern.
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
                            Gebucht seit {{ formatDate(b.startedAt) }}
                            <template v-if="b.minimumTermEndsAt">
                                · Mindestlaufzeit bis {{ formatDate(b.minimumTermEndsAt) }}
                            </template>
                        </div>
                    </div>
                    <button
                        v-if="b.canceledAt === null"
                        class="msb-btn msb-btn--ghost"
                        type="button"
                        :disabled="cancellingId === b.id"
                        @click="onCancel(b)"
                    >
                        {{ cancellingId === b.id ? 'Kündige …' : 'Kündigen' }}
                    </button>
                </header>
                <div v-if="b.canceledAt !== null" class="msb-cancel-info">
                    Gekündigt am {{ formatDate(b.canceledAt) }} · läuft bis
                    <strong>{{ formatDate(b.canceledEffectiveAt) }}</strong>
                </div>
            </article>
        </div>

        <!-- Add-Dialog: nutzt Public-Catalog-Bundles, wenn der Wrapper sie liefert. -->
        <div v-if="addOpen" class="msb-modal-bg" @click="closeAddDialog">
            <div class="msb-modal" @click.stop>
                <div class="msb-modal-head">
                    <div class="msb-modal-title">Bundle buchen</div>
                    <button
                        class="msb-modal-x"
                        type="button"
                        aria-label="Schließen"
                        @click="closeAddDialog"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="msb-modal-body">
                    <!-- Auswahl-Liste via Public-Catalog, sonst Fallback auf direkten UUID-Input. -->
                    <template v-if="bookable.length > 0">
                        <label class="msb-field">
                            <span class="msb-field-label">Bundle</span>
                            <select v-model="addForm.bundleVersionId" class="msb-input">
                                <option value="">— bitte wählen —</option>
                                <option
                                    v-for="b in bookable"
                                    :key="b.bundleVersionId"
                                    :value="b.bundleVersionId"
                                >
                                    {{ b.label }} ({{ b.bundleKey }})
                                    <template v-if="b.monthlyNet !== null">
                                        — {{ b.monthlyNet }} € / Mo
                                    </template>
                                </option>
                            </select>
                            <span v-if="hiddenBecauseIncompatible > 0" class="msb-field-hint">
                                {{ hiddenBecauseIncompatible }} weitere Bundle(s) ausgeblendet —
                                nicht kompatibel mit Plan <code>{{ currentPlanKey }}</code
                                >.
                            </span>
                        </label>
                    </template>
                    <template v-else>
                        <label class="msb-field">
                            <span class="msb-field-label">BundleVersion-ID</span>
                            <input
                                v-model="addForm.bundleVersionId"
                                class="msb-input"
                                placeholder="UUID der gewünschten Bundle-Version"
                            />
                            <span class="msb-field-hint">
                                Aus dem öffentlichen Marketing-Catalog. Konsument kann
                                <code>availableBundles</code>
                                als Prop reichen, dann erscheint hier ein Dropdown.
                            </span>
                        </label>
                    </template>
                    <label class="msb-field">
                        <span class="msb-field-label">Mindestlaufzeit (Monate, optional)</span>
                        <input
                            v-model.number="addForm.minimumTermMonths"
                            type="number"
                            min="0"
                            max="120"
                            class="msb-input"
                            placeholder="Default: 12"
                        />
                    </label>
                    <div v-if="addError" class="msb-error">{{ addError }}</div>
                </div>
                <div class="msb-modal-foot">
                    <button class="msb-btn" type="button" @click="closeAddDialog">Abbrechen</button>
                    <button
                        class="msb-btn msb-btn--primary"
                        type="button"
                        :disabled="!canSubmit || adding"
                        @click="submitAdd"
                    >
                        {{ adding ? 'Buche …' : 'Bundle buchen' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { SubscriptionBundleRecord } from '@saasicat/types';

import { useTenantSubscriptionBundles } from '../use-tenant-subscription-bundles.js';

// MySubscriptionBundlesPage — Tenant-Self-Service-Seite „Meine Bundles".
// Hostende App (vereinsfux/tenant, autohauspro/admin-tenant) bindet die Page
// per Route ein und reicht den `billingEndpoint` durch. Composable ruft
// `/billing/subscription-bundles`. Die Bundle-Label-Auflösung kommt
// vom Konsumenten (Optional via `bundleLabels`-Prop) — sonst zeigen wir
// die `bundleVersionId` an.

interface BookableBundle {
    bundleKey: string;
    label: string;
    bundleVersionId: string;
    monthlyNet: number | null;
    description?: string;
    /** Plan-Keys, mit denen das Bundle kompatibel ist. Leer = universell. */
    compatiblePlanKeys: string[];
}

const props = withDefaults(
    defineProps<{
        billingEndpoint: string;
        /**
         * Mapping `bundleVersionId → BundleKey/Label` (Konsument kann das
         * aus dem Public-Catalog vorladen). Ohne Mapping zeigen wir die
         * bundleVersionId als Fallback.
         */
        bundleLabels?: Record<string, { bundleKey: string; label?: string }>;
        /**
         * Buchbare Bundles für den Add-Dialog — kommen vom Konsumenten aus
         * `PublicMarketingCatalogResponse.bundles`. Leer = Page zeigt den
         * UUID-Fallback-Input.
         */
        availableBundles?: BookableBundle[];
        /**
         * Aktueller Plan-Key des Tenants — für die Plan-Kompat-Vorauswahl
         * im Dropdown. Wenn nicht gesetzt: keine Filterung.
         */
        currentPlanKey?: string | null;
        /** Optional: Auth-Token-Provider (für Bearer-Header). */
        getAuthToken?: () => string | null;
    }>(),
    {
        bundleLabels: () => ({}),
        availableBundles: () => [],
        currentPlanKey: null,
        getAuthToken: undefined,
    },
);

const { bundles, loading, error, load, add, cancel } = useTenantSubscriptionBundles({
    billingEndpoint: props.billingEndpoint,
    getAuthToken: props.getAuthToken,
});

onMounted(() => load());

// ─── Add-Dialog ─────────────────────────────────────────────
const addOpen = ref(false);
const adding = ref(false);
const addError = ref<string | null>(null);
const addForm = reactive<{ bundleVersionId: string; minimumTermMonths: number | null }>({
    bundleVersionId: '',
    minimumTermMonths: null,
});

const canSubmit = computed(() => addForm.bundleVersionId.trim().length > 0);

/**
 * Filtert `availableBundles` auf jene, die mit dem aktuellen Plan
 * kompatibel sind. Leeres `compatiblePlanKeys` = universell.
 * Bereits gebuchte Bundles (gleiche `bundleVersionId`, nicht gekündigt)
 * werden ausgeblendet — Idempotenz-Schutz ergänzend zum Backend.
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

/** Auto-Label-Lookup aus availableBundles (zusätzlich zum bundleLabels-Prop). */
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
    const ok = window.confirm(
        `Bundle wirklich kündigen? Die Kündigung wird zum nächstmöglichen Termin wirksam.`,
    );
    if (!ok) return;
    cancellingId.value = b.id;
    try {
        await cancel(b.id);
    } finally {
        cancellingId.value = null;
    }
}

// ─── Anzeige-Helper ─────────────────────────────────────────
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
    if (s === 'active') return 'Aktiv';
    if (s === 'canceled-pending') return 'Kündigung wirksam ab …';
    return 'Beendet';
}

function cardStatusClass(b: SubscriptionBundleRecord): string {
    return `msb-card--${statusOf(b)}`;
}

function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
</script>

<style scoped>
.msb {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-family:
        'Inter',
        -apple-system,
        BlinkMacSystemFont,
        system-ui,
        sans-serif;
    color: #0f172a;
}
.msb-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
}
.msb-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.msb-sub {
    margin: 4px 0 0;
    color: #64748b;
    font-size: 13px;
    max-width: 580px;
    line-height: 1.5;
}
.msb-loading {
    padding: 32px;
    text-align: center;
    color: #64748b;
}
.msb-empty {
    padding: 32px 24px;
    text-align: center;
    background: #fff;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    color: #475569;
}
.msb-empty-link {
    background: transparent;
    border: 0;
    color: #2563eb;
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
}
.msb-error {
    padding: 10px 14px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    font-size: 13px;
}
.msb-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.msb-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 18px;
}
.msb-card--canceled-pending {
    border-color: #fde68a;
    background: #fffbeb;
}
.msb-card--canceled {
    opacity: 0.65;
}
.msb-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}
.msb-card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.msb-card-key {
    font:
        700 13px 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: 0.04em;
}
.msb-card-meta {
    margin-top: 4px;
    font-size: 12.5px;
    color: #64748b;
}
.msb-chip {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 8px;
    border-radius: 999px;
}
.msb-chip--active {
    background: #d1fae5;
    color: #065f46;
}
.msb-chip--canceled-pending {
    background: #fef3c7;
    color: #92400e;
}
.msb-chip--canceled {
    background: #e2e8f0;
    color: #475569;
}
.msb-cancel-info {
    margin-top: 10px;
    padding: 8px 12px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    color: #92400e;
    font-size: 12.5px;
}

.msb-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    color: #0f172a;
}
.msb-btn:hover:not(:disabled) {
    background: #f8fafc;
}
.msb-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
.msb-btn--primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
}
.msb-btn--primary:hover:not(:disabled) {
    background: #1d4ed8;
}
.msb-btn--ghost {
    background: transparent;
    border-color: #fca5a5;
    color: #b91c1c;
}
.msb-btn--ghost:hover:not(:disabled) {
    background: #fef2f2;
}

.msb-modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: grid;
    place-items: center;
    z-index: 1000;
}
.msb-modal {
    width: min(520px, 96vw);
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
    display: flex;
    flex-direction: column;
}
.msb-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 10px;
    border-bottom: 1px solid #e2e8f0;
}
.msb-modal-title {
    font-size: 16px;
    font-weight: 700;
}
.msb-modal-x {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: #64748b;
    padding: 4px;
    border-radius: 4px;
}
.msb-modal-x:hover {
    background: #f1f5f9;
    color: #0f172a;
}
.msb-modal-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.msb-modal-foot {
    padding: 12px 20px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 0 0 12px 12px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.msb-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.msb-field-label {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
}
.msb-field-hint {
    font-size: 11px;
    color: #94a3b8;
}
.msb-input {
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-family: inherit;
    font-size: 13px;
    color: #0f172a;
    background: #fff;
}
</style>
