<template>
    <div class="pve">
        <PlanVersionEditorHeader
            :plan-key="planKey"
            :editing-id="editingId"
            :version="form.version"
            :predecessor-valid-until-hint="predecessorValidUntilHint"
            :has-predecessor="!!predecessorVersion"
            :can-save="canSave"
            @show-diff="showDiff = true"
            @cancel="emit('cancel')"
            @save="emitSave"
        />

        <!-- Save error banner (e.g. "Plan hat bereits eine Draft-Version") -->
        <div v-if="saveError" class="pve-error" role="alert">
            <span class="pve-error-ico" aria-hidden="true">
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    />
                    <path d="M12 9v4M12 17h.01" />
                </svg>
            </span>
            <span>{{ saveError }}</span>
        </div>

        <!-- 3-Col Body -->
        <div class="pve-body">
            <PlanComponentPool
                v-model:search-term="searchTerm"
                v-model:active-tab="activeTab"
                :pool-tabs="poolTabs"
                :filtered-feature-groups="filteredFeatureGroups"
                :filtered-quotas="filteredQuotas"
                :filtered-bundles="filteredBundles"
                :feature-label="featureLabel"
                :feature-group-label="featureGroupLabel"
                :is-feature-on="isFeatureOn"
                :is-quota-on="isQuotaOn"
                :is-bundle-fully-on="isBundleFullyOn"
                :is-bundle-partially-on="isBundlePartiallyOn"
                @toggle-feature="toggleFeature"
                @pool-quota-click="onPoolQuotaClick"
                @toggle-bundle="toggleBundle"
                @drag-start="onDragStart"
                @drag-end="onDragEnd"
            />

            <PlanVersionBasket
                :form="form"
                :drag-over="dragOver"
                :change-count="changeCount"
                :min-valid-from="minValidFrom"
                :valid-from-error="validFromError"
                :selected-quota-list="selectedQuotaList"
                :sorted-selected-features="sortedSelectedFeatures"
                :active-bundles="activeBundles"
                :feature-label="featureLabel"
                @update:valid-from="onValidFromInput($event)"
                @update:valid-until="form.validUntil = $event"
                @update:monthly-net="form.monthlyNet = $event"
                @update:yearly-net="form.yearlyNet = $event"
                @update:marketed="form.marketed = $event"
                @update:change-note="form.changeNote = $event"
                @set-quota-value="setQuotaValue"
                @toggle-quota="toggleQuota"
                @toggle-feature="toggleFeature"
                @toggle-bundle="toggleBundle"
                @drag-over="onDragOver"
                @drag-leave="onDragLeave"
                @drop="onDrop"
            />

            <PlanCatalogPreview
                v-model:preview-mode="previewMode"
                :catalog-url="catalogUrl"
                :plan-key="planKey"
                :version="form.version"
                :change-note="form.changeNote"
                :quotas="form.quotas"
                :plan-display-name="planDisplayName"
                :formatted-monthly="formattedMonthly"
                :formatted-yearly="formattedYearly"
                :yearly-savings-label="yearlySavingsLabel"
                :selected-quota-list="selectedQuotaList"
                :sorted-selected-features="sortedSelectedFeatures"
                :checklist="checklist"
                :checklist-ok-count="checklistOkCount"
                :feature-label="featureLabel"
            />
        </div>

        <PlanVersionDiffDialog
            v-model="showDiff"
            :predecessor-version="predecessorVersion"
            :version="form.version"
            :diff-rows="diffRows"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import PlanComponentPool from './PlanComponentPool.vue';
import PlanCatalogPreview from './PlanCatalogPreview.vue';
import PlanVersionBasket from './PlanVersionBasket.vue';
import PlanVersionDiffDialog from './PlanVersionDiffDialog.vue';
import PlanVersionEditorHeader from './PlanVersionEditorHeader.vue';
import type {
    BundleEntry,
    ChecklistItem,
    DiscoveryFeature,
    DiscoveryQuota,
    DraftForm,
    EditorDiffRow,
    FeatureGroup,
    FeatureMeta,
    PlanVersionSavePayload,
    PoolKind,
    PoolTab,
    PoolTabItem,
    PredecessorVersion,
    PreviewMode,
    SelectedQuotaRow,
} from './types.js';

// PlanVersionEditor — V2 splitview editor: library pool → plan basket → live
// public catalog preview. Single screen for "create plan + version +
// assign". Drag-and-drop from the left pool into the middle basket;
// on the right the public catalog preview runs live with the form state.
//
// Data sources:
//  - Quotas + features: from the discovery snapshot (code = SoT). Passed
//    through by the consumer via `availableFeatures`/`availableQuotas`.
//  - Bundles: from the DB table bundles (live published). Passed through by
//    the consumer via `availableBundles`.
//  - Feature label + optional group bucket: from `featureRegistry`.
//
// Bundle switch semantics: ON activates all of the bundle's features
// (set union with form.features); OFF removes them again
// (set difference). A bundle counts as "ON" when ALL of its features are
// active in the plan, "PARTIAL" for some.

