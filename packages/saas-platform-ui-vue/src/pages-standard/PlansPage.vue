<template>
    <q-page class="sa-plans">
        <q-banner v-if="error" class="bg-negative text-white q-ma-md" rounded>
            <template #avatar>
                <q-icon name="error" />
            </template>
            {{ error.message }}
            <template #action>
                <q-btn flat label="Erneut laden" @click="load" />
            </template>
        </q-banner>

        <div v-if="loading && plans.length === 0" class="sa-plans__loading">
            <q-spinner size="32px" />
            <span>Pläne werden geladen…</span>
        </div>

        <template v-else>
            <!-- Default: list view (plan simulation) + Bundle overview -->
            <template v-if="mode === 'list'">
                <PlanList
                    :plans="plans"
                    :versions-by-plan-id="versionsByPlanId"
                    :tenant-counts-by-plan-key="tenantCountsByPlanKey"
                    :plan-accents="props.planAccents"
                    :highlight-plan-key="highlightPlanKey"
                    @open-plan="onOpenPlan"
                    @create-plan="openCreate"
                    @clone-plan="onClonePlan"
                    @new-version="onNewVersionFromList"
                    @edit-draft="onEditDraftFromList"
                    @discard-draft="onDiscardDraftFromList"
                    @archive-plan="onArchivePlanFromList"
                    @show-matrix="mode = 'matrix'"
                />
                <PlanBundleOverview
                    :bundles="availableBundles"
                    :plans="plans"
                    :feature-registry="featureRegistry"
                />
            </template>

            <!-- V1 matrix: component comparison -->
            <PlanMatrix
                v-else-if="mode === 'matrix'"
                :plans="plans"
                :versions-by-plan-id="versionsByPlanId"
                :available-quotas="availableQuotas"
                :available-bundles="availableBundles"
                :feature-registry="featureRegistry"
                :tenant-counts-by-plan-key="tenantCountsByPlanKey"
                :plan-accents="props.planAccents"
                :loading="bulkVersionsLoading"
                @open-plan="onOpenPlan"
                @create-plan="openCreate"
                @clone-plan="onClonePlan"
                @view-catalog="mode = 'list'"
            />

            <!-- Plan detail: drill-in for a single Plan (plan simulation) -->
            <PlanDetail
                v-else-if="mode === 'cockpit' && selectedPlan"
                :plan="selectedPlan"
                :versions="versions"
                :available-quotas="availableQuotas"
                :available-bundles="availableBundles"
                :feature-registry="featureRegistry"
                :impact-by-version="impactByVersion"
                :audit-rows="auditRows"
                :loading-audit="loadingAudit"
                :submit-terminate="onSubmitTerminate"
                @back="onBackToList"
                @create-draft="openCreateDraft"
                @edit-draft="openEditDraft"
                @publish="openPublish"
                @clone-plan="onClonePlan(selectedPlan)"
                @delete-plan="onArchivePlanFromList(selectedPlan, false)"
                @update-plan="onUpdatePlanFromDetail"
            />

            <!-- V2 split-view editor as a full-screen view (plan simulation) -->
            <PlanVersionEditor
                v-else-if="mode === 'editor' && draftEditing && selectedPlan"
                :plan-key="selectedPlan.planKey"
                :editing-id="draftEditing.editingId"
                :initial-form="draftEditing.initialForm"
                :saving="draftSaving"
                :available-features="availableFeatures"
                :available-quotas="availableQuotas"
                :available-bundles="availableBundles"
                :feature-registry="featureRegistry"
                :plan-display-name="selectedPlan.label"
                :save-error="draftSaveError"
                :predecessor-version="editorPredecessor"
                @save="onEditorNext"
                @cancel="onCancelEditor"
            />

            <!-- V3 Review & Publish — wizard step 3 (plan simulation) -->
            <PlanReview
                v-else-if="mode === 'review' && reviewDraft && selectedPlan"
                :plan="selectedPlan"
                :version="reviewDraft"
                :predecessor="reviewPredecessor"
                :available-quotas="availableQuotas"
                :available-bundles="availableBundles"
                :feature-registry="featureRegistry"
                :tenant-impact-count="tenantCountsByPlanKey[selectedPlan.planKey] ?? 0"
                :saving="draftSaving"
                :publishing="publishing"
                :publish-error="reviewError"
                @back="onReviewBack"
                @save-and-exit="onReviewSaveExit"
                @publish="onReviewPublish"
            />
        </template>

        <PlansPageToast :message="toastMessage" />

        <!-- Create Plan master record (V1 plan simulation step 1) -->
        <PlanCreateDialog
            v-model="createDialogOpen"
            :available-templates="availableTemplates"
            :existing-plan-keys="existingPlanKeys"
            :default-basis="cloneFromPlanKey ?? 'empty'"
            :submitting="creatingPlan"
            @submit="onCreateSubmit"
            @cancel="createDialogOpen = false"
        />

        <PlanArchiveDialog
            v-model="archiveOpen"
            :target="archiveTarget"
            :error="archiveError"
            :archiving="archiving"
            @execute="executeArchive"
        />

        <PlanDiscardDraftDialog
            v-model="discardOpen"
            :target="discardTarget"
            :error="discardError"
            :discarding="discarding"
            @execute="executeDiscard"
        />

        <PlanPublishDialog
            v-model="publishOpen"
            v-model:force-regressive="forceRegressive"
            v-model:allow-zero-price="allowZeroPrice"
            :selected-plan="selectedPlan"
            :publish-target="publishTarget"
            :publishing="publishing"
            :publish-error="publishError"
            :regression-changes="regressionChanges"
            :field-label="fieldLabel"
            :format-change-value="formatChangeValue"
            @execute="executePublish"
        />
    </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import type {
    FeatureCatalogEntryRow,
    PlanRow,
    PlanVersionRow,
    PlanVersionMutationResult,
} from '@saasicat/types';
import {
    buildFeatureRegistry,
    CATALOG_DEFAULT_LOCALE,
} from '../components/bundle-editor/catalog-i18n.js';
import {
    usePlans,
    usePlanVersions,
    type UsePlansResult,
    type UsePlanVersionsResult,
} from '../vue/use-plans.js';
import type { HttpClient } from '../client/types.js';
import PlanVersionEditor from '../components/plan-version-editor/PlanVersionEditor.vue';
import PlanMatrix from '../components/plan-matrix/PlanMatrix.vue';
import PlanDetail from '../components/plan-detail/PlanDetail.vue';
import PlanList from '../components/plan-list/PlanList.vue';
import PlanCreateDialog, {
    type PlanCreateSubmit,
    type TemplateOption,
} from '../components/plan-create-dialog/PlanCreateDialog.vue';
import PlanReview from '../components/plan-review/PlanReview.vue';
import PlanArchiveDialog from './plans-page/PlanArchiveDialog.vue';
import PlanDiscardDraftDialog from './plans-page/PlanDiscardDraftDialog.vue';
import PlanPublishDialog from './plans-page/PlanPublishDialog.vue';
import PlanBundleOverview from './plans-page/PlanBundleOverview.vue';
import PlansPageToast from './plans-page/PlansPageToast.vue';
import type { PlanArchiveTarget, PlanDiscardTarget, RegressionChange } from './plans-page/types.js';

