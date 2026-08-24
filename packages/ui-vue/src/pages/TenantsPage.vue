<template>
    <AdminPage class="sa-tenants">
        <AdminHero :title="msg.list.title" :subtitle="options?.subtitle" />

        <AdminBody>
            <AdminErrorBanner :error="error" />

            <AdminSection class="sa-tenants__card">
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="searchInput"
                        outlined
                        dense
                        clearable
                        :label="msg.list.searchPlaceholder"
                        debounce="250"
                        @update:model-value="applyFilter"
                    >
                        <template #prepend><q-icon name="search" size="18px" /></template>
                    </q-input>
                    <q-select
                        v-model="statusFilter"
                        outlined
                        dense
                        clearable
                        emit-value
                        map-options
                        :options="statusSelectOptions"
                        :label="msg.list.allStatuses"
                        @update:model-value="applyFilter"
                    />
                    <q-select
                        v-if="options?.planOptions && options?.planOptions.length > 0"
                        v-model="planFilter"
                        outlined
                        dense
                        clearable
                        :options="options?.planOptions"
                        :label="resolvedPlanFilterLabel"
                        @update:model-value="applyFilter"
                    />
                    <slot name="filters-extra" />
                </AdminFilters>

                <AdminTable
                    server-side
                    :rows="rows"
                    :columns="tenantColumns"
                    :loading="loading"
                    :page="page"
                    :rows-per-page="rowsPerPage"
                    :total="total"
                    :empty-text="msg.list.empty"
                    storage-key="tenants"
                    @update:page="goToPage"
                    @update:rows-per-page="setPageSize"
                >
                    <template #body-cell-tenant="{ row }">
                        <q-td>
                            <div class="sa-tenants__tenant">
                                <div class="sa-tenants__avatar" :style="avatarStyle(row)">
                                    {{ tenantInitials(row.name) }}
                                </div>
                                <div>
                                    <div class="sa-tenants__name">{{ row.name }}</div>
                                    <div class="sa-tenants__slug">{{ row.slug }}</div>
                                </div>
                            </div>
                        </q-td>
                    </template>

                    <template #body-cell-plan="{ row }">
                        <q-td>
                            <span class="sa-tenants__plan">
                                <span
                                    class="sa-tenants__plan-dot"
                                    :style="{ background: planAccentFor(row) }"
                                />
                                {{ planLabel(row) }}
                            </span>
                        </q-td>
                    </template>

                    <template #body-cell-status="{ row }">
                        <q-td>
                            <div class="sa-tenants__pills">
                                <slot name="status-pills" :row="row">
                                    <AdminStatusPill
                                        v-for="(p, i) in resolvedPills(row)"
                                        :key="i"
                                        :label="p.label"
                                        :icon="p.icon"
                                        :tone="p.tone"
                                    />
                                </slot>
                            </div>
                        </q-td>
                    </template>

                    <template #body-cell-usage="{ row }">
                        <q-td class="text-right">
                            <div
                                v-for="(uf, i) in options?.usageFields"
                                :key="i"
                                class="sa-tenants__usage"
                            >
                                <q-icon :name="uf.icon" size="11px" />
                                {{ usageValue(row, uf) }}
                            </div>
                        </q-td>
                    </template>

                    <template #body-cell-createdAt="{ row }">
                        <q-td class="text-right sa-tenants__mono">{{ formatCreatedAt(row) }}</q-td>
                    </template>

                    <template v-if="hasActions" #row-actions="{ row }">
                        <slot name="row-actions" :row="row" :actions="visibleActions(row)">
                            <component
                                :is="action.to ? 'a' : 'button'"
                                v-for="action in visibleActions(row)"
                                :key="action.id"
                                :href="action.to ? action.to(row) : undefined"
                                class="sa-icon-btn"
                                :class="action.tone ? `sa-icon-btn--${action.tone}` : ''"
                                :title="action.label"
                                @click="action.handler ? action.handler(row) : undefined"
                            >
                                <q-icon :name="action.icon" size="15px" />
                            </component>
                        </slot>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

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
    </AdminPage>
</template>

<script setup lang="ts">
import AdminTable from '../ui/data/AdminTable.vue';
import { LIST_PAGE_SIZE_DEFAULT } from '../client/resources/list-resource.js';
import { useResourceList } from '../vue/use-resource-list.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import { computed, ref, watch, type Ref } from 'vue';
import type { QTableColumn } from 'quasar';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import type { AdminManifest, TenantDto, TenantListFilter } from '@saasicat/core';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { usePlatformTenantActions } from '../vue/use-platform-tenant-actions.js';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import TenantActionConfirmDialog from '../features/tenant/TenantActionConfirmDialog.vue';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import type { PillTone } from '../vue/status.js';
import { identityChipStyle } from '../client/identity-accents.js';
import { formatDate, planAccent, tenantInitials } from '../internal/tenants/format.js';

