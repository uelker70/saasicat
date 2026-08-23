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

        <AdminBody>
            <!-- Save error banner, e.g. PLAN_DRAFT_ALREADY_EXISTS -->
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
        </AdminBody>

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
import PlanComponentPool from './internal/PlanComponentPool.vue';
import PlanCatalogPreview from './internal/PlanCatalogPreview.vue';
import PlanVersionBasket from './internal/PlanVersionBasket.vue';
import PlanVersionDiffDialog from './internal/PlanVersionDiffDialog.vue';
import AdminBody from '../../ui/page/AdminBody.vue';
import PlanVersionEditorHeader from './internal/PlanVersionEditorHeader.vue';
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
} from './internal/plan-version-editor.types.js';

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
        /** Error message from the last save attempt, e.g. the text for PLAN_DRAFT_ALREADY_EXISTS. */
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
// version — otherwise the version timeline is wrong.
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

// Roles rather than values, because these reach the DOM through a `:style`
// binding — see PlanVersionDiffDialog. Fixed light hexes there meant the dialog
// kept white-ish rows in dark mode while the label above them turned near-white
// with the theme, which is the one state where a diff has to be readable.
// An inline style resolves `var()`, so the indirection costs nothing.
const DIFF_STYLE = {
    added: {
        bg: 'var(--sa-color-positive-surface)',
        border: 'var(--sa-color-positive-border)',
        color: 'var(--sa-color-positive-fg)',
        sign: '+',
    },
    removed: {
        bg: 'var(--sa-color-negative-surface)',
        border: 'var(--sa-color-negative-border)',
        color: 'var(--sa-color-negative-fg)',
        sign: '−',
    },
    changed: {
        bg: 'var(--sa-color-warning-surface)',
        border: 'var(--sa-color-warning-border)',
        color: 'var(--sa-color-warning-fg)',
        sign: '~',
    },
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
        // (see PlanVersionRow.bundles).
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
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* The editor reflows on ITS OWN width, not the window's — see the
       `@container` rules at the end of this block. */
    container-type: inline-size;
    container-name: pve;
    /* A full view rather than a modal: the columns stretch to the content area
       AdminPage already sizes. */
    height: 100%;
}

/* ── Editor bar ─────────────────────────────────────────────────── */

/* ── Save error banner ──────────────────────────────────────────── */
.pve-error {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-6);
    background: var(--sa-color-negative-surface);
    border-bottom: 1px solid var(--sa-color-negative-border);
    color: var(--sa-color-negative-fg);
    font-size: var(--sa-text-md);
    font-weight: 500;
}
.pve-error-ico {
    display: inline-flex;
    flex: 0 0 auto;
}
/* The kicker above the heading: "Plan" plus the plan key. */
.pve-kicker {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
}
.pve-mono {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
}
.pve-mono--xs {
    font-size: var(--sa-text-2xs);
}

/* ── Buttons & Chips ───────────────────────────────────────────── */

.pve-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    letter-spacing: var(--sa-tracking-normal);
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
}
.pve-chip--plan {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
    border-color: var(--sa-color-info-border);
}
.pve-chip--draft {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}
.pve-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}
.pve-chip--changes {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}

.pve-kbd {
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    padding: var(--sa-space-1) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    border: 1px solid var(--sa-color-border);
}

/* ── Body Grid ──────────────────────────────────────────────────── */
.pve > .sa-page-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
}
.pve-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: 380px 1fr 400px;
    background: var(--sa-color-bg-app);
}

.pve-col {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    min-width: 0;
    overflow: hidden;
}
.pve-col:last-child {
    border-right: 0;
}
.pve-col-header {
    padding: var(--sa-space-5) var(--sa-space-5) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-border);
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
    flex: 0 0 auto;
}
.pve-col-header--basket {
    padding: var(--sa-space-5) var(--sa-space-6) var(--sa-space-4);
}
.pve-col-header--preview {
    padding: var(--sa-space-5) var(--sa-space-5) var(--sa-space-4);
}
.pve-col-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-normal);
}
.pve-col-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
}