// SuperAdmin plan management — V1 matrix overview as the default view
// (all Plans side by side), drill-in into the V3 cockpit for a single
// Plan (versions timeline + diff + Tenant impact + audit), and V2
// split-view editor as a modal for draft editing. The plan master dialog
// (create + edit) stays unchanged.

interface DiscoveryFeature {
    featureKey: string;
}
interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}
interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
    compatiblePlanKeys?: string[] | null;
}
interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    user?: { email: string; firstName?: string; lastName?: string } | null;
    userEmail?: string | null;
}

const props = defineProps<{
    adminEndpoint: string;
    projectKey: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /**
     * Optional: feature label overrides. Since the catalog entry
     * integration, labels come by default from the FeatureCatalogEntries
     * (incl. i18n); this prop overrides individual keys (e.g. group).
     */
    featureRegistry?: Record<string, { label?: string; group?: string }>;
    /** Display language for feature labels from the catalog entries. */
    displayLocale?: string;
    /** Accent color per plan key for the matrix + cockpit header. */
    planAccents?: Record<string, string>;
    /** Tenant count per plan key for the matrix headers. */
    tenantCountsByPlanKey?: Record<string, number>;
    /** Optional: loader for a Plan's audit log (cockpit). */
    loadPlanAudit?: (planId: string) => Promise<AuditRow[]>;
}>();

const composable: UsePlansResult = usePlans({
    adminEndpoint: props.adminEndpoint,
    projectKey: props.projectKey,
    http: props.http,
    getAuthToken: props.getAuthToken,
});
const {
    plans,
    loading,
    error,
    tenantCountsByPlanKey: loadedTenantCounts,
    load,
    loadTenantCounts,
    create,
    update,
    hardDelete,
} = composable;

// ─── View mode + selection ───
// Plan simulation flow: list → cockpit (plan detail); editor ("Draft
// bearbeiten") → "Weiter · Review" → review ("Review & Publish").
// The editor does NOT persist — saving happens only in the review screen
// (via "Als Draft speichern" or "Publish").
type Mode = 'list' | 'matrix' | 'cockpit' | 'editor' | 'review';
const mode = ref<Mode>('list');
const selectedPlan = ref<PlanRow | null>(null);

// Synthetic (not yet persisted) PlanVersion from the editor form that the
// review screen displays. Persisted only on a review
// action.
const reviewDraft = ref<PlanVersionRow | null>(null);
// Shared error text for review actions (save + publish).
const reviewError = ref<string | null>(null);

// NEW highlight after plan create / version publish (see plan simulation).
const highlightPlanKey = ref<string | null>(null);
const toastMessage = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function flashToast(msg: string, ms = 4000): void {
    toastMessage.value = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastMessage.value = null;
    }, ms);
}

function flashHighlight(planKey: string, ms = 4500): void {
    highlightPlanKey.value = planKey;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
        highlightPlanKey.value = null;
    }, ms);
}

// Prop stays an override; without the prop the platform-wide counters
// loaded by use-plans apply (GET …/catalog/plans/tenant-counts).
const tenantCountsByPlanKey = computed<Record<string, number>>(
    () => props.tenantCountsByPlanKey ?? loadedTenantCounts.value,
);

