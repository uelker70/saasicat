<template>
    <div class="sa-tenants">
        <header class="sa-tenants__head">
            <div>
                <h1 class="sa-tenants__title">Mandanten</h1>
                <p v-if="subtitle" class="sa-tenants__sub">{{ subtitle }}</p>
            </div>
        </header>

        <div class="sa-tenants__filter">
            <div class="sa-tenants__search">
                <q-icon name="search" size="15px" />
                <input
                    v-model="searchInput"
                    placeholder="Slug oder Name …"
                    @input="reloadDebounced"
                />
                <button v-if="searchInput" class="sa-tenants__clear" @click="onClearSearch">
                    <q-icon name="close" size="13px" />
                </button>
            </div>
            <select v-model="statusFilter" class="sa-tenants__select" @change="applyFilter">
                <option :value="null">Alle Aktiv-Status</option>
                <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                </option>
            </select>
            <select
                v-if="planOptions && planOptions.length > 0"
                v-model="planFilter"
                class="sa-tenants__select"
                @change="applyFilter"
            >
                <option :value="null">{{ planFilterLabel }}</option>
                <option v-for="p in planOptions" :key="p" :value="p">{{ p }}</option>
            </select>
            <slot name="filters-extra" />
        </div>

        <q-banner v-if="error" class="bg-red-1 text-red-9 q-mb-md" rounded>
            <strong>Fehler:</strong> {{ error.message }}
        </q-banner>

        <div class="sa-tenants__card">
            <div class="sa-tenants__wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Mandant</th>
                            <th v-if="showPlanColumn">{{ planColumnLabel }}</th>
                            <th>Status</th>
                            <th v-if="usageFields.length > 0" class="num">Verbrauch</th>
                            <th class="num">Angelegt</th>
                            <th v-if="hasActions" class="num"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in items" :key="row.id">
                            <td>
                                <div class="sa-tenants__tenant">
                                    <div class="sa-tenants__avatar" :style="avatarStyle(row)">
                                        {{ tenantInitials(row.name) }}
                                    </div>
                                    <div>
                                        <div class="sa-tenants__name">{{ row.name }}</div>
                                        <div class="sa-tenants__slug">{{ row.slug }}</div>
                                    </div>
                                </div>
                            </td>
                            <td v-if="showPlanColumn">
                                <span class="sa-tenants__plan">
                                    <span
                                        class="sa-tenants__plan-dot"
                                        :style="{ background: planAccentFor(row) }"
                                    />
                                    {{ planLabel(row) }}
                                </span>
                            </td>
                            <td>
                                <div class="sa-tenants__pills">
                                    <slot name="status-pills" :row="row">
                                        <StatusPill
                                            v-for="(p, i) in resolvedPills(row)"
                                            :key="i"
                                            :label="p.label"
                                            :icon="p.icon"
                                            :tone="p.tone"
                                        />
                                    </slot>
                                </div>
                            </td>
                            <td v-if="usageFields.length > 0" class="num">
                                <div
                                    v-for="(uf, i) in usageFields"
                                    :key="i"
                                    class="sa-tenants__usage"
                                >
                                    <q-icon :name="uf.icon" size="11px" />
                                    {{ usageValue(row, uf) }}
                                </div>
                            </td>
                            <td class="num sa-tenants__mono">
                                {{ formatDateDe(usageStr(row, 'createdAt')) }}
                            </td>
                            <td v-if="hasActions" class="num sa-tenants__actions">
                                <slot name="row-actions" :row="row" :actions="visibleActions(row)">
                                    <component
                                        :is="action.to ? 'a' : 'button'"
                                        v-for="action in visibleActions(row)"
                                        :key="action.id"
                                        :href="action.to ? action.to(row) : undefined"
                                        class="sa-tenants__icon-btn"
                                        :class="
                                            action.tone
                                                ? `sa-tenants__icon-btn--${action.tone}`
                                                : ''
                                        "
                                        :title="action.label"
                                        @click="action.handler ? action.handler(row) : undefined"
                                    >
                                        <q-icon :name="action.icon" size="15px" />
                                    </component>
                                </slot>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="items.length === 0 && !loading" class="sa-tenants__empty">
                    <q-icon name="search_off" size="32px" />
                    <div>Keine Mandanten mit diesen Filtern.</div>
                </div>
                <div v-if="loading" class="sa-tenants__loading">
                    <q-spinner size="20px" /> wird geladen…
                </div>
            </div>
        </div>

        <footer class="sa-tenants__foot">
            {{ total }} Mandanten · Seite {{ page }} /
            {{ Math.max(1, Math.ceil(total / pageSize)) }}
        </footer>

        <!-- Manifest-Driven Action Flow: only mounted when the `manifest` prop
             is set AND `manifestActionsEnabled` is true (default when manifest
             is set). Apps without a manifest flow do not need to duplicate the
             dialog mounts. -->
        <template v-if="manifestFlow">
            <MfaPromptDialog
                v-model="manifestFlow.mfa.value.show"
                :description="manifestFlow.mfa.value.description"
                :error="manifestFlow.mfa.value.error"
                @update:model-value="manifestFlow.onMfaDialogVisibility"
                @confirm="manifestFlow.onMfaConfirm"
            />
            <TenantActionConfirmDialog
                v-model="manifestFlow.confirmDialog.value.show"
                :def="manifestFlow.confirmDialog.value.def"
                :row="manifestFlow.confirmDialog.value.row"
                @update:model-value="manifestFlow.onConfirmDialogVisibility"
                @submit="manifestFlow.onConfirmSubmit"
                @cancel="manifestFlow.onConfirmCancel"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    AdminManifest,
    TenantActionDef,
    TenantDto,
    TenantListFilter,
} from '@saasicat/types';
import type { HttpClient } from '../types.js';
import { useTenants } from '../use-tenants.js';
import {
    usePlatformTenantActions,
    type PlatformTenantActionTone,
} from '../use-platform-tenant-actions.js';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import TenantActionConfirmDialog from '../components/TenantActionConfirmDialog.vue';
import StatusPill, { type PillTone } from './tenants/StatusPill.vue';
import {
    DEFAULT_PLAN_ACCENTS,
    formatDateDe,
    planAccent,
    tenantInitials,
} from './tenants/format.js';