// Platform standard page: tenant list.
//
// Default layout: avatar + slug subtitle, status pills, one
// configurable usage column (icon+field pairs), created-at date,
// optional actions column.
//
// App-specific bits via props:
//   - `subtitle`             : header subtitle
//   - `statusOptions`        : filter dropdown values (default: active/suspended)
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
//   - The resulting manifest actions are APPENDED to `props.options?.actions`. If the
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
/**
 * What an app may change about this page.
 *
 * One object rather than 17 props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind
 * the last one.
 */
export interface TenantsPageOptions {
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
}

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
/** Which row field carries the plan name, unless the app says otherwise. */
const DEFAULT_PLAN_FIELD = 'plan';
// On unless the app turns it off. `withDefaults` carried this before the props
// were grouped, and `options?.showPlanColumn` alone reads `undefined` as "off"
// — which silently removed a column from every app that never named it.
const DEFAULT_SHOW_PLAN_COLUMN = true;

const props = defineProps<{
    /**
     * Override the tenants resource for this page only — a different host,
     * or one operation wrapped. Layered over the app's own override; see
     * AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof tenantsResource)['ops']>;
    /** Presentation and capability. Never data, never a callback. */
    options?: TenantsPageOptions;
}>();

const msg = useSaMessages('tenants');
const common = useSaMessages('common');
const notify = useSuperAdminNotify();
const { intlLocale } = useSuperAdminI18n();

const statusSelectOptions = computed(() =>
    resolvedStatusOptions.value.map((o) => ({ label: o.label, value: o.value })),
);
const resolvedStatusOptions = computed<ReadonlyArray<{ value: string; label: string }>>(
    () =>
        props.options?.statusOptions ?? [
            { value: 'ACTIVE', label: common.value.active },
            { value: 'INACTIVE', label: msg.value.list.suspended },
        ],
);
const resolvedPlanFilterLabel = computed(
    () => props.options?.planFilterLabel ?? msg.value.list.allPlans,
);
const resolvedPlanColumnLabel = computed(() => props.options?.planColumnLabel ?? msg.value.plan);

const filter = ref<TenantListFilter>({});
const searchInput = ref('');
const statusFilter = ref<string | null>(null);
const planFilter = ref<string | null>(null);

// The list, from the resource registry. It used to be `useTenants` over an
// `endpoint` prop with the app's own `http` and token reader — three props for
// what the registry already knows, and three chances for a page to read from
// somewhere its siblings do not.
const list = useResourceList('tenants', {
    filter: filter as Ref<Record<string, unknown>>,
    pageSize: props.options?.pageSize,
    resources: props.resources,
});
// Aliased: the `pageSize` prop is the INITIAL size, `list.pageSize` is the
// current one. Sharing one name makes the template ambiguous about which of
// the two it reads.
const {
    items,
    page,
    pageSize: rowsPerPage,
    total,
    pending: loading,
    error,
    goToPage,
    setPageSize,
} = list;

setPageSize(props.options?.pageSize ?? LIST_PAGE_SIZE_DEFAULT);

// `TenantRow` is `TenantDto` widened with an index signature, because the table
// addresses cells by column name and an app may render a field the DTO does not
// declare. The resource answers with the DTO; this is where the two meet.
const rows = computed<TenantRow[]>(() => items.value as TenantRow[]);

const tenantColumns = computed<QTableColumn[]>(() => {
    const cols: QTableColumn[] = [
        { name: 'tenant', label: msg.value.tenant, field: 'name', align: 'left' },
    ];
    if (props.options?.showPlanColumn ?? DEFAULT_SHOW_PLAN_COLUMN) {
        cols.push({
            name: 'plan',
            label: resolvedPlanColumnLabel.value,
            field: 'plan',
            align: 'left',
        });
    }
    cols.push({ name: 'status', label: common.value.status, field: 'status', align: 'left' });
    if ((props.options?.usageFields?.length ?? 0) > 0) {
        cols.push({
            name: 'usage',
            label: msg.value.list.columnUsage,
            field: 'id',
            align: 'right',
        });
    }
    cols.push({
        name: 'createdAt',
        label: msg.value.list.columnCreatedAt,
        field: 'createdAt',
        align: 'right',
    });
    return cols;
});

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