/* ── LEFT — Pool ───────────────────────────────────────────────── */
.pve-pool {
    background: var(--sa-color-bg-surface-raised);
}
.pve-search {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    margin: var(--sa-space-3) var(--sa-space-4) 0;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
}
.pve-search input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    font: var(--sa-text-md) var(--sa-font-body);
    color: var(--sa-color-fg-heading);
}
.pve-search-ico {
    color: var(--sa-color-fg-subtle);
    display: inline-flex;
}
.pve-tabs {
    display: flex;
    gap: var(--sa-space-2);
    padding: var(--sa-space-4) var(--sa-space-4) var(--sa-space-2);
}
.pve-tab {
    background: transparent;
    border: 0;
    padding: var(--sa-space-2) var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
    font: 500 var(--sa-text-md) var(--sa-font-body);
    color: var(--sa-color-fg-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.pve-tab--active {
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-fg-on-accent);
}
.pve-tab-count {
    font-size: var(--sa-text-xs);
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
}
.pve-tab--active .pve-tab-count {
    background: var(--sa-color-inverse-border-strong);
    color: var(--sa-color-fg-on-accent);
}
.pve-pool-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--sa-space-2) var(--sa-space-4) var(--sa-space-5);
}
.pve-pool-group {
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
    font-weight: 700;
    padding: var(--sa-space-4) var(--sa-space-2) var(--sa-space-2);
}
.pve-pool-card {
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-3);
    margin-bottom: var(--sa-space-2);
    cursor: grab;
    transition:
        box-shadow 0.12s,
        border-color 0.12s;
    user-select: none;
}
.pve-pool-card:hover {
    border-color: var(--sa-color-scheduled-border);
    box-shadow: 0 1px 3px var(--sa-shadow-tint-1);
}
.pve-pool-card:active {
    cursor: grabbing;
}
.pve-pool-card--selected {
    background: var(--sa-color-bg-sunken);
    opacity: 0.7;
}
.pve-pool-card--partial {
    border-color: var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
}
.pve-pool-grip {
    color: var(--sa-color-fg-disabled);
    padding-top: var(--sa-space-1);
    flex: 0 0 auto;
}
.pve-pool-card-main {
    flex: 1;
    min-width: 0;
}
.pve-pool-card-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.pve-pool-card-label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pve-pool-card-check {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    margin-left: auto;
}
.pve-pool-card-meta {
    display: flex;
    gap: var(--sa-space-2);
    align-items: center;
    flex-wrap: wrap;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-top: var(--sa-space-1);
}
.pve-pool-card-key {
    font: 500 var(--sa-text-2xs) var(--sa-font-mono);
    color: var(--sa-color-fg-muted);
}
.pve-pool-card-dot {
    color: var(--sa-color-fg-disabled);
}

.pve-empty {
    padding: var(--sa-space-7) var(--sa-space-2);
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-md);
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
    background: var(--sa-color-accent-surface);
    box-shadow: inset 0 0 0 2px var(--sa-color-accent);
}
.pve-basket-settings {
    background: linear-gradient(
        180deg,
        var(--sa-color-bg-sunken) 0%,
        var(--sa-color-bg-surface) 100%
    );
    border-bottom: 1px solid var(--sa-color-border);
    padding: var(--sa-space-4) var(--sa-space-6) var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.pve-bs-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.pve-bs-label {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    font-weight: 500;
    min-width: 88px;
}
.pve-bs-label--inline {
    min-width: 0;
    margin-left: var(--sa-space-3);
}
.pve-bs-error {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    margin: calc(-1 * var(--sa-space-1)) 0 var(--sa-space-1);
    font-size: var(--sa-text-sm);
    font-weight: 500;
    color: var(--sa-color-negative-fg);
}
.pve-bs-error svg {
    flex: 0 0 auto;
}
/* Widths, not looks. */
.pve-bs-money {
    max-width: 120px;
}

.pve-bs-grow {
    flex: 1;
}

.pve-sel-val-input {
    max-width: 96px;
}

.pve-bs-input-grp {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-bg-surface);
    overflow: hidden;
}
.pve-bs-input-grp--gap {
    margin-left: var(--sa-space-2);
}
.pve-bs-prefix,
.pve-bs-suffix {
    background: var(--sa-color-bg-sunken);
    padding: var(--sa-space-2) var(--sa-space-3);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    display: grid;
    place-items: center;
    border-right: 1px solid var(--sa-color-border);
}
.pve-bs-suffix {
    border-right: 0;
    border-left: 1px solid var(--sa-color-border);
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
    background: var(--sa-color-border-strong);
    border-radius: var(--sa-radius-pill);
    transition: background 0.15s;
}
.pve-toggle span::before {
    content: '';
    position: absolute;
    top: var(--sa-space-1);
    left: var(--sa-space-1);
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--sa-color-bg-surface);
    transition: transform 0.15s;
}
.pve-toggle input:checked + span {
    background: var(--sa-color-accent);
}
.pve-toggle input:checked + span::before {
    transform: translateX(16px);
}