const props = withDefaults(
    defineProps<{
        planKey: string;
        editingId: string | null;
        initialForm: DraftForm;
        saving: boolean;
        availableFeatures: DiscoveryFeature[];
        availableQuotas: DiscoveryQuota[];
        availableBundles: BundleEntry[];
        featureRegistry?: Record<string, FeatureMeta>;
        /** Display name of the plan for the live preview (default: planKey). */
        planDisplayName?: string;
        /** URL of the public catalog for the browser-chrome display. */
        catalogUrl?: string;
        /** Estimated number of affected Tenants — shown in the publish checklist. */
        tenantImpactCount?: number;
        /** Error message from the last save attempt (e.g. "Plan hat bereits eine Draft"). */
        saveError?: string | null;
        /**
         * Predecessor version (currently live) that "Diff vs. Vorgänger"
         * compares against. `null` for v1 — the button is then disabled.
         */
        predecessorVersion?: PredecessorVersion | null;
    }>(),
    {
        planDisplayName: undefined,
        catalogUrl: 'app.local/preise',
        tenantImpactCount: 0,
        saveError: null,
        predecessorVersion: null,
    },
);

const emit = defineEmits<{
    (e: 'save', payload: PlanVersionSavePayload): void;
    (e: 'cancel'): void;
}>();

const msg = useSaMessages('planEditor');
const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

const form = reactive<DraftForm>({
    version: props.initialForm.version,
    features: [...props.initialForm.features],
    quotas: { ...props.initialForm.quotas },
    monthlyNet: props.initialForm.monthlyNet,
    yearlyNet: props.initialForm.yearlyNet,
    changeNote: props.initialForm.changeNote,
    marketed: props.initialForm.marketed,
    validFrom: props.initialForm.validFrom,
    validUntil: props.initialForm.validUntil,
});

// initialForm snapshot for change counting. The editor is a fullscreen
// page that the consumer mounts via `v-if` — on every mount, form +
// baseline are freshly populated from `initialForm`. No modelValue watch needed.
const baseline: DraftForm = cloneForm(props.initialForm);

onMounted(() => {
    searchTerm.value = '';
    activeTab.value = 'features';
    // Always prefill "Gültig ab": if missing (e.g. legacy data without a start date)
    // → default start date; if before the predecessor → first permitted day.
    if (!form.validFrom || form.validFrom.slice(0, 10) <= prevValidFromDay.value) {
        form.validFrom = defaultValidFrom.value;
    }
});

// "Gültig ab" day of the predecessor version (YYYY-MM-DD) or '' if none.
const prevValidFromDay = computed(() =>
    props.predecessorVersion?.validFrom ? props.predecessorVersion.validFrom.slice(0, 10) : '',
);

function cloneForm(f: DraftForm): DraftForm {
    return {
        version: f.version,
        features: [...f.features],
        quotas: { ...f.quotas },
        monthlyNet: f.monthlyNet,
        yearlyNet: f.yearlyNet,
        changeNote: f.changeNote,
        marketed: f.marketed,
        validFrom: f.validFrom,
        validUntil: f.validUntil,
    };
}

// ── Pool: search + tabs + grouping ──────────────────────────────────
const searchTerm = ref('');
const activeTab = ref<PoolTab>('features');

const poolTabs = computed<PoolTabItem[]>(() => [
    {
        id: 'features' as PoolTab,
        label: msg.value.sections.features,
        count: filteredFeatureCount.value,
    },
    {
        id: 'quotas' as PoolTab,
        label: msg.value.sections.quotas,
        count: filteredQuotas.value.length,
    },
    {
        id: 'bundles' as PoolTab,
        label: msg.value.sections.bundles,
        count: filteredBundles.value.length,
    },
]);

function normalize(s: string): string {
    return s.toLocaleLowerCase(intlLocale.value);
}

function matchesSearch(haystack: string[], needle: string): boolean {
    if (!needle) return true;
    const n = normalize(needle);
    return haystack.some((h) => normalize(h).includes(n));
}

function featureLabel(key: string): string {
    return props.featureRegistry?.[key]?.label ?? key;
}

function featureGroupLabel(key: string): string {
    return props.featureRegistry?.[key]?.group ?? common.value.general;
}

// Pool lists sorted by display label (not by key/snapshot order),
// so that planning stays predictable — same order as in the basket.
const byLabel = (a: string, b: string) => a.localeCompare(b, intlLocale.value);

const filteredFeatures = computed(() =>
    props.availableFeatures
        .filter((f) => matchesSearch([f.featureKey, featureLabel(f.featureKey)], searchTerm.value))
        .sort((a, b) => byLabel(featureLabel(a.featureKey), featureLabel(b.featureKey))),
);

const filteredFeatureCount = computed(() => filteredFeatures.value.length);

const filteredFeatureGroups = computed<FeatureGroup[]>(() => {
    const byGroup = new Map<string, DiscoveryFeature[]>();
    for (const f of filteredFeatures.value) {
        const g = featureGroupLabel(f.featureKey);
        const list = byGroup.get(g) ?? [];
        list.push(f);
        byGroup.set(g, list);
    }
    return [...byGroup.entries()]
        .sort(([a], [b]) => byLabel(a, b))
        .map(([key, rows]) => ({ key, label: key, rows }));
});