// Platform standard page: tenant list.
//
// Default layout: avatar + slug subtitle, status pills, one
// configurable usage column (icon+field pairs), created-at date,
// optional actions column.
//
// App-specific bits via props:
//   - `subtitle`             : header subtitle
//   - `statusOptions`        : filter dropdown values (default: Aktiv/Suspendiert)
//   - `planOptions`          : filter dropdown values for plan; omitted = hides dropdown
//   - `planAccents`          : plan id → accent color (avatar + plan dot)
//   - `planLabelField`       : field for the plan display (e.g. "plan" or "bundleKey")
//   - `usageFields`          : usage columns (icon + field), e.g.
//                              [{icon:'person',field:'users'},{icon:'directions_car',field:'vehicles'}]
//   - `pillsForRow`          : (row) => pills (Pilot/Trial/etc.)
//   - `actions`              : per-row action buttons with optional `tone` and
//                              `condition`
//
// Slots:
//   - `#filters-extra`       : additional filters
//   - `#status-pills`        : override the pills entirely
//   - `#row-actions`         : override the actions column (e.g. to render
//                              only a detail link and process the manifest
//                              actions alongside via the `manifestActions`
//                              slot prop)
//
// Manifest-Driven Action Flow (optional):
//   - When the `manifest` prop is set AND `manifestActionsEnabled` (default
//     `true` when `manifest` is set), the page takes over the full
//     Confirm→MFA→handler orchestration (`useTenantActionFlow`) incl.
//     dialog mounts (`MfaPromptDialog` + `TenantActionConfirmDialog`).
//     Apps then no longer need to write the state/resolver boilerplate
//     themselves.
//   - The resulting manifest actions are APPENDED to `props.actions`. If the
//     same `actionKey` is declared both as a custom action and in the
//     manifest, the manifest action wins — the custom one is filtered out
//     + a warning in the console.
//   - In the `#row-actions` slot the combined list is provided via the
//     `actions` slot prop; apps with a custom slot render it themselves.