.pve-basket-group {
    padding: var(--sa-space-4) var(--sa-space-6);
    border-bottom: 1px solid var(--sa-color-border-soft);
}
.pve-basket-group:last-child {
    border-bottom: 0;
}
.pve-bg-header {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    margin-bottom: var(--sa-space-3);
}
.pve-bg-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.pve-bg-dot--quota {
    background: var(--sa-color-quota);
}
.pve-bg-dot--feature {
    background: var(--sa-color-feature);
}
.pve-bg-dot--bundle {
    background: var(--sa-color-bundle);
}
.pve-bg-title {
    font-size: var(--sa-text-sm);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    font-weight: 700;
    color: var(--sa-color-fg-body);
}
.pve-bg-count {
    margin-left: var(--sa-space-2);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}

.pve-dz {
    border: 1.5px dashed var(--sa-color-border-strong);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-4);
    background: var(--sa-color-bg-surface-raised);
    min-height: 60px;
}
.pve-basket--dragover .pve-dz {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface);
}
.pve-dz-empty {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
    text-align: center;
    padding: var(--sa-space-2) 0;
}
.pve-dz-empty--center {
    padding: var(--sa-space-3) 0;
}

.pve-sel-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    margin-bottom: var(--sa-space-2);
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
    background: var(--sa-color-quota);
}
.pve-sel-dot--feature {
    background: var(--sa-color-feature);
}
.pve-sel-dot--bundle {
    background: var(--sa-color-bundle);
}
.pve-sel-body {
    flex: 1;
    min-width: 0;
}
.pve-sel-label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pve-sel-sub {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
}
.pve-sel-val-edit {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    background: var(--sa-color-bg-sunken);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
    border: 1px solid var(--sa-color-border);
}
.pve-sel-val-input::-webkit-outer-spin-button,
.pve-sel-val-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.pve-sel-val-unit {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.pve-sel-x {
    background: transparent;
    border: 0;
    color: var(--sa-color-fg-subtle);
    cursor: pointer;
    padding: var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    display: grid;
    place-items: center;
}
.pve-sel-x:hover {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-strong);
}

/* ── RIGHT — Preview ───────────────────────────────────────────── */
.pve-preview {
    background: var(--sa-color-bg-sunken);
    overflow: auto;
}
.pve-preview-toggle {
    display: flex;
    gap: var(--sa-space-2);
    margin-left: auto;
}
.pve-prev-window {
    margin: var(--sa-space-4) var(--sa-space-5);
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-tile);
    border: 1px solid var(--sa-color-border);
    overflow: hidden;
    transition: max-width 0.18s;
}
.pve-prev-window--mobile {
    max-width: 320px;
}
.pve-prev-chrome {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-border-soft);
    border-bottom: 1px solid var(--sa-color-border);
}
.pve-prev-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
}
.pve-prev-url {
    flex: 1;
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-1) var(--sa-space-3);
    margin-left: var(--sa-space-3);
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-muted);
    border: 1px solid var(--sa-color-border);
}
.pve-prev-body {
    padding: var(--sa-space-5) var(--sa-space-5) var(--sa-space-5);
}
.pve-prev-eyebrow {
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-muted);
    font-weight: 700;
}
.pve-prev-title {
    font-size: var(--sa-text-3xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    margin-top: var(--sa-space-2);
    color: var(--sa-color-fg-heading);
}
.pve-prev-desc {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
    margin-top: var(--sa-space-2);
    line-height: 1.5;
}
.pve-prev-price {
    display: flex;
    align-items: baseline;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-4);
}
.pve-prev-price-big {
    font-size: var(--sa-text-4xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    color: var(--sa-color-fg-heading);
}
.pve-prev-price-unit {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-muted);
}
.pve-prev-price-yearly {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-positive-fg);
    margin-top: var(--sa-space-1);
    font-weight: 500;
}
.pve-prev-cta {
    display: block;
    width: 100%;
    margin-top: var(--sa-space-4);
    padding: var(--sa-space-3);
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-fg-on-accent);
    border: 0;
    border-radius: var(--sa-radius-control);
    font: 600 var(--sa-text-md) var(--sa-font-body);
    cursor: pointer;
}
.pve-prev-sep {
    margin-top: var(--sa-space-5);
    padding-top: var(--sa-space-4);
    border-top: 1px solid var(--sa-color-border-soft);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
    font-weight: 700;
}
.pve-prev-list {
    list-style: none;
    padding: 0;
    margin: var(--sa-space-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.pve-prev-list li {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
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
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    flex: 0 0 auto;
}
.pve-prev-empty {
    color: var(--sa-color-fg-subtle);
    font-style: italic;
}
.pve-prev-foot {
    margin-top: var(--sa-space-5);
    padding-top: var(--sa-space-4);
    border-top: 1px solid var(--sa-color-border-soft);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    line-height: 1.5;
}

.pve-prev-validate {
    margin: 0 var(--sa-space-5) var(--sa-space-5);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-4);
}
.pve-prev-validate-head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    margin-bottom: var(--sa-space-2);
}
.pve-prev-validate-tick {
    color: var(--sa-color-positive-strong);
    display: inline-flex;
}
.pve-prev-validate-title {
    font-size: var(--sa-text-md);
    font-weight: 600;
}
.pve-prev-validate-count {
    margin-left: auto;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}