const filteredQuotas = computed(() =>
    props.availableQuotas
        .filter((q) => matchesSearch([q.quotaKey, q.label ?? '', q.unit ?? ''], searchTerm.value))
        .sort((a, b) => byLabel(a.label || a.quotaKey, b.label || b.quotaKey)),
);

const filteredBundles = computed(() =>
    props.availableBundles
        .filter((b) => matchesSearch([b.bundleKey, b.label ?? ''], searchTerm.value))
        .sort((a, b) => byLabel(a.label || a.bundleKey, b.label || b.bundleKey)),
);

// ── Selection logic ─────────────────────────────────────────────────
function isFeatureOn(key: string): boolean {
    return form.features.includes(key);
}

function toggleFeature(key: string, on: boolean): void {
    if (on && !form.features.includes(key)) {
        form.features.push(key);
        form.features.sort();
    } else if (!on) {
        const idx = form.features.indexOf(key);
        if (idx >= 0) form.features.splice(idx, 1);
    }
}

function isQuotaOn(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(form.quotas, key);
}

function toggleQuota(key: string, on: boolean): void {
    if (on) {
        if (!Object.prototype.hasOwnProperty.call(form.quotas, key)) {
            form.quotas[key] = 0;
        }
    } else {
        delete form.quotas[key];
    }
}

function setQuotaValue(key: string, value: number): void {
    form.quotas[key] = Number.isFinite(value) ? value : 0;
}

function onPoolQuotaClick(q: DiscoveryQuota): void {
    toggleQuota(q.quotaKey, !isQuotaOn(q.quotaKey));
}

function isBundleFullyOn(b: BundleEntry): boolean {
    if (b.features.length === 0) return false;
    return b.features.every((f) => form.features.includes(f));
}

function isBundlePartiallyOn(b: BundleEntry): boolean {
    if (isBundleFullyOn(b)) return false;
    return b.features.some((f) => form.features.includes(f));
}

function toggleBundle(b: BundleEntry, on: boolean): void {
    if (on) {
        for (const f of b.features) {
            if (!form.features.includes(f)) form.features.push(f);
        }
    } else {
        for (const f of b.features) {
            const idx = form.features.indexOf(f);
            if (idx >= 0) form.features.splice(idx, 1);
        }
    }
    form.features.sort();
}

// ── Selected lists for the basket (sorted by display label) ─────────
const sortedSelectedFeatures = computed(() =>
    [...form.features].sort((a, b) => byLabel(featureLabel(a), featureLabel(b))),
);

const selectedQuotaList = computed<SelectedQuotaRow[]>(() => {
    return Object.keys(form.quotas)
        .map((quotaKey) => {
            const def = props.availableQuotas.find((q) => q.quotaKey === quotaKey);
            return {
                quotaKey,
                label: def?.label || quotaKey,
                unit: def?.unit || '',
                sub: def?.unit || quotaKey,
            };
        })
        .sort((a, b) => byLabel(a.label, b.label));
});

const activeBundles = computed(() => props.availableBundles.filter(isBundleFullyOn));

// ── Change count (against baseline) ─────────────────────────────────
const changeCount = computed(() => {
    let n = 0;
    const addedF = form.features.filter((f) => !baseline.features.includes(f));
    const removedF = baseline.features.filter((f) => !form.features.includes(f));
    n += addedF.length + removedF.length;
    const addedQ = Object.keys(form.quotas).filter((q) => !(q in baseline.quotas));
    const removedQ = Object.keys(baseline.quotas).filter((q) => !(q in form.quotas));
    const changedQ = Object.keys(form.quotas).filter(
        (q) => q in baseline.quotas && baseline.quotas[q] !== form.quotas[q],
    );
    n += addedQ.length + removedQ.length + changedQ.length;
    if (form.monthlyNet !== baseline.monthlyNet) n++;
    if (form.yearlyNet !== baseline.yearlyNet) n++;
    if (form.changeNote !== baseline.changeNote) n++;
    if (form.marketed !== baseline.marketed) n++;
    if (form.validFrom !== baseline.validFrom) n++;
    if (form.validUntil !== baseline.validUntil) n++;
    return n;
});

// ── Preview ─────────────────────────────────────────────────────────
const previewMode = ref<PreviewMode>('desktop');

const planDisplayName = computed(() => props.planDisplayName ?? toTitleCase(props.planKey));

function toTitleCase(s: string): string {
    if (!s) return s;
    return s.charAt(0) + s.slice(1).toLowerCase();
}

function formatMoney(raw: string): string {
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return raw + ' €';
    const num = Number(raw);
    return formatCurrency(num, locale.value);
}

const formattedMonthly = computed(() => formatMoney(form.monthlyNet));
const formattedYearly = computed(() => formatMoney(form.yearlyNet));

const yearlySavingsLabel = computed(() => {
    const m = Number(form.monthlyNet);
    const y = Number(form.yearlyNet);
    if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
    const fullYear = m * 12;
    if (y >= fullYear) return null;
    const pct = Math.round(((fullYear - y) / fullYear) * 100);
    if (pct <= 0) return null;
    return formatMessage(msg.value.editor.yearlySavings, { percent: pct });
});

// ── Validation ──────────────────────────────────────────────────────