/**
 * Row type accepted by all configuration functions (pillsForRow,
 * action.handler, etc.). Apps pass their own tenant row shapes through —
 * `TenantDto` forms the platform minimum, app fields are added via an index
 * signature (plan, usage, isPilot, etc.).
 */
export type TenantRow = TenantDto & Record<string, unknown>;

export interface StatusPillDef {
    label: string;
    icon?: string;
    tone: PillTone;
}

export interface UsageField {
    icon: string;
    field: string;
    /** Optional: format function (default: String(val)). */
    format?: (val: unknown, row: TenantRow) => string;
}

export interface TenantRowAction {
    id: string;
    label: string;
    icon: string;
    tone?: 'positive' | 'negative' | 'muted' | 'primary' | 'warning' | 'accent';
    /**
     * Optional, but recommended for custom actions that have the same behavior
     * as a manifest action (e.g. `tenants.suspend`). Used for the dedup logic
     * against manifest actions.
     */
    actionKey?: string;
    /** If set, renders an anchor with href instead of a button. */
    to?: (row: TenantRow) => string;
    handler?: (row: TenantRow) => void;
    /** If set, the action is only rendered when truthy. */
    condition?: (row: TenantRow) => boolean;
}

// `endpoint` is mandatory — the platform does not know the app's globalPrefix
// (e.g. `/api/admin/tenants` or `/api/v1/admin/tenants`).
// A hardcoded default would ALWAYS serve some app incorrectly.
const props = withDefaults(
    defineProps<{
        endpoint: string;
        getAuthToken?: () => string | null;
        http?: HttpClient;
        pageSize?: number;
        subtitle?: string;
        statusOptions?: ReadonlyArray<{ value: string; label: string }>;
        planOptions?: readonly string[];
        planFilterLabel?: string;
        planColumnLabel?: string;
        showPlanColumn?: boolean;
        planLabelField?: string;
        planAccents?: Record<string, string>;
        usageFields?: readonly UsageField[];
        pillsForRow?: (row: TenantRow) => StatusPillDef[];
        actions?: readonly TenantRowAction[];
        /**
         * Manifest source for the Manifest-Driven Action Flow. When set, the
         * page internally mounts MfaPromptDialog + TenantActionConfirmDialog
         * and appends manifest actions to `actions`.
         */
        manifest?: AdminManifest | null;
        /**
         * Toggles the manifest-driven orchestration on/off. Default `true`
         * when `manifest` is set — apps can explicitly disable the flow.
         */
        manifestActionsEnabled?: boolean;
        /**
         * Row-specific filter for manifest actions. Default: `suspend` only
         * for active tenants, `reactivate` only for inactive ones, otherwise
         * visible.
         */
        visibleForRow?: (def: TenantActionDef, row: TenantRow) => boolean;
        /**
         * Manifest action → icon. For the default mapping see
         * `defaultIconForActionKey` in `use-platform-tenant-actions.ts`.
         */
        iconForActionKey?: (actionKey: string) => string;
        /**
         * Manifest action → tone. Default: suspend/revoke→negative,
         * reactivate/grant→positive, otherwise→primary.
         */
        toneForActionKey?: (actionKey: string) => PlatformTenantActionTone['tone'];
        /** Optional: MFA dialog description. */
        mfaDescription?: (def: TenantActionDef, row: TenantRow) => string;
        /**
         * Success hook after action dispatch. Default: page.reload(). Apps with
         * additional refresh needs can override the hook.
         */
        onActionSuccess?: () => Promise<void> | void;
        /**
         * Notify provider (toast/snackbar) for success/failure of the manifest
         * actions. Default is a no-op — apps with Quasar typically pass in
         * `(k, m) => $q.notify({ type: k, message: m, position: 'top' })`.
         * Without notify, errors are only visible as a promise rejection.
         */
        actionNotify?: (kind: 'positive' | 'negative', message: string) => void;
    }>(),
    {
        pageSize: 25,
        statusOptions: () => [
            { value: 'ACTIVE', label: 'Aktiv' },
            { value: 'INACTIVE', label: 'Suspendiert' },
        ],
        planFilterLabel: 'Alle Pläne',
        planColumnLabel: 'Plan',
        showPlanColumn: true,
        planLabelField: 'plan',
        planAccents: () => DEFAULT_PLAN_ACCENTS,
        usageFields: () => [],
        manifest: null,
    },
);