function planAccent(planKey: string): string {
    return props.planAccents?.[planKey] ?? defaultAccent(planKey);
}
const DEFAULT_ACCENTS: Record<string, string> = {
    STARTER: '#64748b',
    STANDARD: '#2563eb',
    PRO: '#7c3aed',
    PROFESSIONAL: '#7c3aed',
    BUSINESS: '#0ea5e9',
    ENTERPRISE: '#0f766e',
    BASIC: '#475569',
};
function defaultAccent(planKey: string): string {
    return DEFAULT_ACCENTS[planKey] ?? '#2563eb';
}

// ─── Plan master creation (V1 plan simulation step 1) ───
const createDialogOpen = ref(false);
const creatingPlan = ref(false);
// When started from "Plan klonen", this is the default basis (plan key).
const cloneFromPlanKey = ref<string | null>(null);

const existingPlanKeys = computed<string[]>(() => plans.value.map((p) => p.planKey));

function quotasOfVersion(v: PlanVersionRow): Record<string, number> {
    if (v.quotas && Object.keys(v.quotas).length > 0) return { ...v.quotas };
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}

const availableTemplates = computed<TemplateOption[]>(() =>
    plans.value
        .map<TemplateOption | null>((p) => {
            const versions = versionsByPlanId.value[p.id] ?? [];
            const live =
                versions.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null;
            if (!live) return null;
            return {
                key: p.planKey,
                label: p.label,
                features: [...live.features],
                quotas: quotasOfVersion(live),
                bundles: bundlesFullyOn(live.features),
            };
        })
        .filter((t): t is TemplateOption => t !== null),
);

function bundlesFullyOn(features: string[]): string[] {
    return availableBundles.value
        .filter((b) => b.features.length > 0 && b.features.every((f) => features.includes(f)))
        .map((b) => b.bundleKey);
}

function openCreate(): void {
    cloneFromPlanKey.value = null;
    createDialogOpen.value = true;
}

function onClonePlan(plan: PlanRow): void {
    cloneFromPlanKey.value = plan.planKey;
    createDialogOpen.value = true;
}

async function onCreateSubmit(payload: PlanCreateSubmit): Promise<void> {
    creatingPlan.value = true;
    try {
        const created: PlanRow = await create({
            projectKey: props.projectKey,
            planKey: payload.planKey,
            label: payload.label,
            description: payload.description === '' ? undefined : payload.description,
            sortOrder: plans.value.length * 100,
        });
        createDialogOpen.value = false;

        await reloadAllVersions();
        flashHighlight(created.planKey);
        flashToast(`Plan ${created.planKey} angelegt — jetzt die erste Version zusammenstellen.`);
        await onOpenPlan(created);
        openCreateDraftWithPrefill({
            features: payload.initialFeatures,
            quotas: payload.initialQuotas,
            // Bundles from the master clone are already represented in `features`
            // (set union). The active Bundle visualization in the editor detects
            // them automatically once all Bundle features are in the basket.
        });
    } finally {
        creatingPlan.value = false;
    }
}

// ─── Versions per Plan (matrix loads all, cockpit has one active selection) ───
const versionsByPlanId = ref<Record<string, PlanVersionRow[]>>({});
const bulkVersionsLoading = ref(false);

async function reloadAllVersions(): Promise<void> {
    if (plans.value.length === 0) return;
    bulkVersionsLoading.value = true;
    try {
        const http = props.http ?? ((url: string, init?: RequestInit) => fetch(url, init));
        const token = props.getAuthToken?.();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const results = await Promise.all(
            plans.value.map(async (p) => {
                const r = await http(`${props.adminEndpoint}/catalog/plans/${p.id}/versions`, {
                    headers,
                });
                if (r.status !== 200) return [p.id, [] as PlanVersionRow[]] as const;
                const body = (await r.json().catch(() => [])) as PlanVersionRow[];
                return [p.id, body] as const;
            }),
        );
        const next: Record<string, PlanVersionRow[]> = {};
        for (const [id, vs] of results) next[id] = vs;
        versionsByPlanId.value = next;
        if (selectedPlan.value) {
            versions.value = next[selectedPlan.value.id] ?? [];
        }
    } finally {
        bulkVersionsLoading.value = false;
    }
}

// ─── Cockpit versions (for the drill-in) ───
const versions = ref<PlanVersionRow[]>([]);
const planVersions = shallowRef<UsePlanVersionsResult | null>(null);

async function loadCockpitVersions(plan: PlanRow): Promise<void> {
    const pv = usePlanVersions({
        adminEndpoint: props.adminEndpoint,
        planId: plan.id,
        http: props.http,
        getAuthToken: props.getAuthToken,
    });
    planVersions.value = pv;
    await pv.load();
    versions.value = pv.versions.value;
    versionsByPlanId.value = { ...versionsByPlanId.value, [plan.id]: pv.versions.value };
}

async function reloadCockpitVersions(): Promise<void> {
    if (!planVersions.value || !selectedPlan.value) return;
    await planVersions.value.load();
    versions.value = planVersions.value.versions.value;
    versionsByPlanId.value = {
        ...versionsByPlanId.value,
        [selectedPlan.value.id]: planVersions.value.versions.value,
    };
}

// ─── Cockpit audit log (optional) ───
const auditRows = ref<AuditRow[]>([]);
const loadingAudit = ref(false);

async function loadAuditFor(plan: PlanRow): Promise<void> {
    if (!props.loadPlanAudit) {
        auditRows.value = [];
        return;
    }
    loadingAudit.value = true;
    try {
        auditRows.value = await props.loadPlanAudit(plan.id);
    } catch {
        auditRows.value = [];
    } finally {
        loadingAudit.value = false;
    }
}