// "Gültig ab" must be strictly after the "Gültig ab" of the predecessor
// version — otherwise the version timeline is wrong (SPEC_V2 §4.2.1).
// ISO date strings (YYYY-MM-DD) are lexicographically comparable.
const validFromError = computed<string | null>(() => {
    const prev = props.predecessorVersion;
    if (!prev?.validFrom || !form.validFrom) return null;
    const draftDay = form.validFrom.slice(0, 10);
    const prevDay = prev.validFrom.slice(0, 10);
    if (draftDay <= prevDay) {
        return formatMessage(msg.value.editor.validFromError, {
            draftDay,
            version: prev.version,
            prevDay,
        });
    }
    return null;
});

// First valid start day = day after the "Gültig ab" of the predecessor version.
// Bound as `min` to the date field → earlier days are greyed out in the
// native date picker.
const minValidFrom = computed<string | undefined>(() => {
    const prev = props.predecessorVersion;
    if (!prev?.validFrom) return undefined;
    const d = new Date(prev.validFrom.slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return undefined;
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
});

// Default start date when "Gültig ab" is missing or cleared: first
// permitted day (successor) or today (initial version). This keeps validFrom
// from ever being NULL — no new legacy-data gap (an invisible plan in the catalog) arises.
const defaultValidFrom = computed<string>(
    () => minValidFrom.value ?? new Date().toISOString().slice(0, 10),
);

// Clearing the date field falls back to the default instead of emitting NULL.
function onValidFromInput(value: string | null): void {
    form.validFrom = value || defaultValidFrom.value;
}

const canSave = computed(() => {
    return (
        /^\d+(\.\d{1,2})?$/.test(form.monthlyNet) &&
        /^\d+(\.\d{1,2})?$/.test(form.yearlyNet) &&
        validFromError.value === null
    );
});

const predecessorValidUntilHint = computed(() => {
    const fallback = msg.value.editor.validUntilHintFallback;
    if (!form.validFrom) return fallback;
    const d = new Date(form.validFrom);
    if (Number.isNaN(d.getTime())) return fallback;
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
});

const checklist = computed<ChecklistItem[]>(() => {
    const texts = msg.value.editor;
    const items: ChecklistItem[] = [
        {
            id: 'prices',
            label: texts.checklistPrices,
            ok:
                /^\d+(\.\d{1,2})?$/.test(form.monthlyNet) &&
                /^\d+(\.\d{1,2})?$/.test(form.yearlyNet),
        },
        {
            id: 'note',
            label: texts.checklistChangeNote,
            ok: form.changeNote.trim().length > 0,
        },
        {
            id: 'valid-from',
            label: texts.checklistValidity,
            ok: !!form.validFrom,
        },
        {
            id: 'valid-from-order',
            label: texts.checklistValidFromOrder,
            ok: validFromError.value === null,
        },
        {
            id: 'min-feature',
            label: texts.checklistMinFeature,
            ok: form.features.length > 0,
        },
    ];
    if (props.tenantImpactCount > 0) {
        items.push({
            id: 'tenant-impact',
            label: formatMessage(texts.checklistTenantImpact, {
                count: props.tenantImpactCount,
                version: form.version,
            }),
            ok: false,
        });
    }
    return items;
});

const checklistOkCount = computed(() => checklist.value.filter((c) => c.ok).length);

// ── Diff vs. predecessor ────────────────────────────────────────────
const showDiff = ref(false);

const DIFF_STYLE = {
    added: { bg: '#ecfdf5', border: '#a7f3d0', color: '#047857', sign: '+' },
    removed: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', sign: '−' },
    changed: { bg: '#fffbeb', border: '#fde68a', color: '#b45309', sign: '~' },
} as const;

const diffStyles = computed(() => ({
    added: { ...DIFF_STYLE.added, tag: msg.value.editor.diffTagAdded },
    removed: { ...DIFF_STYLE.removed, tag: msg.value.editor.diffTagRemoved },
    changed: { ...DIFF_STYLE.changed, tag: msg.value.editor.diffTagChanged },
}));

const diffRows = computed<EditorDiffRow[]>(() => {
    const prev = props.predecessorVersion;
    if (!prev) return [];
    const style = diffStyles.value;
    const sections = msg.value.sections;
    const out: EditorDiffRow[] = [];

    // Features
    const prevFeatures = new Set(prev.features);
    const curFeatures = new Set(form.features);
    for (const f of form.features) {
        if (!prevFeatures.has(f)) {
            out.push({
                id: `add-f-${f}`,
                section: sections.features,
                label: featureLabel(f),
                sub: f,
                ...style.added,
            });
        }
    }
    for (const f of prev.features) {
        if (!curFeatures.has(f)) {
            out.push({
                id: `rem-f-${f}`,
                section: sections.features,
                label: featureLabel(f),
                sub: f,
                ...style.removed,
            });
        }
    }

    // Quotas
    const prevQ = prev.quotas ?? {};
    const keys = new Set([...Object.keys(prevQ), ...Object.keys(form.quotas)]);
    for (const k of [...keys].sort()) {
        const before = prevQ[k];
        const after = form.quotas[k];
        const unit = props.availableQuotas.find((q) => q.quotaKey === k)?.unit ?? '';
        const label = props.availableQuotas.find((q) => q.quotaKey === k)?.label || k;
        const fmt = (v: number) => `${v}${unit ? ' ' + unit : ''}`;
        if (before === undefined && after !== undefined) {
            out.push({
                id: `add-q-${k}`,
                section: sections.quotas,
                label,
                sub: k,
                to: fmt(after),
                ...style.added,
            });
        } else if (before !== undefined && after === undefined) {
            out.push({
                id: `rem-q-${k}`,
                section: sections.quotas,
                label,
                sub: k,
                from: fmt(before),
                ...style.removed,
            });
        } else if (before !== undefined && after !== undefined && before !== after) {
            out.push({
                id: `chg-q-${k}`,
                section: sections.quotas,
                label,
                sub: k,
                from: fmt(before),
                to: fmt(after),
                ...style.changed,
            });
        }
    }

    // Price
    if (prev.monthlyNet !== form.monthlyNet || prev.yearlyNet !== form.yearlyNet) {
        const perMonth = msg.value.perMonthShort;
        const perYear = msg.value.perYearShort;
        out.push({
            id: 'chg-price',
            section: sections.price,
            label: msg.value.editor.diffPriceLabel,
            from: `${formatMoney(prev.monthlyNet)} ${perMonth} · ${formatMoney(prev.yearlyNet)} ${perYear}`,
            to: `${formattedMonthly.value} ${perMonth} · ${formattedYearly.value} ${perYear}`,
            ...style.changed,
        });
    }

    return out;
});

// ── Drag-and-drop from pool → basket ────────────────────────────────
const dragOver = ref(false);
let dragPayload: { kind: PoolKind; key: string } | null = null;

function onDragStart(kind: PoolKind, key: string, e: DragEvent): void {
    dragPayload = { kind, key };
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', `${kind}:${key}`);
    }
}