// ── Manifest-Driven Action Flow (optional) ────────────────────────
// We derive all reactive defaults from the props so that apps can change the
// props dynamically later (e.g. manifest reload) without the page needing to
// be remounted.
const manifestActionsEnabled = computed(
    () => props.options?.manifest != null && props.options?.manifestActionsEnabled !== false,
);
const manifestRef = computed<AdminManifest | null>(() => props.options?.manifest ?? null);

const manifestFlow = manifestActionsEnabled.value
    ? usePlatformTenantActions<TenantRow>({
          manifest: manifestRef,
          // The notify port, not a prop: every consumer passed the same
          // three-line Quasar wrapper, and one that forgot saw failures only
          // as an unhandled rejection.
          notify: (kind, message) => notify(kind, message),
          onSuccess: () => {
              applyFilter();
          },
      })
    : null;

if (manifestFlow && typeof window !== 'undefined') {
    watch(
        manifestFlow.realOrphans,
        (orphans) => {
            if (orphans.length > 0) {
                console.warn(
                    '[PlatformTenantsPage] Manifest actions without a handler in createSuperAdminApp({ actions }):',
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
    const custom = (props.options?.actions ?? []).slice();
    const manifestList = manifestFlow ? manifestFlow.manifestActions.value : [];
    if (manifestList.length === 0) return custom;
    const manifestKeys = new Set(manifestList.map((a) => a.actionKey));
    const filteredCustom = custom.filter((a) => {
        if (a.actionKey && manifestKeys.has(a.actionKey)) {
            if (typeof window !== 'undefined') {
                console.warn(
                    `[PlatformTenantsPage] Custom action "${a.id}" (actionKey="${a.actionKey}") ` +
                        `collides with a manifest action — the manifest wins.`,
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
    const { background, color } = identityChipStyle(planAccentFor(row));
    return { background, color };
}

function planAccentFor(row: TenantRow): string {
    const planId = row[props.options?.planLabelField ?? DEFAULT_PLAN_FIELD] as
        string | null | undefined;
    return planAccent(planId, props.options?.planAccents);
}

function planLabel(row: TenantRow): string {
    const v = row[props.options?.planLabelField ?? DEFAULT_PLAN_FIELD];
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

function formatCreatedAt(row: TenantRow): string {
    return formatDate(usageStr(row, 'createdAt'), intlLocale.value);
}

/**
 * The pills a row shows by default.
 *
 * An app that wants different ones fills the `status-pills` slot, which
 * receives the row and already existed beside the `pillsForRow` prop this
 * replaces — two ways to answer one question, and the slot is the one that
 * can also render markup a pill list cannot express.
 */
function resolvedPills(row: TenantRow): StatusPillDef[] {
    const isActive = (row as TenantDto).isActive;
    return [
        isActive
            ? { label: common.value.active, icon: 'check_circle', tone: 'positive' }
            : { label: msg.value.list.suspended, icon: 'block', tone: 'negative' },
    ];
}

function visibleActions(row: TenantRow): TenantRowAction[] {
    return combinedActions.value.filter((a) => !a.condition || a.condition(row));
}
</script>

<style scoped>
/* No table rules here on purpose — and not because they would be inert.
   Content passed into a child component's slot keeps THIS component's scope
   id, so the `table`, `thead`, `th`, `td` and `.num` rules that used to sit
   here did reach `AdminTable`'s cells. That was the bug: they drew a second
   border on top of the one AdminTable already draws, and the tenant list was
   the only list in the package with doubled row separators. Removing them
   took `border-top-width` from 1px back to 0px.

   The rule to carry forward: styling a table here means overriding AdminTable
   for one page. If a table needs to look different, that belongs in
   AdminTable, behind a prop. */
.sa-tenants__mono {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: var(--sa-text-sm);
}

.sa-tenants__tenant {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-tenants__avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--sa-radius-field);
    font-weight: 800;
    font-size: var(--sa-text-sm);
    font-family: var(--sa-font-head, system-ui, sans-serif);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.sa-tenants__name {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sa-tenants__slug {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}

.sa-tenants__plan {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.sa-tenants__plan-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--sa-radius-badge);
}

.sa-tenants__pills {
    display: flex;
    gap: var(--sa-space-2);
    flex-wrap: wrap;
}

.sa-tenants__usage {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    margin-left: var(--sa-space-3);
}
.sa-tenants__usage :deep(.q-icon) {
    color: var(--sa-color-fg-muted);
}
</style>