// ─── Impact per version (heuristic from Tenant counts) ───
const impactByVersion = computed<Record<number, number>>(() => {
    // We only know the Tenant total per Plan. Without a dedicated
    // "Tenants per version" endpoint we show the total on the active
    // live version and 0 otherwise. Consumers can replace this later via a
    // prop once the data is available.
    const result: Record<number, number> = {};
    if (!selectedPlan.value) return result;
    const liveVersion =
        versions.value.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null;
    if (liveVersion) {
        result[liveVersion.version] = tenantCountsByPlanKey.value[selectedPlan.value.planKey] ?? 0;
    }
    return result;
});

// ─── Navigation matrix ↔ cockpit ───
async function onOpenPlan(plan: PlanRow): Promise<void> {
    selectedPlan.value = plan;
    mode.value = 'cockpit';
    await Promise.all([loadCockpitVersions(plan), loadAuditFor(plan)]);
}

// "Neue Version" directly from the list row (plan simulation: pencil icon).
// Jumps into the cockpit + opens the V2 editor with the current live version
// as the basis. No create modal in between.
async function onNewVersionFromList(plan: PlanRow, basis: PlanVersionRow): Promise<void> {
    selectedPlan.value = plan;
    mode.value = 'cockpit';
    await Promise.all([loadCockpitVersions(plan), loadAuditFor(plan)]);
    // Editor with a basis clone — new version (the next version number is
    // computed in the editor itself from the existing list).
    openCreateDraftWithPrefill({
        features: [...basis.features],
        quotas: quotasOfVersion(basis),
        monthlyNet: basis.monthlyNet,
        yearlyNet: basis.yearlyNet,
        marketed: basis.marketed,
    });
}

// "Draft bearbeiten" from the list sub-row: loads the cockpit composable
// for the Plan (so persistDraft → updateDraft uses the correct planVersions
// instance) and opens the editor in edit mode (editingId set).
async function onEditDraftFromList(plan: PlanRow, draft: PlanVersionRow): Promise<void> {
    selectedPlan.value = plan;
    mode.value = 'cockpit';
    await Promise.all([loadCockpitVersions(plan), loadAuditFor(plan)]);
    openEditDraft(draft);
}

function onBackToList(): void {
    mode.value = 'list';
    selectedPlan.value = null;
    planVersions.value = null;
    versions.value = [];
    auditRows.value = [];
}

// Inline rename of the Plan title from the plan detail screen (only allowed
// with an open draft — the UI shows the edit button accordingly).
async function onUpdatePlanFromDetail(patch: { label: string }): Promise<void> {
    if (!selectedPlan.value) return;
    try {
        const updated = await update(selectedPlan.value.id, patch);
        selectedPlan.value = updated;
    } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[PlansPage] Plan-Rename fehlgeschlagen', err);
    }
}

// ─── Discovery + Bundles for the editor ───
const availableFeatures = ref<DiscoveryFeature[]>([]);
const availableQuotas = ref<DiscoveryQuota[]>([]);
const availableBundles = ref<BundleEntry[]>([]);

// Curated feature labels (FeatureCatalogEntry incl. i18n) as the basis,
// wrapper overrides win per key — same resolution as BundlesPage, so that
// all consumer admin UIs label things identically.
const featureCatalogEntries = ref<FeatureCatalogEntryRow[]>([]);
const featureRegistry = computed<Record<string, { label?: string; group?: string }>>(() => ({
    ...buildFeatureRegistry(featureCatalogEntries.value, props.displayLocale ?? CATALOG_DEFAULT_LOCALE),
    ...props.featureRegistry,
}));

async function loadEditorSources(): Promise<void> {
    const http = props.http ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const token = props.getAuthToken?.();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
        const [discRes, bundlesRes, featureEntriesRes] = await Promise.all([
            http(`${props.adminEndpoint}/discovery`, { headers }),
            http(
                `${props.adminEndpoint}/catalog/bundles?projectKey=${encodeURIComponent(props.projectKey)}`,
                { headers },
            ),
            http(
                `${props.adminEndpoint}/catalog/features?projectKey=${encodeURIComponent(props.projectKey)}`,
                { headers },
            ),
        ]);
        if (featureEntriesRes.status === 200) {
            featureCatalogEntries.value = (await featureEntriesRes
                .json()
                .catch(() => [])) as FeatureCatalogEntryRow[];
        }
        if (discRes.status === 200 || discRes.status === 304) {
            const body = (await discRes.json().catch(() => null)) as {
                features?: DiscoveryFeature[];
                quotas?: DiscoveryQuota[];
            } | null;
            availableFeatures.value = body?.features ?? [];
            availableQuotas.value = body?.quotas ?? [];
        }
        if (bundlesRes.status === 200) {
            const list = (await bundlesRes.json().catch(() => [])) as Array<{
                id: string;
                bundleKey: string;
                label?: string | null;
            }>;
            const detailed = await Promise.all(
                list.map(async (b) => {
                    const r = await http(`${props.adminEndpoint}/catalog/bundles/${b.id}`, {
                        headers,
                    });
                    if (r.status !== 200) return null;
                    const body = (await r.json().catch(() => null)) as {
                        bundle: { bundleKey: string; label?: string | null };
                        versions?: Array<{
                            features?: string[];
                            compatibility?: { planIds?: string[] | null } | null;
                            publishedAt: string | null;
                            supersededAt: string | null;
                        }>;
                    } | null;
                    if (!body) return null;
                    const live = body.versions?.find(
                        (v) => v.publishedAt !== null && v.supersededAt === null,
                    );
                    return {
                        bundleKey: body.bundle.bundleKey,
                        label: body.bundle.label,
                        features: live?.features ?? [],
                        // compatibility.planIds contains plan KEYS (see public-marketing-catalog).
                        compatiblePlanKeys: live?.compatibility?.planIds ?? [],
                    } as BundleEntry;
                }),
            );
            availableBundles.value = detailed.filter((b): b is BundleEntry => b !== null);
        }
    } catch {
        // best-effort
    }
}

