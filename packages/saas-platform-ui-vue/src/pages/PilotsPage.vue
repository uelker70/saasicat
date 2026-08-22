<template>
    <AdminPage class="sa-pilots">
        <AdminHero
            :title="msg.title"
            :subtitle="formatMessage(msg.subtitleCount, { count: rows.length })"
        >
            <template #actions>
                <slot name="head-options?.actions">
                    <button
                        v-if="options?.enableCreate"
                        class="sa-btn sa-btn--primary"
                        type="button"
                        @click="showCreate = true"
                    >
                        <q-icon name="add" size="16px" />
                        <span>{{ resolvedCreateLabel }}</span>
                    </button>
                </slot>
            </template>
        </AdminHero>

        <AdminBody>
            <AdminStatistics :label="msg.title">
                <AdminKpi
                    v-for="tile in statTiles"
                    :key="tile.id"
                    :label="tile.label"
                    :value="tile.count"
                    :sub="tile.hint"
                    :tone="tile.tone"
                    :selected="filter === tile.id"
                    :action="() => (filter = tile.id)"
                />
            </AdminStatistics>

            <AdminBanner v-if="reviewSoon.length" tone="warning" icon="event">
                {{ formatMessage(msg.list.reviewSoonBanner, { count: reviewSoon.length }) }}
            </AdminBanner>

            <AdminSection class="sa-pilots__card">
                <AdminTable
                    :rows="filteredRows"
                    :columns="effectiveColumns"
                    :loading="loading"
                    storage-key="pilots"
                >
                    <template #row-actions="{ row }">
                        <slot name="row-actions" :row="row">
                            <button
                                v-for="action in visibleActions(row)"
                                :key="action.id"
                                type="button"
                                class="sa-icon-btn"
                                :class="action.color === 'negative' ? 'sa-icon-btn--negative' : ''"
                                :title="action.label"
                                @click="action.handler(row)"
                            >
                                <q-icon :name="action.icon" size="18px" />
                            </button>
                        </slot>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <PilotCreateDialog
            v-if="options?.enableCreate"
            v-model="showCreate"
            :plan-options="effectiveCreatePlanOptions"
            :default-plan="defaultPlan"
            :copy="options?.copy"
            :require-mfa="options?.requireMfa"
            :mfa-setup-hint="options?.mfaSetupHint"
            :submit="pilots.create"
            @created="onCreated"
        />

        <PilotEditDialog
            v-if="options?.enableEdit"
            v-model="showEdit"
            :row="editRow"
            :plan-options="bakedPlanOptions"
            :copy="options?.copy"
            :require-mfa="options?.requireMfa"
            :mfa-setup-hint="options?.mfaSetupHint"
            :submit="pilots.update"
            @updated="onUpdated"
        />

        <MfaPromptDialog
            v-if="needsMfaDialog"
            :model-value="mfa.show.value"
            :description="mfa.description.value"
            :error="mfa.error.value"
            :setup-hint="options?.mfaSetupHint"
            @update:model-value="mfa.onVisibility"
            @confirm="mfa.onConfirm"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import AdminTable from '../ui/data/AdminTable.vue';
import type { PilotRow } from '../internal/dialogs/types.js';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { pilotsResource } from '../client/resources/pilots.resource.js';
import type { plansResource } from '../client/resources/plans.resource.js';
import { adminErrorMessage } from '../client/admin-error.js';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import { computed, onMounted, ref } from 'vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminKpi from '../ui/data/AdminKpi.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminStatistics from '../ui/data/AdminStatistics.vue';
import PilotCreateDialog from '../internal/dialogs/PilotCreateDialog.vue';
import PilotEditDialog from '../internal/dialogs/PilotEditDialog.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import { useSuperAdminConfirm } from '../quasar/confirm.js';
import type { PilotCopy, PilotCreateResult, PilotEditResult } from '../internal/dialogs/types.js';

// Platform standard page: pilot tenants. Data-agnostic.
//
// Optional baked-in flows: consumers can set `enableCreate/Edit/Extend/Revoke`
// + provide the matching `submit*` callbacks, then the page mounts the
// dialogs itself and appends the default actions to the `actions` prop.
// Anyone needing more control (e.g. MFA flows) omits enable* and provides
// the actions/dialogs themselves as before — no behavior change.