const filter = ref<TenantListFilter>({});
const searchInput = ref('');
const statusFilter = ref<string | null>(null);
const planFilter = ref<string | null>(null);

const list = useTenants<TenantRow>({
    endpoint: props.endpoint,
    filter,
    http: props.http,
    getAuthToken: props.getAuthToken,
});
const { items, page, total, loading, error, goToPage, setPageSize } = list;

setPageSize(props.pageSize);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function reloadDebounced(): void {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 250);
}

function onClearSearch(): void {
    searchInput.value = '';
    applyFilter();
}

function applyFilter(): void {
    // The status value is passed through unchanged. Apps configure the values
    // their backend expects via `statusOptions` (e.g. 'ACTIVE'/'INACTIVE';
    // platform default: 'active'/'suspended').
    filter.value = {
        ...filter.value,
        search: searchInput.value || undefined,
        status: (statusFilter.value || undefined) as TenantListFilter['status'],
        plan: planFilter.value ?? undefined,
    };
    void goToPage(1);
}

defineExpose({ reload: applyFilter });

watch(
    () => props.endpoint,
    () => void goToPage(1),
);

// ── Manifest-Driven Action Flow (optional) ────────────────────────
// We derive all reactive defaults from the props so that apps can change the
// props dynamically later (e.g. manifest reload) without the page needing to
// be remounted.
const manifestActionsEnabled = computed(
    () => props.manifest != null && props.manifestActionsEnabled !== false,
);
const manifestRef = computed<AdminManifest | null>(() => props.manifest ?? null);

const manifestFlow = manifestActionsEnabled.value
    ? usePlatformTenantActions<TenantRow>({
          manifest: manifestRef,
          notify: (kind, message) => {
              props.actionNotify?.(kind, message);
          },
          onSuccess: async () => {
              if (props.onActionSuccess) {
                  await props.onActionSuccess();
              } else {
                  applyFilter();
              }
          },
          visibleForRow: props.visibleForRow,
          mfaDescription: props.mfaDescription,
          iconForActionKey: props.iconForActionKey,
          toneForActionKey: props.toneForActionKey,
      })
    : null;

if (manifestFlow && typeof window !== 'undefined') {
    watch(
        manifestFlow.realOrphans,
        (orphans) => {
            if (orphans.length > 0) {
                // eslint-disable-next-line no-console
                console.warn(
                    '[PlatformTenantsPage] Manifest-Actions ohne Handler in createSuperAdminApp({ actions }):',
                    orphans,
                );
            }
        },
        { immediate: true },
    );
}

// Combined action list: custom actions (via the `actions` prop) + manifest
// actions. On a duplicate `actionKey` the manifest action wins — the custom
// one is filtered out + a warning, so app devs see the conflict.
const combinedActions = computed<TenantRowAction[]>(() => {
    const custom = (props.actions ?? []).slice();
    const manifestList = manifestFlow ? manifestFlow.manifestActions.value : [];
    if (manifestList.length === 0) return custom;
    const manifestKeys = new Set(manifestList.map((a) => a.actionKey));
    const filteredCustom = custom.filter((a) => {
        if (a.actionKey && manifestKeys.has(a.actionKey)) {
            if (typeof window !== 'undefined') {
                // eslint-disable-next-line no-console
                console.warn(
                    `[PlatformTenantsPage] Custom-Action "${a.id}" (actionKey="${a.actionKey}") ` +
                        `kollidiert mit Manifest-Action — Manifest gewinnt.`,
                );
            }
            return false;
        }
        return true;
    });
    return [...filteredCustom, ...manifestList];
});

const hasActions = computed(() => combinedActions.value.length > 0);

function avatarStyle(row: TenantRow): Record<string, string> {
    const accent = planAccentFor(row);
    return { background: `${accent}18`, color: accent };
}

function planAccentFor(row: TenantRow): string {
    const planId = row[props.planLabelField] as string | null | undefined;
    return planAccent(planId, props.planAccents);
}

function planLabel(row: TenantRow): string {
    const v = row[props.planLabelField];
    return v != null ? String(v) : '—';
}