function onDragEnd(): void {
    dragPayload = null;
    dragOver.value = false;
}

function onDragOver(e: DragEvent): void {
    if (!dragPayload) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragOver.value = true;
}

function onDragLeave(e: DragEvent): void {
    // Only clear when leaving the basket entirely (not when entering nested children).
    if (e.currentTarget instanceof HTMLElement && e.relatedTarget instanceof Node) {
        if (e.currentTarget.contains(e.relatedTarget)) return;
    }
    dragOver.value = false;
}

function onDrop(): void {
    if (!dragPayload) {
        dragOver.value = false;
        return;
    }
    const { kind, key } = dragPayload;
    if (kind === 'feature') {
        toggleFeature(key, true);
    } else if (kind === 'quota') {
        toggleQuota(key, true);
    } else if (kind === 'bundle') {
        const b = props.availableBundles.find((x) => x.bundleKey === key);
        if (b) toggleBundle(b, true);
    }
    dragPayload = null;
    dragOver.value = false;
}

// ── Save ────────────────────────────────────────────────────────────
function emitSave(): void {
    if (!canSave.value || props.saving) return;
    emit('save', {
        version: form.version,
        features: [...form.features],
        // Persisted bundle selection = all fully active bundles. Derived from
        // the features so that `bundles` is always consistent with `features`
        // (SPEC_V2 §6.1 / PlanVersionRow.bundles).
        bundles: activeBundles.value.map((b) => b.bundleKey),
        quotas: { ...form.quotas },
        monthlyNet: form.monthlyNet,
        yearlyNet: form.yearlyNet,
        changeNote: form.changeNote,
        marketed: form.marketed,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
    });
}
</script>

<style>
.pve {
    --pve-nav-bg: #0b1929;
    --pve-bg: #f6f7f9;
    --pve-surface: #ffffff;
    --pve-surface-2: #f8fafc;
    --pve-border: #e5e7eb;
    --pve-border-strong: #d1d5db;
    --pve-text: #0f172a;
    --pve-text-2: #475569;
    --pve-text-3: #94a3b8;
    --pve-primary: #2563eb;
    --pve-primary-700: #1d4ed8;
    --pve-live: #10b981;
    --pve-draft: #f59e0b;
    --pve-draft-bg: #fffbeb;
    --pve-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --pve-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    display: flex;
    flex-direction: column;
    background: var(--pve-bg);
    color: var(--pve-text);
    font-family: var(--pve-font-sans);
    box-sizing: border-box;
    /* Fullscreen screen instead of a modal: fills the content area of the
       hosting AdminLayout page (topbar 56px subtracted). */
    height: 100%;
    min-height: calc(100vh - 56px);
}
.pve :deep(*) {
    box-sizing: border-box;
}

/* ── Editor bar ─────────────────────────────────────────────────── */
.pve-bar {
    background: #fff;
    border-bottom: 1px solid var(--pve-border);
    padding: 12px 22px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 0 0 auto;
}

/* ── Save error banner ──────────────────────────────────────────── */
.pve-error {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 22px;
    background: #fef2f2;
    border-bottom: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    font-weight: 500;
}
.pve-error-ico {
    display: inline-flex;
    flex: 0 0 auto;
}
.pve-bar-left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
}
.pve-bar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
}
.pve-titlechip {
    display: flex;
    align-items: center;
    gap: 6px;
}
.pve-titlechip-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #94a3b8;
}
.pve-title {
    font-size: 18px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
}
.pve-bar-note {
    font-size: 11.5px;
    color: #64748b;
}
.pve-mono {
    font: 500 11px var(--pve-font-mono);
}
.pve-mono--xs {
    font-size: 10px;
}