// ─── Draft editor (V2) — full-screen view, no modal ───
const draftSaving = ref(false);
const draftSaveError = ref<string | null>(null);

interface ApiErrorShape {
    status?: number;
    body?: {
        code?: string;
        message?: string;
        warnings?: Array<{ message?: string }>;
    };
}

// Translates a PlansApiError (or generic error) from the draft save into a
// clear, displayable message.
function describeDraftSaveError(err: unknown): string {
    const e = err as ApiErrorShape;
    const status = e?.status;
    const body = e?.body;
    const code = body?.code;
    if (status === 401 || status === 403) {
        return 'Sitzung abgelaufen — bitte neu anmelden und erneut speichern.';
    }
    if (status === 422 && code === 'STRICT_MODE_VIOLATIONS') {
        const list = (body?.warnings ?? [])
            .map((w) => w.message)
            .filter(Boolean)
            .join(' · ');
        return `Strict-Mode-Check: ${list || 'Drift gegen den Discovery-Snapshot.'}`;
    }
    if (status === 422 && code === 'PLAN_VERSION_REGRESSION') {
        return 'Diese Version ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). Publish erfordert Force-Regressive — beim Speichern als Draft sollte das nicht auftreten.';
    }
    if (status === 422 && body?.message) {
        // e.g. "Plan 'BASIC' hat bereits eine Draft-Version v4 …"
        return body.message;
    }
    if (status !== undefined) {
        return body?.message ?? `Speichern fehlgeschlagen (HTTP ${status}).`;
    }
    return err instanceof Error
        ? `Speichern fehlgeschlagen: ${err.message}`
        : 'Speichern fehlgeschlagen — Details siehe Browser-Konsole.';
}
const draftEditing = ref<{
    editingId: string | null;
    initialForm: {
        version: number;
        features: string[];
        quotas: Record<string, number>;
        monthlyNet: string;
        yearlyNet: string;
        changeNote: string;
        marketed: boolean;
        validFrom: string | null;
        validUntil: string | null;
    };
} | null>(null);

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function openCreateDraft(): void {
    openCreateDraftWithPrefill({ features: [], quotas: {} });
}