export type { PilotRow } from '../internal/dialogs/types.js';

/**
 * What an app may change about this page.
 *
 * One object rather than 21 props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind
 * the last one.
 */
export interface PilotsPageOptions {
    actions?: readonly PilotRowAction[];
    enableCreate?: boolean;
    enableEdit?: boolean;
    enableExtend?: boolean;
    enableRevoke?: boolean;
    /** Tenant vocabulary for the create/edit dialog (neutral defaults otherwise). */
    copy?: PilotCopy;
    /** Static plan options (alternative to loadPlanOptions). */
    createPlanOptions?: readonly (string | PilotPlanOption)[];
    defaultCreatePlan?: string;
    /** MFA requirement for the create/edit dialog (passed through to sub-dialogs). */
    requireMfa?: boolean;
    /** Per-flow MFA for Extend — shows MfaPromptDialog after the date prompt. */
    requireMfaForExtend?: boolean;
    /** Per-flow MFA for Revoke — shows MfaPromptDialog after the confirm prompt. */
    requireMfaForRevoke?: boolean;
    mfaSetupHint?: string;
    createLabel?: string;
    defaultActions?: readonly PilotDefaultActionId[];
}

export interface PilotRowAction {
    id: string;
    label: string;
    icon: string;
    color?: string;
    condition?: (row: PilotRow) => boolean;
    handler: (row: PilotRow) => void;
}

/** Plan option for the built-in create/edit dialog. */
export interface PilotPlanOption {
    label: string;
    value: string;
    color?: string;
}

export type PilotDefaultActionId = 'edit' | 'extend' | 'revoke';

/** The row actions a page offers when the app names none. */
const DEFAULT_PILOT_ACTIONS: readonly PilotDefaultActionId[] = ['edit', 'extend', 'revoke'];

const props = defineProps<{
    /**
     * Override the pilots or plans resource for this page only. Layered
     * over the app's own override; see AP3 §3.2.
     */
    resources?: {
        pilots?: ResourceOverride<(typeof pilotsResource)['ops']>;
        plans?: ResourceOverride<(typeof plansResource)['ops']>;
    };
    /** Presentation and capability. Never data, never a callback. */
    options?: PilotsPageOptions;
}>();

const msg = useSaMessages('pilots');
const errors = useSaMessages('errors');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();
const resolvedCreateLabel = computed(() => props.options?.createLabel ?? msg.value.createAction);

const notify = useSuperAdminNotify();
// `confirm` is taken — `window.confirm` shadows it and the typechecker says so.
const askConfirm = useSuperAdminConfirm();

// The data layer, reached by name. Pilots are served by the consuming app, not
// by the platform — the descriptor records the paths every consumer already
// calls, so the page needs none of the seven callbacks it used to take.
const pilots = useResource('pilots', props.resources?.pilots);
const plansOps = useResource('plans', props.resources?.plans);
const rows = ref<PilotRow[]>([]);
const reviewSoon = ref<PilotRow[]>([]);
const loading = ref(false);

const showCreate = ref(false);
const showEdit = ref(false);
const editRow = ref<PilotRow | null>(null);
const bakedPlanOptions = ref<PilotPlanOption[]>([]);

// Per-flow MFA for extend/revoke: `runWithMfa` awaits `mfa.prompt`, which
// resolves with the code or with null when the user closes the dialog.
const mfa = useMfaPrompt();
const needsMfaDialog = computed(
    () => props.options?.requireMfaForExtend || props.options?.requireMfaForRevoke,
);

// Consumers can set `createPlanOptions` instead of `loadPlanOptions`
// (e.g. apps with a hard-coded plan list).
const effectiveCreatePlanOptions = computed<readonly (string | PilotPlanOption)[]>(() => {
    if (props.options?.createPlanOptions && props.options?.createPlanOptions.length > 0) {
        return props.options?.createPlanOptions;
    }
    return bakedPlanOptions.value;
});
const defaultPlan = computed<string | undefined>(() => {
    if (props.options?.defaultCreatePlan) return props.options?.defaultCreatePlan;
    const first = effectiveCreatePlanOptions.value[0];
    if (!first) return undefined;
    return typeof first === 'string' ? first : first.value;
});