/* ── Buttons & Chips ───────────────────────────────────────────── */
.pve-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--pve-font-sans);
    cursor: pointer;
    border: 1px solid var(--pve-border-strong);
    background: #fff;
    color: var(--pve-text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pve-btn:hover {
    background: var(--pve-surface-2);
}
.pve-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.pve-btn--primary {
    background: var(--pve-primary);
    border-color: var(--pve-primary);
    color: #fff;
}
.pve-btn--primary:hover {
    background: var(--pve-primary-700);
}
.pve-btn--ghost {
    border-color: transparent;
    background: transparent;
}
.pve-btn--ghost:hover {
    background: rgba(15, 23, 42, 0.05);
}
.pve-btn--sm {
    padding: 5px 9px;
    font-size: 12px;
    gap: 5px;
}
.pve-ico {
    display: inline-flex;
}
.pve-ico--rot180 {
    transform: rotate(180deg);
}

.pve-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    background: var(--pve-surface-2);
    color: var(--pve-text-2);
    border: 1px solid var(--pve-border);
}
.pve-chip--plan {
    background: #dbeafe;
    color: #1e40af;
    border-color: #bfdbfe;
}
.pve-chip--draft {
    background: var(--pve-draft-bg);
    color: #b45309;
    border-color: #fde68a;
}
.pve-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}
.pve-chip--changes {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
}

.pve-kbd {
    font: 600 10.5px var(--pve-font-mono);
    background: #f1f5f9;
    color: #475569;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #e2e8f0;
}

/* ── Body Grid ──────────────────────────────────────────────────── */
.pve-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: 380px 1fr 400px;
    background: var(--pve-bg);
}

.pve-col {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--pve-border);
    background: #fff;
    min-width: 0;
    overflow: hidden;
}
.pve-col:last-child {
    border-right: 0;
}
.pve-col-header {
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--pve-border);
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex: 0 0 auto;
}
.pve-col-header--basket {
    padding: 16px 22px 12px;
}
.pve-col-header--preview {
    padding: 16px 18px 12px;
}
.pve-col-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.pve-col-sub {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
}

/* ── LEFT — Pool ───────────────────────────────────────────────── */
.pve-pool {
    background: #fbfbfd;
}
.pve-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    margin: 10px 14px 0;
    background: #fff;
    border: 1px solid var(--pve-border);
    border-radius: 8px;
}
.pve-search input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    font: 13px var(--pve-font-sans);
    color: #0f172a;
}
.pve-search-ico {
    color: #94a3b8;
    display: inline-flex;
}
.pve-tabs {
    display: flex;
    gap: 4px;
    padding: 12px 14px 6px;
}
.pve-tab {
    background: transparent;
    border: 0;
    padding: 5px 10px;
    border-radius: 6px;
    font: 500 12.5px var(--pve-font-sans);
    color: #475569;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
}
.pve-tab--active {
    background: #0f172a;
    color: #fff;
}
.pve-tab-count {
    font-size: 10.5px;
    padding: 1px 5px;
    border-radius: 4px;
    background: #e2e8f0;
    color: #475569;
}
.pve-tab--active .pve-tab-count {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}
.pve-pool-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 14px 18px;
}
.pve-pool-group {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #94a3b8;
    font-weight: 700;
    padding: 12px 4px 6px;
}
.pve-pool-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #fff;
    border: 1px solid var(--pve-border);
    border-radius: 8px;
    padding: 9px 10px;
    margin-bottom: 6px;
    cursor: grab;
    transition:
        box-shadow 0.12s,
        border-color 0.12s;
    user-select: none;
}
.pve-pool-card:hover {
    border-color: #c7d2fe;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.pve-pool-card:active {
    cursor: grabbing;
}
.pve-pool-card--selected {
    background: var(--pve-surface-2);
    opacity: 0.7;
}
.pve-pool-card--partial {
    border-color: #fde68a;
    background: #fffbeb;
}
.pve-pool-grip {
    color: #cbd5e1;
    padding-top: 3px;
    flex: 0 0 auto;
}
.pve-pool-card-main {
    flex: 1;
    min-width: 0;
}
.pve-pool-card-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.pve-pool-card-label {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
}
.pve-pool-card-check {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: #d1fae5;
    color: #047857;
    margin-left: auto;
}
.pve-pool-card-meta {
    display: flex;
    gap: 5px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 10.5px;
    color: #94a3b8;
    margin-top: 2px;
}
.pve-pool-card-key {
    font: 500 10px var(--pve-font-mono);
    color: #64748b;
}
.pve-pool-card-dot {
    color: #cbd5e1;
}

.pve-empty {
    padding: 24px 4px;
    text-align: center;
    color: #94a3b8;
    font-size: 12.5px;
    font-style: italic;
}

