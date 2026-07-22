<template>
    <div class="sa-pilots">
        <header class="sa-page-head">
            <div>
                <h1 class="sa-page-head__title">Pilot-Mandanten</h1>
                <p class="sa-page-head__sub">{{ rows.length }} Pilot-Tenants insgesamt.</p>
            </div>
            <div class="sa-page-head__actions">
                <slot name="head-actions">
                    <q-btn
                        v-if="enableCreate"
                        unelevated
                        color="primary"
                        icon="add"
                        :label="createLabel"
                        @click="showCreate = true"
                    />
                </slot>
            </div>
        </header>

        <div class="sa-stats">
            <button
                v-for="tile in statTiles"
                :key="tile.id"
                class="sa-stat"
                :class="[
                    tile.tone ? `sa-stat--${tile.tone}` : null,
                    filter === tile.id ? 'sa-stat--active' : null,
                ]"
                @click="filter = tile.id"
            >
                <span class="sa-stat__num">{{ tile.count }}</span>
                <span class="sa-stat__label">{{ tile.label }}</span>
                <span v-if="tile.hint" class="sa-stat__hint">{{ tile.hint }}</span>
            </button>
        </div>

        <q-banner v-if="reviewSoon.length" class="bg-amber-2 text-grey-9 q-mb-md" rounded>
            <template #avatar><q-icon name="event" color="amber-9" /></template>
            {{ reviewSoon.length }} Pilot-Mandanten enden in den nächsten 30 Tagen — bitte prüfen.
        </q-banner>

        <div class="sa-pilots__card">
            <q-table
                flat
                :rows="filteredRows"
                :columns="effectiveColumns"
                row-key="id"
                :pagination="{ rowsPerPage: 0 }"
                :loading="loading"
                hide-pagination
            >
                <template #body-cell-actions="{ row }">
                    <q-td>
                        <slot name="row-actions" :row="row">
                            <q-btn
                                v-for="action in visibleActions(row)"
                                :key="action.id"
                                flat
                                dense
                                :icon="action.icon"
                                :title="action.label"
                                :color="action.color ?? 'grey-7'"
                                @click="action.handler(row)"
                            />
                        </slot>
                    </q-td>
                </template>
            </q-table>
        </div>

        <PilotCreateDialog
            v-if="enableCreate && submitCreate"
            v-model="showCreate"
            :plan-options="effectiveCreatePlanOptions"
            :default-plan="defaultPlan"
            :copy="copy"
            :require-mfa="requireMfa"
            :mfa-setup-hint="mfaSetupHint"
            :submit="submitCreate"
            @created="onCreated"
        />

        <PilotEditDialog
            v-if="enableEdit && submitEdit"
            v-model="showEdit"
            :row="editRow"
            :plan-options="bakedPlanOptions"
            :copy="copy"
            :require-mfa="requireMfa"
            :mfa-setup-hint="mfaSetupHint"
            :submit="submitEdit"
            @updated="onUpdated"
        />

        <MfaPromptDialog
            v-if="needsMfaDialog"
            :model-value="showMfa"
            :description="mfaDescription"
            :error="mfaError"
            :setup-hint="mfaSetupHint"
            @update:model-value="onMfaDialogVisibility"
            @confirm="onMfaConfirm"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useSuperAdminNotify } from '../quasar/notify.js';
import PilotCreateDialog from '../components/dialogs/PilotCreateDialog.vue';
import PilotEditDialog from '../components/dialogs/PilotEditDialog.vue';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import type {
    PilotCopy,
    PilotCreatePayload,
    PilotCreateResult,
    PilotEditPayload,
    PilotEditResult,
} from '../components/dialogs/types.js';

// Platform standard page: pilot tenants. Data-agnostic.
//
// Optional baked-in flows: consumers can set `enableCreate/Edit/Extend/Revoke`
// + provide the matching `submit*` callbacks, then the page mounts the
// dialogs itself and appends the default actions to the `actions` prop.
// Anyone needing more control (e.g. MFA flows) omits enable* and provides
// the actions/dialogs themselves as before — no behavior change.