// Stat pill filter — analogous to the plan-simulation pilots.jsx:
//   all | active | expiring (≤14 days) | expired.
const EXPIRING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
type StatusFilter = 'all' | 'active' | 'expiring' | 'expired';
const filter = ref<StatusFilter>('all');

function classifyRow(row: PilotRow): Exclude<StatusFilter, 'all'> {
    if (!row.pilotEndsAt) return 'active';
    const t = new Date(row.pilotEndsAt).getTime();
    if (Number.isNaN(t)) return 'active';
    const now = Date.now();
    if (t <= now) return 'expired';
    if (t - now <= EXPIRING_WINDOW_MS) return 'expiring';
    return 'active';
}

const filteredRows = computed(() => {
    if (filter.value === 'all') return rows.value;
    return rows.value.filter((r) => classifyRow(r) === filter.value);
});

const statTiles = computed<
    Array<{
        id: StatusFilter;
        label: string;
        count: number;
        tone?: 'positive' | 'warn' | 'danger';
        hint?: string;
    }>
>(() => {
    const counts = { all: rows.value.length, active: 0, expiring: 0, expired: 0 };
    for (const r of rows.value) counts[classifyRow(r)]++;
    return [
        { id: 'all', label: common.value.all, count: counts.all },
        { id: 'active', label: common.value.active, count: counts.active, tone: 'positive' },
        {
            id: 'expiring',
            label: msg.value.list.tileExpiring,
            count: counts.expiring,
            tone: 'warn',
            hint: msg.value.list.tileExpiringHint,
        },
        { id: 'expired', label: common.value.expired, count: counts.expired, tone: 'danger' },
    ];
});

const baseColumns = computed(() => [
    {
        name: 'slug',
        label: msg.value.list.columnSlug,
        field: (r: PilotRow) => r.tenant.slug,
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'name',
        label: common.value.name,
        field: (r: PilotRow) => r.tenant.name,
        align: 'left' as const,
    },
    { name: 'plan', label: msg.value.list.columnPlan, field: 'plan', align: 'left' as const },
    {
        name: 'note',
        label: msg.value.list.columnNote,
        field: (r: PilotRow) => r.pilotNote ?? '—',
        align: 'left' as const,
    },
    {
        name: 'grantedBy',
        label: msg.value.list.columnGrantedBy,
        field: (r: PilotRow) => r.grantedBy ?? '—',
        align: 'left' as const,
    },
    {
        name: 'pilotEndsAt',
        label: msg.value.list.columnEndsAt,
        field: (r: PilotRow) => formatDate(r.pilotEndsAt) ?? '∞',
        align: 'left' as const,
    },
]);

// Built-in default actions (edit/extend/revoke) — are APPENDED to the
// consumer `actions`, not replaced. Order follows the `defaultActions` prop.
const bakedActions = computed<PilotRowAction[]>(() => {
    const out: PilotRowAction[] = [];
    for (const id of props.options?.defaultActions ?? DEFAULT_PILOT_ACTIONS) {
        if (id === 'edit' && props.options?.enableEdit) {
            out.push({
                id: 'edit',
                label: common.value.edit,
                icon: 'edit',
                color: 'primary',
                handler: (row) => onEditClick(row),
            });
        } else if (id === 'extend' && props.options?.enableExtend) {
            out.push({
                id: 'extend',
                label: msg.value.list.actionExtend,
                icon: 'event_repeat',
                color: 'primary',
                handler: (row) => onExtendClick(row),
            });
        } else if (id === 'revoke' && props.options?.enableRevoke) {
            out.push({
                id: 'revoke',
                label: msg.value.list.actionRevoke,
                icon: 'block',
                color: 'negative',
                handler: (row) => onRevokeClick(row),
            });
        }
    }
    return out;
});

const mergedActions = computed<readonly PilotRowAction[]>(() => [
    ...(props.options?.actions ?? []),
    ...bakedActions.value,
]);

const effectiveColumns = computed(() => {
    const cols = [...baseColumns.value];
    return cols;
});

function visibleActions(row: PilotRow): PilotRowAction[] {
    return mergedActions.value.filter((a) => !a.condition || a.condition(row));
}

async function reload() {
    loading.value = true;
    try {
        rows.value = await pilots.list();
        {
            try {
                reviewSoon.value = await pilots.reviewSoon();
            } catch {
                reviewSoon.value = [];
            }
        }
    } catch (err) {
        rows.value = [];
        console.warn('[PilotsPage] loadPilots failed:', err);
    } finally {
        loading.value = false;
    }
}