/* ── MIDDLE — Basket ───────────────────────────────────────────── */
.pve-basket {
    padding: 0;
    overflow: auto;
    transition:
        background 0.15s,
        box-shadow 0.15s;
}
.pve-basket--dragover {
    background: #f0f6ff;
    box-shadow: inset 0 0 0 2px var(--pve-primary);
}
.pve-basket-settings {
    background: linear-gradient(180deg, var(--pve-surface-2) 0%, #fff 100%);
    border-bottom: 1px solid var(--pve-border);
    padding: 14px 22px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pve-bs-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
.pve-bs-label {
    font-size: 12px;
    color: #475569;
    font-weight: 500;
    min-width: 88px;
}
.pve-bs-label--inline {
    min-width: 0;
    margin-left: 8px;
}
.pve-bs-input {
    background: #fff;
    border: 1px solid var(--pve-border);
    border-radius: 6px;
    padding: 6px 10px;
    font: 13px var(--pve-font-sans);
    color: #0f172a;
    outline: none;
}
.pve-bs-input:focus {
    border-color: var(--pve-primary);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
.pve-bs-input--error {
    border-color: #ef4444;
    background: #fef2f2;
}
.pve-bs-input--error:focus {
    border-color: #ef4444;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}
.pve-bs-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -2px 0 2px;
    font-size: 11.5px;
    font-weight: 500;
    color: #b91c1c;
}
.pve-bs-error svg {
    flex: 0 0 auto;
}
.pve-bs-input--grow {
    flex: 1;
    margin-left: 10px;
}
.pve-bs-input-grp {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--pve-border);
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
}
.pve-bs-input-grp--gap {
    margin-left: 6px;
}
.pve-bs-input--flush {
    border: 0 !important;
    border-radius: 0 !important;
    padding: 6px 8px !important;
    width: 90px;
}
.pve-bs-prefix,
.pve-bs-suffix {
    background: var(--pve-surface-2);
    padding: 6px 10px;
    font-size: 12px;
    color: #64748b;
    display: grid;
    place-items: center;
    border-right: 1px solid var(--pve-border);
}
.pve-bs-suffix {
    border-right: 0;
    border-left: 1px solid var(--pve-border);
}

.pve-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    display: inline-block;
    cursor: pointer;
}
.pve-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
}
.pve-toggle span {
    position: absolute;
    inset: 0;
    background: #cbd5e1;
    border-radius: 999px;
    transition: background 0.15s;
}
.pve-toggle span::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
}
.pve-toggle input:checked + span {
    background: var(--pve-primary);
}
.pve-toggle input:checked + span::before {
    transform: translateX(16px);
}

.pve-basket-group {
    padding: 14px 22px;
    border-bottom: 1px solid #f1f5f9;
}
.pve-basket-group:last-child {
    border-bottom: 0;
}
.pve-bg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.pve-bg-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.pve-bg-dot--quota {
    background: #0ea5e9;
}
.pve-bg-dot--feature {
    background: #8b5cf6;
}
.pve-bg-dot--bundle {
    background: #f59e0b;
}
.pve-bg-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    color: #334155;
}
.pve-bg-count {
    margin-left: 6px;
    font-size: 11px;
    color: #94a3b8;
}

.pve-dz {
    border: 1.5px dashed var(--pve-border-strong);
    border-radius: 10px;
    padding: 12px;
    background: #fafbfc;
    min-height: 60px;
}
.pve-basket--dragover .pve-dz {
    border-color: var(--pve-primary);
    background: #f0f6ff;
}
.pve-dz-empty {
    font-size: 12px;
    color: #94a3b8;
    text-align: center;
    padding: 4px 0;
}
.pve-dz-empty--center {
    padding: 8px 0;
}

.pve-sel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: #fff;
    border: 1px solid var(--pve-border);
    border-radius: 6px;
    margin-bottom: 4px;
}
.pve-sel-row:last-child {
    margin-bottom: 0;
}
.pve-sel-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: 0 0 auto;
}
.pve-sel-dot--quota {
    background: #0ea5e9;
}
.pve-sel-dot--feature {
    background: #8b5cf6;
}
.pve-sel-dot--bundle {
    background: #f59e0b;
}
.pve-sel-body {
    flex: 1;
    min-width: 0;
}
.pve-sel-label {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
}
.pve-sel-sub {
    font: 500 10.5px var(--pve-font-mono);
    color: #94a3b8;
}
.pve-sel-val-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--pve-surface-2);
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--pve-border);
}
.pve-sel-val-input {
    width: 64px;
    border: 0;
    outline: 0;
    background: transparent;
    font: 600 13px var(--pve-font-sans);
    color: #0f172a;
    text-align: right;
    -moz-appearance: textfield;
}
.pve-sel-val-input::-webkit-outer-spin-button,
.pve-sel-val-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.pve-sel-val-unit {
    font-size: 10.5px;
    color: #94a3b8;
}
.pve-sel-x {
    background: transparent;
    border: 0;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: grid;
    place-items: center;
}
.pve-sel-x:hover {
    background: #fef2f2;
    color: #ef4444;
}