function openCreateDraftWithPrefill(prefill: {
    features: string[];
    quotas: Record<string, number>;
    monthlyNet?: string;
    yearlyNet?: string;
    marketed?: boolean;
}): void {
    const nextVersion = (versions.value.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
    draftEditing.value = {
        editingId: null,
        initialForm: {
            version: nextVersion,
            features: [...prefill.features].sort(),
            quotas: { ...prefill.quotas },
            monthlyNet: prefill.monthlyNet ?? '0.00',
            yearlyNet: prefill.yearlyNet ?? '0.00',
            changeNote: '',
            marketed: prefill.marketed ?? true,
            validFrom: todayIso(),
            validUntil: null,
        },
    };
    draftSaveError.value = null;
    mode.value = 'editor';
}

function openEditDraft(row: PlanVersionRow): void {
    draftEditing.value = {
        editingId: row.id,
        initialForm: {
            version: row.version,
            features: [...row.features],
            quotas: { ...(row.quotas ?? {}) },
            monthlyNet: row.monthlyNet,
            yearlyNet: row.yearlyNet,
            changeNote: row.changeNote ?? '',
            marketed: row.marketed,
            validFrom: row.validFrom ? row.validFrom.slice(0, 10) : null,
            validUntil: row.validUntil ? row.validUntil.slice(0, 10) : null,
        },
    };
    draftSaveError.value = null;
    mode.value = 'editor';
}

// Cancel the editor → back to the cockpit (or to the list if no Plan).
function onCancelEditor(): void {
    draftEditing.value = null;
    mode.value = selectedPlan.value ? 'cockpit' : 'list';
}

// Predecessor version for the "Diff vs. Vorgänger" view in the editor: the
// published version with the highest version number (= the state the draft
// would supersede on publish). Null for v1.
const editorPredecessor = computed<{
    version: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    validFrom: string | null;
} | null>(() => {
    const published = versions.value.filter((v) => v.publishedAt !== null);
    if (published.length === 0) return null;
    const editingId = draftEditing.value?.editingId ?? null;
    const candidates = editingId ? published.filter((v) => v.id !== editingId) : published;
    if (candidates.length === 0) return null;
    const latest = candidates.reduce((a, b) => (a.version > b.version ? a : b));
    return {
        version: latest.version,
        features: [...latest.features],
        quotas: quotasOfVersion(latest),
        monthlyNet: latest.monthlyNet,
        yearlyNet: latest.yearlyNet,
        validFrom: latest.validFrom,
    };
});

interface EditorFormPayload {
    version: number;
    features: string[];
    bundles: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    changeNote: string;
    marketed: boolean;
    validFrom: string | null;
    validUntil: string | null;
}

// Editor button "Weiter · Review" → switches to the review screen WITHOUT
// persisting. The form is held as a synthetic (not yet saved) PlanVersion;
// saving happens only in the review.
function onEditorNext(payload: EditorFormPayload): void {
    if (!selectedPlan.value || !draftEditing.value) return;
    const nowIso = new Date().toISOString();
    reviewDraft.value = {
        id: draftEditing.value.editingId ?? '',
        planId: selectedPlan.value.planKey,
        version: payload.version,
        baseVersionId: null,
        features: [...payload.features],
        bundles: [...payload.bundles],
        quotas: { ...payload.quotas },
        monthlyNet: payload.monthlyNet,
        yearlyNet: payload.yearlyNet,
        marketed: payload.marketed,
        publishedAt: null,
        supersededAt: null,
        publishedChanges: null,
        changeNote: payload.changeNote,
        nonRegressive: true,
        validFrom: payload.validFrom,
        validUntil: payload.validUntil,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
    };
    reviewError.value = null;
    mode.value = 'review';
}

// ─── Review & Publish ───
// Predecessor (current live version) for the diff/impact display in the review.
const reviewPredecessor = computed<PlanVersionRow | null>(() => {
    const live = versions.value.filter((v) => v.publishedAt !== null && v.supersededAt === null);
    if (live.length === 0) return null;
    return live.reduce((a, b) => (a.version > b.version ? a : b));
});

// "Zurück" — back to the editor, with the form values shown in the review
// (not yet saved), so no input is lost.
function onReviewBack(): void {
    if (!reviewDraft.value || !draftEditing.value) {
        mode.value = selectedPlan.value ? 'cockpit' : 'list';
        return;
    }
    const d = reviewDraft.value;
    draftEditing.value = {
        editingId: draftEditing.value.editingId,
        initialForm: {
            version: d.version,
            features: [...d.features],
            quotas: { ...(d.quotas ?? {}) },
            monthlyNet: d.monthlyNet,
            yearlyNet: d.yearlyNet,
            changeNote: d.changeNote ?? '',
            marketed: d.marketed,
            validFrom: d.validFrom,
            validUntil: d.validUntil,
        },
    };
    reviewError.value = null;
    mode.value = 'editor';
}

// Persists the review draft (createDraft for a new version, updateDraft for
// an existing one). Only here does the form go to the API.
async function persistDraft(): Promise<PlanVersionRow | null> {
    if (!planVersions.value || !draftEditing.value || !reviewDraft.value) return null;
    const d = reviewDraft.value;
    const body = {
        features: [...d.features],
        bundles: [...(d.bundles ?? [])],
        quotas: { ...(d.quotas ?? {}) },
        monthlyNet: d.monthlyNet,
        yearlyNet: d.yearlyNet,
        marketed: d.marketed,
        changeNote: d.changeNote ?? '',
        validFrom: d.validFrom,
        validUntil: d.validUntil,
    };
    let result: PlanVersionMutationResult;
    if (draftEditing.value.editingId) {
        result = await planVersions.value.updateDraft(draftEditing.value.editingId, body);
    } else {
        result = await planVersions.value.createDraft(body);
        // Draft now has an ID — remember it in case it's published right
        // after (otherwise a second createDraft → "hat bereits eine Draft").
        draftEditing.value = { ...draftEditing.value, editingId: result.planVersion.id };
    }
    await reloadCockpitVersions();
    return result.planVersion;
}

// "Als Draft speichern" — persists the draft and leaves the wizard
// (back to the plan detail) without publishing.
async function onReviewSaveExit(): Promise<void> {
    if (draftSaving.value || publishing.value) return;
    draftSaving.value = true;
    reviewError.value = null;
    try {
        const saved = await persistDraft();
        if (!saved) return;
        const planKey = selectedPlan.value?.planKey ?? '';
        flashHighlight(planKey);
        flashToast(`Draft v${saved.version} von ${planKey} gespeichert.`);
        reviewDraft.value = null;
        draftEditing.value = null;
        mode.value = selectedPlan.value ? 'cockpit' : 'list';
    } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[PlansPage] Draft speichern fehlgeschlagen', err);
        reviewError.value = describeDraftSaveError(err);
    } finally {
        draftSaving.value = false;
    }
}

async function onReviewPublish(payload: {
    forceRegressive: boolean;
    allowZeroPrice: boolean;
}): Promise<void> {
    if (!planVersions.value || !reviewDraft.value || !selectedPlan.value) return;
    if (publishing.value || draftSaving.value) return;
    publishing.value = true;
    reviewError.value = null;
    try {
        // Persist first (the draft doesn't exist server-side yet), then publish.
        const saved = await persistDraft();
        if (!saved) return;
        const result = await planVersions.value.publish(saved.id, {
            forceRegressive: payload.forceRegressive,
            allowZeroPrice: payload.allowZeroPrice,
        });
        await reloadCockpitVersions();
        const planKey = selectedPlan.value.planKey;
        flashHighlight(planKey);
        flashToast(
            `Plan ${planKey} wurde als v${result.planVersion.version} veröffentlicht — sichtbar im Katalog.`,
        );
        reviewDraft.value = null;
        draftEditing.value = null;
        mode.value = 'cockpit';
    } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[PlansPage] Publish fehlgeschlagen', err);
        reviewError.value = describePublishError(err);
    } finally {
        publishing.value = false;
    }
}