defineExpose({ reload });

/**
 * The plans a pilot can be put on, from the platform's plan list.
 *
 * A failure leaves the list empty rather than propagating: the create dialog
 * degrades to a free-text plan key, which is worse than a picker and much
 * better than a page that will not open.
 */
async function reloadPlanOptions(): Promise<void> {
    try {
        const plans = await plansOps.list();
        bakedPlanOptions.value = plans.map((plan) => ({
            label: plan.label ?? plan.planKey,
            value: plan.planKey,
        }));
    } catch {
        bakedPlanOptions.value = [];
    }
}

onMounted(() => {
    void reload();
    void reloadPlanOptions();
});

function onEditClick(row: PilotRow): void {
    editRow.value = row;
    showEdit.value = true;
}

function onUpdated(result: PilotEditResult): void {
    notify('positive', formatMessage(msg.value.list.updatedNotice, { slug: result.slug }), {
        caption: result.changed?.length
            ? formatMessage(msg.value.list.updatedChangedCaption, {
                  fields: result.changed.join(', '),
              })
            : undefined,
    });
    void reload();
}

function onCreated(result: PilotCreateResult): void {
    notify('positive', formatMessage(msg.value.list.createdNotice, { slug: result.slug }), {
        caption: result.initialPassword
            ? formatMessage(msg.value.list.createdPasswordCaption, {
                  password: result.initialPassword,
              })
            : undefined,
        timeoutMs: 8000,
    });
    void reload();
}

// Called by the MFA submit — on HTTP 401 the MFA dialog stays open
// so the user can correct the code. Otherwise notify+close+reload.
async function runAction(
    actionLabel: string,
    successMessage: string,
    requireMfa: boolean,
    invoke: (code: string) => Promise<void>,
): Promise<void> {
    if (!requireMfa) {
        try {
            await invoke('');
            notify('positive', successMessage);
            await reload();
        } catch (err) {
            notify('negative', adminErrorMessage(err, errors.value));
        }
        return;
    }
    // MFA loop: as long as the server returns 401, keep the dialog open and
    // wait again for a code. Cancelling (resolver === null) ends it.
    while (true) {
        const code = await mfa.prompt(actionLabel);
        if (code === null) return;
        try {
            await invoke(code);
            mfa.show.value = false;
            notify('positive', successMessage);
            await reload();
            return;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfa.error.value = msg.value.mfa.invalidOrNotSetUp;
                continue;
            }
            mfa.show.value = false;
            notify('negative', adminErrorMessage(err, errors.value));
            return;
        }
    }
}

async function onExtendClick(row: PilotRow): Promise<void> {
    const { ok, value: until } = await askConfirm({
        title: formatMessage(msg.value.list.extendTitle, { slug: row.tenant.slug }),
        message: msg.value.list.extendMessage,
        confirmLabel: msg.value.list.actionExtend,
        cancelLabel: common.value.cancel,
        prompt: { initial: row.pilotEndsAt?.slice(0, 10) ?? '', type: 'date' },
    });
    if (!ok || !until) return;

    await runAction(
        formatMessage(msg.value.list.extendMfaDescription, { slug: row.tenant.slug, until }),
        formatMessage(msg.value.list.extendSuccess, { until }),
        !!props.options?.requireMfaForExtend,
        (code) => pilots.extend(row.tenant.slug, until, code),
    );
}

async function onRevokeClick(row: PilotRow): Promise<void> {
    const { ok } = await askConfirm({
        title: formatMessage(msg.value.list.revokeTitle, { slug: row.tenant.slug }),
        message: msg.value.list.revokeMessage,
        confirmLabel: msg.value.list.actionRevoke,
        cancelLabel: common.value.cancel,
        tone: 'negative',
    });
    if (!ok) return;

    await runAction(
        formatMessage(msg.value.list.revokeMfaDescription, { slug: row.tenant.slug }),
        msg.value.list.revokeSuccess,
        !!props.options?.requireMfaForRevoke,
        (code) => pilots.revoke(row.tenant.slug, code),
    );
}

function formatDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString(intlLocale.value, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return String(iso);
    }
}
</script>

<style scoped></style>