function usageValue(row: TenantRow, uf: UsageField): string {
    const v = row[uf.field];
    if (uf.format) return uf.format(v, row);
    return v == null ? '—' : String(v);
}

function usageStr(row: TenantRow, key: string): string | undefined {
    const v = row[key];
    return typeof v === 'string' ? v : undefined;
}

function resolvedPills(row: TenantRow): StatusPillDef[] {
    if (props.pillsForRow) return props.pillsForRow(row);
    // Default: only Aktiv/Suspendiert.
    const isActive = (row as TenantDto).isActive;
    return [
        isActive
            ? { label: 'Aktiv', icon: 'check_circle', tone: 'positive' }
            : { label: 'Suspendiert', icon: 'block', tone: 'negative' },
    ];
}

function visibleActions(row: TenantRow): TenantRowAction[] {
    return combinedActions.value.filter((a) => !a.condition || a.condition(row));
}
</script>

<style scoped>
.sa-tenants {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
}
.sa-tenants__head {
    padding: 20px 28px 8px;
}
.sa-tenants__title {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
    color: var(--sa-heading, #0f172a);
    letter-spacing: -0.01em;
}
.sa-tenants__sub {
    margin: 4px 0 0;
    color: var(--sa-muted-dark, #475569);
    font-size: 13.5px;
    line-height: 1.5;
}

.sa-tenants__filter {
    padding: 12px 28px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}
.sa-tenants__search {
    flex: 1;
    min-width: 240px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    padding: 6px 10px;
}
.sa-tenants__search :deep(.q-icon) {
    color: var(--sa-muted, #64748b);
}
.sa-tenants__search input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    font-family: inherit;
    color: var(--sa-body, #1e293b);
    min-width: 0;
}
.sa-tenants__clear {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
}
.sa-tenants__select {
    padding: 7px 10px;
    font-size: 12.5px;
    font-family: inherit;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
}

.sa-tenants__card {
    margin: 0 28px 28px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.sa-tenants__wrap {
    overflow-x: auto;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    min-width: 800px;
}
thead tr {
    background: #fafbfc;
}
th {
    padding: 10px 14px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    text-align: left;
}
td {
    padding: 11px 14px;
    vertical-align: middle;
    border-top: 1px solid var(--sa-border-soft, #f1f5f9);
}
.num {
    text-align: right;
}
.sa-tenants__mono {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 12px;
}

.sa-tenants__tenant {
    display: flex;
    align-items: center;
    gap: 10px;
}
.sa-tenants__avatar {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    font-weight: 800;
    font-size: 12px;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.sa-tenants__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-heading, #0f172a);
}
.sa-tenants__slug {
    font-size: 11px;
    color: var(--sa-muted, #64748b);
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}

.sa-tenants__plan {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.sa-tenants__plan-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
}

.sa-tenants__pills {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

.sa-tenants__usage {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--sa-muted-dark, #475569);
    margin-left: 8px;
}
.sa-tenants__usage :deep(.q-icon) {
    color: var(--sa-muted, #64748b);
}

.sa-tenants__actions {
    white-space: nowrap;
}
.sa-tenants__icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: var(--sa-muted, #64748b);
}
.sa-tenants__icon-btn:hover {
    background: #f1f5f9;
}
.sa-tenants__icon-btn :deep(.q-icon) {
    color: inherit;
}
.sa-tenants__icon-btn--negative {
    color: var(--sa-negative, #dc2626);
}
.sa-tenants__icon-btn--positive {
    color: var(--sa-positive, #047857);
}
.sa-tenants__icon-btn--primary {
    color: var(--sa-primary, #3f6bff);
}
.sa-tenants__icon-btn--warning {
    color: var(--sa-warning, #d97706);
}
.sa-tenants__icon-btn--accent {
    color: var(--sa-accent, #7c3aed);
}

.sa-tenants__empty {
    padding: 40px 16px;
    text-align: center;
    color: var(--sa-muted, #64748b);
}
.sa-tenants__loading {
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--sa-muted, #64748b);
}

.sa-tenants__foot {
    padding: 0 28px 28px;
    text-align: right;
    font-size: 12px;
    color: var(--sa-muted, #64748b);
}
</style>