export interface PilotRow {
    id: string;
    tenant: { id: string; slug: string; name: string };
    plan: string;
    pilotEndsAt: string | null;
    pilotNote: string | null;
    grantedBy: string | null;
    grantedAt?: string | null;
    [extra: string]: unknown;
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

const props = withDefaults(
    defineProps<{
        loadPilots: () => Promise<PilotRow[]>;
        loadReviewSoon?: () => Promise<PilotRow[]>;
        actions?: readonly PilotRowAction[];
        enableCreate?: boolean;
        enableEdit?: boolean;
        enableExtend?: boolean;
        enableRevoke?: boolean;
        submitCreate?: (payload: PilotCreatePayload, mfaCode: string) => Promise<PilotCreateResult>;
        submitEdit?: (
            slug: string,
            payload: PilotEditPayload,
            mfaCode: string,
        ) => Promise<PilotEditResult>;
        submitExtend?: (slug: string, until: string, mfaCode?: string) => Promise<void>;
        submitRevoke?: (slug: string, mfaCode?: string) => Promise<void>;
        loadPlanOptions?: () => Promise<PilotPlanOption[]>;
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
    }>(),
    {
        requireMfa: false,
        requireMfaForExtend: false,
        requireMfaForRevoke: false,
        createLabel: 'Pilot anlegen',
        defaultActions: () => ['edit', 'extend', 'revoke'],
    },
);

const q = useQuasar();
const notify = useSuperAdminNotify();
const rows = ref<PilotRow[]>([]);
const reviewSoon = ref<PilotRow[]>([]);
const loading = ref(false);

const showCreate = ref(false);
const showEdit = ref(false);
const editRow = ref<PilotRow | null>(null);
const bakedPlanOptions = ref<PilotPlanOption[]>([]);

// MFA dialog state for per-flow MFA (extend/revoke). Promise-resolver pattern
// analogous to use-platform-tenant-actions.ts: `onExtendClick`/`onRevokeClick`
// calls `runWithMfa(...)`, which opens the dialog and waits for `onMfaConfirm`
// (or cancellation via `update:modelValue=false`).
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
let pendingMfaResolve: ((code: string | null) => void) | null = null;
const needsMfaDialog = computed(() => props.requireMfaForExtend || props.requireMfaForRevoke);

function promptMfa(description: string): Promise<string | null> {
    return new Promise((resolve) => {
        mfaDescription.value = description;
        mfaError.value = '';
        showMfa.value = true;
        pendingMfaResolve = (code) => {
            pendingMfaResolve = null;
            resolve(code);
        };
    });
}

function onMfaConfirm(code: string): void {
    pendingMfaResolve?.(code);
}

function onMfaDialogVisibility(open: boolean): void {
    showMfa.value = open;
    if (!open && pendingMfaResolve) {
        pendingMfaResolve(null);
    }
}
// Consumers can set `createPlanOptions` instead of `loadPlanOptions`
// (e.g. apps with a hard-coded plan list).
const effectiveCreatePlanOptions = computed<readonly (string | PilotPlanOption)[]>(() => {
    if (props.createPlanOptions && props.createPlanOptions.length > 0) {
        return props.createPlanOptions;
    }
    return bakedPlanOptions.value;
});
const defaultPlan = computed<string | undefined>(() => {
    if (props.defaultCreatePlan) return props.defaultCreatePlan;
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
        { id: 'all', label: 'Alle', count: counts.all },
        { id: 'active', label: 'Aktiv', count: counts.active, tone: 'positive' },
        {
            id: 'expiring',
            label: 'Läuft bald aus',
            count: counts.expiring,
            tone: 'warn',
            hint: '≤ 14 Tage',
        },
        { id: 'expired', label: 'Abgelaufen', count: counts.expired, tone: 'danger' },
    ];
});

const baseColumns = [
    {
        name: 'slug',
        label: 'Slug',
        field: (r: PilotRow) => r.tenant.slug,
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'name',
        label: 'Name',
        field: (r: PilotRow) => r.tenant.name,
        align: 'left' as const,
    },
    { name: 'plan', label: 'Plan', field: 'plan', align: 'left' as const },
    {
        name: 'note',
        label: 'Note',
        field: (r: PilotRow) => r.pilotNote ?? '—',
        align: 'left' as const,
    },
    {
        name: 'grantedBy',
        label: 'Granted by',
        field: (r: PilotRow) => r.grantedBy ?? '—',
        align: 'left' as const,
    },
    {
        name: 'pilotEndsAt',
        label: 'Endet',
        field: (r: PilotRow) => formatDate(r.pilotEndsAt) ?? '∞',
        align: 'left' as const,
    },
];