/* ── RIGHT — Preview ───────────────────────────────────────────── */
.pve-preview {
    background: var(--pve-surface-2);
    overflow: auto;
}
.pve-preview-toggle {
    display: flex;
    gap: 4px;
    margin-left: auto;
}
.pve-prev-window {
    margin: 14px 18px;
    background: #fff;
    border-radius: 10px;
    border: 1px solid var(--pve-border);
    overflow: hidden;
    transition: max-width 0.18s;
}
.pve-prev-window--mobile {
    max-width: 320px;
}
.pve-prev-chrome {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #f1f5f9;
    border-bottom: 1px solid var(--pve-border);
}
.pve-prev-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
}
.pve-prev-url {
    flex: 1;
    background: #fff;
    border-radius: 4px;
    padding: 3px 10px;
    margin-left: 10px;
    font: 500 11px var(--pve-font-mono);
    color: #64748b;
    border: 1px solid var(--pve-border);
}
.pve-prev-body {
    padding: 18px 18px 16px;
}
.pve-prev-eyebrow {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #64748b;
    font-weight: 700;
}
.pve-prev-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin-top: 6px;
    color: #0f172a;
}
.pve-prev-desc {
    font-size: 12.5px;
    color: #475569;
    margin-top: 6px;
    line-height: 1.5;
}
.pve-prev-price {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 14px;
}
.pve-prev-price-big {
    font-size: 38px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: #0f172a;
}
.pve-prev-price-unit {
    font-size: 13px;
    color: #64748b;
}
.pve-prev-price-yearly {
    font-size: 11.5px;
    color: #047857;
    margin-top: 2px;
    font-weight: 500;
}
.pve-prev-cta {
    display: block;
    width: 100%;
    margin-top: 14px;
    padding: 10px;
    background: #0f172a;
    color: #fff;
    border: 0;
    border-radius: 7px;
    font: 600 13px var(--pve-font-sans);
    cursor: pointer;
}
.pve-prev-sep {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #f1f5f9;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #94a3b8;
    font-weight: 700;
}
.pve-prev-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.pve-prev-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: #0f172a;
}
.pve-prev-list li b {
    font-weight: 600;
}
.pve-prev-tick {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d1fae5;
    color: #047857;
    flex: 0 0 auto;
}
.pve-prev-empty {
    color: #94a3b8;
    font-style: italic;
}
.pve-prev-foot {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #f1f5f9;
    font-size: 10.5px;
    color: #94a3b8;
    line-height: 1.5;
}

.pve-prev-validate {
    margin: 0 18px 18px;
    background: #fff;
    border: 1px solid var(--pve-border);
    border-radius: 8px;
    padding: 12px;
}
.pve-prev-validate-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}
.pve-prev-validate-tick {
    color: var(--pve-live);
    display: inline-flex;
}
.pve-prev-validate-title {
    font-size: 12.5px;
    font-weight: 600;
}
.pve-prev-validate-count {
    margin-left: auto;
    font-size: 11px;
    color: #64748b;
}
.pve-vchk {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    padding: 3px 0;
}
.pve-vchk--ok {
    color: #475569;
}
.pve-vchk--ok span:first-child {
    color: var(--pve-live);
    display: inline-flex;
}
.pve-vchk--warn {
    color: #b45309;
}
.pve-vchk--warn span:first-child {
    color: var(--pve-draft);
    display: inline-flex;
}

/* ── Responsive ────────────────────────────────────────────────── */
@media (max-width: 1280px) {
    .pve-body {
        grid-template-columns: 320px 1fr 360px;
    }
}
@media (max-width: 1100px) {
    .pve-body {
        grid-template-columns: 1fr;
        overflow-y: auto;
    }
    .pve-col {
        border-right: 0;
        border-bottom: 1px solid var(--pve-border);
    }
}

/* ── Diff dialog ────────────────────────────────────────────────── */
.pve-diff-modal {
    background: #fff;
    width: 560px;
    max-width: 92vw;
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.3);
    overflow: hidden;
    font-family: var(--pve-font-sans);
    color: var(--pve-text);
}
.pve-diff-modal * {
    box-sizing: border-box;
}
.pve-diff-head {
    padding: 16px 20px;
    border-bottom: 1px solid var(--pve-border);
    display: flex;
    align-items: flex-start;
    gap: 12px;
}
.pve-diff-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.pve-diff-sub {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 3px;
}
.pve-diff-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--pve-text-3);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pve-diff-close:hover {
    background: rgba(15, 23, 42, 0.05);
    color: var(--pve-text);
}
.pve-diff-body {
    padding: 14px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 60vh;
    overflow-y: auto;
}
.pve-diff-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid;
    border-radius: 7px;
}
.pve-diff-sign {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: #fff;
    font-weight: 800;
    font-size: 13px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pve-diff-main {
    flex: 1;
    min-width: 0;
}
.pve-diff-headline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
}
.pve-diff-section {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
}
.pve-diff-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--pve-text);
}
.pve-diff-change {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
    font-size: 12px;
}
.pve-diff-from {
    text-decoration: line-through;
    color: var(--pve-text-3);
}
.pve-diff-to {
    color: var(--pve-text);
    font-weight: 600;
}
.pve-diff-arrow {
    font-weight: 700;
}
.pve-diff-tag {
    font-size: 10px;
    background: #fff;
}
.pve-diff-empty {
    padding: 24px 8px;
    text-align: center;
    color: var(--pve-text-3);
    font-style: italic;
    font-size: 13px;
}
</style>