.pve-vchk {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-sm);
    padding: var(--sa-space-1) 0;
}
.pve-vchk--ok {
    color: var(--sa-color-fg-secondary);
}
.pve-vchk--ok span:first-child {
    color: var(--sa-color-positive-strong);
    display: inline-flex;
}
.pve-vchk--warn {
    color: var(--sa-color-warning-fg);
}
.pve-vchk--warn span:first-child {
    color: var(--sa-color-warning-strong);
    display: inline-flex;
}

/* ── Responsive ────────────────────────────────────────────────────
 *
 * On the CONTAINER's width, not the viewport's, because the viewport is not
 * what this grid has to fit into. The admin drawer is 240px and collapsible, so
 * a viewport threshold is wrong in one of its two states by construction — and
 * with the drawer open at 1024–1100px the old viewport rule left 784–860px for
 * `320px 1fr 360px`, squeezing the middle column to 104–180px and clipping its
 * form controls behind `overflow: hidden`.
 *
 * The thresholds are the widths the columns actually need:
 *   1060px  →  320 + 360 fixed leaves ≥ 380px for the basket
 *    780px  →  below this the three-column form is not usable at all
 *
 * These are container queries, so they are not viewport breakpoints and the
 * Quasar-band rule does not reach them; `@container` needs no newer browser
 * than the theme already requires. */
@container pve (max-width: 1060px) {
    .pve-body {
        grid-template-columns: 320px 1fr 360px;
    }
}
@container pve (max-width: 780px) {
    .pve-body {
        grid-template-columns: 1fr;
        overflow-y: auto;
    }
    .pve-col {
        border-right: 0;
        border-bottom: 1px solid var(--sa-color-border);
    }
}

/* ── Diff dialog ────────────────────────────────────────────────── */
.pve-diff-modal {
    background: var(--sa-color-bg-surface);
    width: 560px;
    max-width: 92vw;
    border-radius: var(--sa-radius-section);
    box-shadow: 0 24px 60px var(--sa-shadow-tint-4);
    overflow: hidden;
    font-family: var(--sa-font-body);
    color: var(--sa-color-fg-heading);
}
.pve-diff-modal * {
    box-sizing: border-box;
}
.pve-diff-head {
    padding: var(--sa-space-5) var(--sa-space-6);
    border-bottom: 1px solid var(--sa-color-border);
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-4);
}
.pve-diff-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-normal);
}
.pve-diff-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
}
.pve-diff-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: var(--sa-radius-badge);
    background: transparent;
    border: 0;
    color: var(--sa-color-fg-subtle);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pve-diff-close:hover {
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-heading);
}
.pve-diff-body {
    padding: var(--sa-space-4) var(--sa-space-6) var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
    max-height: 60vh;
    overflow-y: auto;
}
.pve-diff-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    border: 1px solid;
    border-radius: var(--sa-radius-control);
}
.pve-diff-sign {
    width: 20px;
    height: 20px;
    border-radius: var(--sa-radius-badge);
    color: var(--sa-color-fg-on-accent);
    font-weight: 800;
    font-size: var(--sa-text-md);
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
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.pve-diff-section {
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    font-weight: 700;
}
.pve-diff-label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pve-diff-change {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-1);
    font-size: var(--sa-text-sm);
}
.pve-diff-from {
    text-decoration: line-through;
    color: var(--sa-color-fg-subtle);
}
.pve-diff-to {
    color: var(--sa-color-fg-heading);
    font-weight: 600;
}
.pve-diff-arrow {
    font-weight: 700;
}
.pve-diff-tag {
    font-size: var(--sa-text-2xs);
    background: var(--sa-color-bg-surface);
}
.pve-diff-empty {
    padding: var(--sa-space-7) var(--sa-space-3);
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
}
</style>