// Built-in default actions (edit/extend/revoke) — are APPENDED to the
// consumer `actions`, not replaced. Order follows the `defaultActions` prop.
const bakedActions = computed<PilotRowAction[]>(() => {
    const out: PilotRowAction[] = [];
    for (const id of props.defaultActions) {
        if (id === 'edit' && props.enableEdit && props.submitEdit) {
            out.push({
                id: 'edit',
                label: 'Bearbeiten',
                icon: 'edit',
                color: 'primary',
                handler: (row) => onEditClick(row),
            });
        } else if (id === 'extend' && props.enableExtend && props.submitExtend) {
            out.push({
                id: 'extend',
                label: 'Verlängern',
                icon: 'event_repeat',
                color: 'primary',
                handler: (row) => onExtendClick(row),
            });
        } else if (id === 'revoke' && props.enableRevoke && props.submitRevoke) {
            out.push({
                id: 'revoke',
                label: 'Widerrufen',
                icon: 'block',
                color: 'negative',
                handler: (row) => onRevokeClick(row),
            });
        }
    }
    return out;
});

const mergedActions = computed<readonly PilotRowAction[]>(() => [
    ...(props.actions ?? []),
    ...bakedActions.value,
]);

const effectiveColumns = computed(() => {
    const cols = [...baseColumns];
    if (mergedActions.value.length > 0) {
        cols.push({
            name: 'actions',
            label: '',
            field: ((r: PilotRow) => r.id) as never,
            align: 'right' as 'left',
        });
    }
    return cols;
});

function visibleActions(row: PilotRow): PilotRowAction[] {
    return mergedActions.value.filter((a) => !a.condition || a.condition(row));
}

async function reload() {
    loading.value = true;
    try {
        rows.value = await props.loadPilots();
        if (props.loadReviewSoon) {
            try {
                reviewSoon.value = await props.loadReviewSoon();
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

async function reloadPlanOptions(): Promise<void> {
    if (!props.loadPlanOptions) {
        bakedPlanOptions.value = [];
        return;
    }
    try {
        bakedPlanOptions.value = (await props.loadPlanOptions()) ?? [];
    } catch {
        bakedPlanOptions.value = [];
    }
}

onMounted(() => {
    void reload();
    void reloadPlanOptions();
});

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Aktion fehlgeschlagen'
    );
}

function onEditClick(row: PilotRow): void {
    editRow.value = row;
    showEdit.value = true;
}

function onUpdated(result: PilotEditResult): void {
    notify('positive', `Pilot ${result.slug} aktualisiert.`, {
        caption: result.changed?.length ? `Geändert: ${result.changed.join(', ')}` : undefined,
    });
    void reload();
}

function onCreated(result: PilotCreateResult): void {
    notify('positive', `Pilot ${result.slug} angelegt.`, {
        caption: result.initialPassword ? `Initial-Passwort: ${result.initialPassword}` : undefined,
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
            notify('negative', errMsg(err));
        }
        return;
    }
    // MFA loop: as long as the server returns 401, keep the dialog open and
    // wait again for a code. Cancelling (resolver === null) ends it.
    while (true) {
        const code = await promptMfa(actionLabel);
        if (code === null) return;
        try {
            await invoke(code);
            showMfa.value = false;
            notify('positive', successMessage);
            await reload();
            return;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfaError.value = 'TOTP-Code ungültig oder MFA nicht eingerichtet.';
                continue;
            }
            showMfa.value = false;
            notify('negative', errMsg(err));
            return;
        }
    }
}

function onExtendClick(row: PilotRow): void {
    if (!props.submitExtend) return;
    const submit = props.submitExtend;
    q.dialog({
        title: `Pilot ${row.tenant.slug} verlängern`,
        message: 'Neues Enddatum:',
        prompt: {
            model: row.pilotEndsAt?.slice(0, 10) ?? '',
            type: 'date',
        },
        cancel: 'Abbrechen',
        ok: { label: 'Verlängern', color: 'primary' },
    }).onOk(async (until: string) => {
        if (!until) return;
        await runAction(
            `Pilot "${row.tenant.slug}" bis ${until} verlängern.`,
            `Pilot bis ${until} verlängert.`,
            !!props.requireMfaForExtend,
            (code) => submit(row.tenant.slug, until, code),
        );
    });
}

function onRevokeClick(row: PilotRow): void {
    if (!props.submitRevoke) return;
    const submit = props.submitRevoke;
    q.dialog({
        title: `Pilot ${row.tenant.slug} widerrufen`,
        message: 'Pilot-Status entfernen. Subscription bleibt bestehen.',
        cancel: 'Abbrechen',
        ok: { label: 'Widerrufen', color: 'negative' },
    }).onOk(async () => {
        await runAction(
            `Pilot-Status für "${row.tenant.slug}" widerrufen.`,
            'Pilot widerrufen.',
            !!props.requireMfaForRevoke,
            (code) => submit(row.tenant.slug, code),
        );
    });
}

function formatDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return String(iso);
    }
}
</script>

<style scoped>
.sa-pilots {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
    padding: 20px 28px 28px;
}
.sa-pilots__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}
</style>