// ─── Archive / hard-delete Plan (trash icon when there's no open draft) ───
const archiveOpen = ref(false);
const archiving = ref(false);
const archiveError = ref<string | null>(null);
const archiveTarget = ref<PlanArchiveTarget | null>(null);

function onArchivePlanFromList(plan: PlanRow, hasLive: boolean): void {
    archiveTarget.value = { plan, hasLive };
    archiveError.value = null;
    archiveOpen.value = true;
}

async function executeArchive(): Promise<void> {
    if (!archiveTarget.value) return;
    const { plan } = archiveTarget.value;
    archiving.value = true;
    archiveError.value = null;
    try {
        // Hard-delete is the only path: published versions block deletion
        // server-side, drafts must be removed first via the discard route.
        // The UI aborts on both before this call is even reached.
        await hardDelete(plan.id);
        await reloadAllVersions();
        archiveOpen.value = false;
        flashToast(`Plan ${plan.planKey} komplett aus der DB gelöscht.`);
    } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[PlansPage] Archive/Purge fehlgeschlagen', err);
        const status = (err as { status?: number })?.status;
        const body = (err as { body?: { code?: string; message?: string } })?.body;
        const errMessage = err instanceof Error ? err.message : String(err);
        if (status === 422 && body?.code === 'PLAN_HAS_PUBLISHED_VERSIONS') {
            archiveError.value =
                body.message ??
                'Plan hat published Versionen — kann nicht gelöscht werden (Vertragsschutz P1).';
        } else if (status === 422 && body?.code === 'PLAN_HAS_DRAFTS') {
            archiveError.value =
                body.message ??
                'Plan hat noch einen offenen Draft — bitte erst über das Mülleimer-Icon verwerfen.';
        } else if (status === 422 && body?.code === 'PLAN_HARD_DELETE_NOT_IMPLEMENTED') {
            archiveError.value =
                'Backend unterstützt Hard-Delete noch nicht — API-Server neu bauen + starten.';
        } else if (status === 404) {
            archiveError.value = 'Plan wurde bereits entfernt (404). Liste wird neu geladen.';
            await reloadAllVersions();
        } else if (status !== undefined) {
            archiveError.value = body?.message ?? `Vorgang fehlgeschlagen (HTTP ${status}).`;
        } else {
            archiveError.value = `Vorgang fehlgeschlagen: ${errMessage}. Details siehe Browser-Konsole.`;
        }
    } finally {
        archiving.value = false;
    }
}

// ─── Discard draft (plan simulation: trash icon on the row) ───
const discardOpen = ref(false);
const discarding = ref(false);
const discardError = ref<string | null>(null);
const discardTarget = ref<PlanDiscardTarget | null>(null);

function onDiscardDraftFromList(plan: PlanRow, draft: PlanVersionRow): void {
    discardTarget.value = { plan, draft };
    discardError.value = null;
    discardOpen.value = true;
}

async function executeDiscard(): Promise<void> {
    if (!discardTarget.value) return;
    const { plan, draft } = discardTarget.value;
    discarding.value = true;
    discardError.value = null;
    try {
        // Per-Plan composable on demand, because the list usually doesn't have
        // a Plan's cockpit open. Doesn't persist into `planVersions` (that's
        // the cockpit composable); afterwards we reload the bulk state so the
        // list loses the removed draft immediately.
        const pv = usePlanVersions({
            adminEndpoint: props.adminEndpoint,
            planId: plan.id,
            http: props.http,
            getAuthToken: props.getAuthToken,
        });
        await pv.discardDraft(draft.id);
        await reloadAllVersions();
        discardOpen.value = false;
        flashToast(
            `Draft v${draft.version} von ${plan.planKey} verworfen — Live-Version unverändert.`,
        );
    } catch (err: unknown) {
        // Full error object to the console — in the diagnostic case you can see
        // e.g. CORS preflight errors or the real network stack there.
        // eslint-disable-next-line no-console
        console.error('[PlansPage] Discard fehlgeschlagen', err);

        const status = (err as { status?: number })?.status;
        const body = (err as { body?: { code?: string; message?: string } })?.body;
        const errMessage = err instanceof Error ? err.message : String(err);

        if (status === 422 && body?.code === 'PLAN_VERSION_ALREADY_PUBLISHED') {
            discardError.value =
                'Diese Version ist bereits published und kann nicht verworfen werden.';
        } else if (status === 422 && body?.code === 'PLAN_VERSION_DISCARD_NOT_IMPLEMENTED') {
            discardError.value =
                'Backend unterstützt das Verwerfen noch nicht — bitte API-Server neu bauen + starten.';
        } else if (status === 404) {
            discardError.value =
                'Draft wurde bereits entfernt (404) — Liste wird gleich neu geladen.';
            await reloadAllVersions();
        } else if (status !== undefined) {
            discardError.value = body?.message ?? `Verwerfen fehlgeschlagen (HTTP ${status}).`;
        } else {
            // No HTTP status → usually a network error / CORS preflight / failed
            // caller-side (e.g. usePlanVersions construction). Show the real
            // error message so the diagnostic path doesn't end at "HTTP ?".
            discardError.value = `Verwerfen fehlgeschlagen: ${errMessage}. Details siehe Browser-Konsole (oft: API-Server alt gebaut oder CORS blockiert DELETE).`;
        }
    } finally {
        discarding.value = false;
    }
}

// ─── Terminate (end date for a published version) ───
// Called by PlanDetail.vue as a prop callback. Uses the usePlanVersions
// composable of the current cockpit so the UI state (versions ref) stays
// consistent after the call.
async function onSubmitTerminate(versionId: string, endsAt: string): Promise<void> {
    if (!planVersions.value) {
        throw new Error('PlanVersions-Composable nicht initialisiert');
    }
    await planVersions.value.terminateVersion(versionId, endsAt);
    await reloadCockpitVersions();
    if (selectedPlan.value) {
        flashToast(
            `v${versions.value.find((v) => v.id === versionId)?.version ?? '?'} terminiert.`,
        );
    }
}

// ─── Publish ───
const publishOpen = ref(false);
const publishTarget = ref<PlanVersionRow | null>(null);
const publishing = ref(false);
const forceRegressive = ref(false);
const allowZeroPrice = ref(false);
const publishError = ref<string | null>(null);
const regressionChanges = ref<RegressionChange[]>([]);

function openPublish(row: PlanVersionRow): void {
    publishTarget.value = row;
    forceRegressive.value = false;
    allowZeroPrice.value = false;
    publishError.value = null;
    regressionChanges.value = [];
    publishOpen.value = true;
}

async function executePublish(): Promise<void> {
    if (!planVersions.value || !publishTarget.value) return;
    publishing.value = true;
    publishError.value = null;
    try {
        const result = await planVersions.value.publish(publishTarget.value.id, {
            forceRegressive: forceRegressive.value,
            allowZeroPrice: allowZeroPrice.value,
        });
        await reloadCockpitVersions();
        publishOpen.value = false;
        regressionChanges.value = [];
        if (selectedPlan.value) {
            flashHighlight(selectedPlan.value.planKey);
            flashToast(
                `Plan ${selectedPlan.value.planKey} wurde als v${result.planVersion.version} veröffentlicht — sichtbar im Katalog.`,
            );
        }
    } catch (err: unknown) {
        publishError.value = describePublishError(err);
        const body = (err as { body?: { code?: string; changes?: unknown } }).body;
        if (body?.code === 'PLAN_VERSION_REGRESSION' && Array.isArray(body.changes)) {
            regressionChanges.value = (body.changes as RegressionChange[]).filter(
                (c) => c.direction === 'REGRESSION',
            );
        } else {
            regressionChanges.value = [];
        }
    } finally {
        publishing.value = false;
    }
}

const REGRESSION_FIELD_LABELS: Record<string, string> = {
    monthlyNet: 'Preis (monatlich, netto)',
    yearlyNet: 'Preis (jährlich, netto)',
    'features.removed': 'Entfernte Features',
    'features.added': 'Hinzugefügte Features',
    'quotas.lowered': 'Gesenkte Quotas',
    'quotas.raised': 'Erhöhte Quotas',
    'bundles.removed': 'Entfernte Bundles',
    'bundles.added': 'Hinzugefügte Bundles',
};

function fieldLabel(field: string): string {
    return REGRESSION_FIELD_LABELS[field] ?? field;
}

function formatChangeValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) {
        return value.length === 0 ? '—' : (value as unknown[]).join(', ');
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return '—';
        return entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
    }
    return String(value);
}

// Translates a publish API error message into a displayable text.
// Shared by executePublish (cockpit dialog) and onReviewPublish (review
// screen).
function describePublishError(err: unknown): string {
    const status = (err as { status?: number })?.status;
    const body = (err as { body?: { code?: string; message?: string } })?.body;
    if (status === 401 || status === 403) {
        return 'Sitzung abgelaufen — bitte neu anmelden und erneut versuchen.';
    }
    if (status === 422 && body?.code === 'PLAN_VERSION_REGRESSION') {
        return 'Diese Version ist regressiv. Aktiviere "Force-Publish", wenn der Schritt absichtlich ist.';
    }
    if (status === 422 && body?.code === 'PLAN_VERSION_VALID_FROM_REQUIRED') {
        return 'Beim Publish muss "Gültig ab" gesetzt sein. Bitte den Draft öffnen und das Datum eintragen.';
    }
    if (status === 422 && body?.code === 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS') {
        return '"Gültig ab" muss strikt nach dem "Gültig ab" der Vorgänger-Version liegen. Bitte ein späteres Datum wählen.';
    }
    if (status === 422 && body?.code === 'PLAN_VERSION_ZERO_PRICE') {
        return 'Diese Version hat Preis 0,00 (Schutz gegen Seed-Platzhalter). Aktiviere "Preis 0,00 bewusst zulassen", wenn das ein gewollter kostenloser Sondervertrag ist.';
    }
    return body?.message ?? `Publish fehlgeschlagen (HTTP ${status ?? '?'})`;
}

watch(plans, async () => {
    if (plans.value.length > 0) {
        await Promise.all([reloadAllVersions(), loadTenantCounts()]);
    }
});

onMounted(async () => {
    await load();
    await Promise.all([loadEditorSources(), reloadAllVersions(), loadTenantCounts()]);
});
</script>

<style scoped>
.sa-plans {
    min-height: calc(100vh - 56px);
    background: #f6f7f9;
    position: relative;
}
.sa-plans__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px;
    color: #64748b;
    font-size: 14px;
}
</style>
