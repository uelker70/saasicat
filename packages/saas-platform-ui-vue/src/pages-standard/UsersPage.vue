<template>
    <div class="sa-users">
        <header class="sa-page-head">
            <div>
                <h1 class="sa-page-head__title">{{ title }}</h1>
                <p v-if="subtitle" class="sa-page-head__sub">{{ subtitle }}</p>
            </div>
            <div class="sa-page-head__actions">
                <q-btn unelevated color="primary" icon="search" label="Suchen" @click="reload" />
            </div>
        </header>

        <div class="sa-stats">
            <button
                v-for="tile in statTiles"
                :key="tile.id"
                class="sa-stat"
                :class="[
                    tile.tone ? `sa-stat--${tile.tone}` : null,
                    statusFilter === tile.id ? 'sa-stat--active' : null,
                ]"
                @click="statusFilter = tile.id"
            >
                <span class="sa-stat__num">{{ tile.count }}</span>
                <span class="sa-stat__label">{{ tile.label }}</span>
            </button>
        </div>

        <div class="sa-users__filter">
            <q-input
                v-model="filter.q"
                outlined
                dense
                label="E-Mail oder Name"
                clearable
                @keyup.enter="reload"
                @clear="reload"
            />
            <q-input
                v-model="filter.tenant"
                outlined
                dense
                label="Tenant-Slug"
                clearable
                @keyup.enter="reload"
                @clear="reload"
            />
            <slot name="filters-extra" />
        </div>

        <div class="sa-users__card">
            <q-table
                flat
                :rows="filteredRows"
                :columns="effectiveColumns"
                row-key="id"
                :pagination="{ rowsPerPage: 0 }"
                :loading="loading"
                hide-pagination
            >
                <template #body-cell-status="{ row }">
                    <q-td>
                        <q-badge
                            :color="row.isActive ? 'positive' : 'grey'"
                            :label="row.isActive ? 'aktiv' : 'deaktiviert'"
                        />
                        <q-badge
                            v-if="row.invitationStatus === 'PENDING'"
                            color="amber-7"
                            label="Pending"
                            class="q-ml-xs"
                        />
                    </q-td>
                </template>
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';

// Plattform-Standard-Page: User-Suche. Datenagnostisch.
//
// Optional baked-in flows: enableResetPassword/Deactivate + submit*-Callbacks.
// Default-Actions werden APPENDED an Consumer-Actions.

export interface UserRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    invitationStatus?: string;
    tenantSlug?: string | null;
    lastLoginAt?: string | null;
    [extra: string]: unknown;
}

export interface UserListFilter {
    q?: string;
    tenant?: string;
    [extra: string]: unknown;
}

export interface UserRowAction {
    id: string;
    label: string;
    icon: string;
    color?: string;
    condition?: (row: UserRow) => boolean;
    handler: (row: UserRow) => void;
}

const props = withDefaults(
    defineProps<{
        loadUsers: (filter: UserListFilter) => Promise<UserRow[]>;
        title?: string;
        subtitle?: string;
        actions?: readonly UserRowAction[];
        enableResetPassword?: boolean;
        enableDeactivate?: boolean;
        /** Per-Flow-MFA fuer Reset-Password — zeigt MfaPromptDialog nach Reason-Prompt. */
        requireMfaForResetPassword?: boolean;
        /** Per-Flow-MFA fuer Deactivate — zeigt MfaPromptDialog nach Reason-Prompt. */
        requireMfaForDeactivate?: boolean;
        mfaSetupHint?: string;
        // Returnwert: bei vereinsfux `{oneTimePassword}` (zeigt OTP-Dialog),
        // bei AutohausPro `void` (nur Notify). Page entscheidet anhand des Returns,
        // ob OTP-Dialog angezeigt wird.
        submitResetPassword?: (
            id: string,
            reason: string,
            mfaCode?: string,
        ) => Promise<{ oneTimePassword: string } | void>;
        submitDeactivate?: (id: string, reason: string, mfaCode?: string) => Promise<void>;
    }>(),
    {
        title: 'Benutzer',
        requireMfaForResetPassword: false,
        requireMfaForDeactivate: false,
    },
);

const q = useQuasar();
const rows = ref<UserRow[]>([]);
const loading = ref(false);
const filter = reactive({ q: '', tenant: '' });

// MFA-Dialog-State fuer Per-Flow-MFA (reset/deactivate). Promise-Resolver-
// Pattern analog PilotsPage: Action-Handler ruft `promptMfa` und wartet auf
// `onMfaConfirm` (oder Abbruch via `update:modelValue=false`).
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
let pendingMfaResolve: ((code: string | null) => void) | null = null;
const needsMfaDialog = computed(
    () => props.requireMfaForResetPassword || props.requireMfaForDeactivate,
);

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

// Stat-Pill-Filter (analog Plan-Simulation users.jsx):
//   all | active | blocked | never-logged-in | super-admin.
type StatusFilter = 'all' | 'active' | 'blocked' | 'never' | 'super';
const statusFilter = ref<StatusFilter>('all');

function isSuperAdmin(row: UserRow): boolean {
    return (
        row.role === 'SUPER_ADMIN' ||
        row.role === 'PLATFORM_ADMIN' ||
        String(row.role).toLowerCase().includes('super')
    );
}

const filteredRows = computed(() => {
    const f = statusFilter.value;
    if (f === 'all') return rows.value;
    return rows.value.filter((r) => {
        if (f === 'active') return r.isActive;
        if (f === 'blocked') return !r.isActive;
        if (f === 'never') return !r.lastLoginAt;
        if (f === 'super') return isSuperAdmin(r);
        return true;
    });
});

const statTiles = computed<
    Array<{
        id: StatusFilter;
        label: string;
        count: number;
        tone?: 'positive' | 'warn' | 'muted' | 'purple';
    }>
>(() => {
    let active = 0;
    let blocked = 0;
    let never = 0;
    let supr = 0;
    for (const r of rows.value) {
        if (r.isActive) active++;
        else blocked++;
        if (!r.lastLoginAt) never++;
        if (isSuperAdmin(r)) supr++;
    }
    return [
        { id: 'all', label: 'Alle', count: rows.value.length },
        { id: 'active', label: 'Aktiv', count: active, tone: 'positive' },
        { id: 'blocked', label: 'Gesperrt', count: blocked, tone: 'muted' },
        { id: 'never', label: 'Nie eingeloggt', count: never, tone: 'warn' },
        { id: 'super', label: 'Super-Admins', count: supr, tone: 'purple' },
    ];
});

const baseColumns = [
    {
        name: 'email',
        label: 'E-Mail',
        field: 'email',
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'name',
        label: 'Name',
        field: (r: UserRow) => `${r.firstName} ${r.lastName}`,
        align: 'left' as const,
    },
    {
        name: 'tenant',
        label: 'Tenant',
        field: (r: UserRow) => r.tenantSlug ?? '— (SuperAdmin)',
        align: 'left' as const,
    },
    { name: 'role', label: 'Rolle', field: 'role', align: 'left' as const },
    { name: 'status', label: 'Status', field: 'isActive', align: 'left' as const },
    {
        name: 'lastLogin',
        label: 'Letzter Login',
        field: (r: UserRow) =>
            r.lastLoginAt
                ? new Date(r.lastLoginAt).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                  })
                : '—',
        align: 'left' as const,
    },
];

// Eingebaute Default-Actions — APPENDED an Consumer-Actions, nicht ersetzt.
const bakedActions = computed<UserRowAction[]>(() => {
    const out: UserRowAction[] = [];
    if (props.enableResetPassword && props.submitResetPassword) {
        out.push({
            id: 'reset-password',
            label: 'Passwort zurücksetzen',
            icon: 'lock_reset',
            color: 'primary',
            handler: (row) => onResetPasswordClick(row),
        });
    }
    if (props.enableDeactivate && props.submitDeactivate) {
        out.push({
            id: 'deactivate',
            label: 'Deaktivieren',
            icon: 'block',
            color: 'negative',
            condition: (row) => (row as UserRow & { status?: string }).status !== 'suspended',
            handler: (row) => onDeactivateClick(row),
        });
    }
    return out;
});

const mergedActions = computed<readonly UserRowAction[]>(() => [
    ...(props.actions ?? []),
    ...bakedActions.value,
]);

const effectiveColumns = computed(() => {
    const cols = [...baseColumns];
    if (mergedActions.value.length > 0) {
        cols.push({
            name: 'actions',
            label: '',
            field: 'id' as never,
            align: 'right' as 'left',
        });
    }
    return cols;
});

function visibleActions(row: UserRow): UserRowAction[] {
    return mergedActions.value.filter((a) => !a.condition || a.condition(row));
}

async function reload() {
    loading.value = true;
    try {
        rows.value = await props.loadUsers({
            q: filter.q || undefined,
            tenant: filter.tenant || undefined,
        });
    } catch (err) {
        rows.value = [];
        console.warn('[UsersPage] loadUsers failed:', err);
    } finally {
        loading.value = false;
    }
}

onMounted(reload);

defineExpose({ reload });

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Aktion fehlgeschlagen'
    );
}

// MFA-Loop analog PilotsPage: bei 401 bleibt der Dialog offen.
// `invoke` muss den Code (leer wenn requireMfa=false) entgegennehmen und das
// optional vom Server zurueckgegebene `oneTimePassword`-Result liefern.
async function runAction<R>(
    actionLabel: string,
    requireMfa: boolean,
    invoke: (code: string) => Promise<R>,
    onSuccess: (result: R) => void,
): Promise<void> {
    if (!requireMfa) {
        try {
            const result = await invoke('');
            onSuccess(result);
        } catch (err) {
            q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
        }
        return;
    }
    while (true) {
        const code = await promptMfa(actionLabel);
        if (code === null) return;
        try {
            const result = await invoke(code);
            showMfa.value = false;
            onSuccess(result);
            return;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfaError.value = 'TOTP-Code ungültig oder MFA nicht eingerichtet.';
                continue;
            }
            showMfa.value = false;
            q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
            return;
        }
    }
}

function onResetPasswordClick(row: UserRow): void {
    if (!props.submitResetPassword) return;
    const submit = props.submitResetPassword;
    q.dialog({
        title: `Passwort für "${row.email}" zurücksetzen`,
        message: 'Grund für Audit (Pflichtfeld):',
        prompt: { model: '', type: 'text' },
        cancel: 'Abbrechen',
        ok: { label: 'Zurücksetzen', color: 'primary' },
    }).onOk(async (reason: string) => {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            `Passwort für "${row.email}" zurücksetzen — ${reason.trim()}.`,
            !!props.requireMfaForResetPassword,
            (code) => submit(row.id, reason, code),
            (data) => {
                // Server kann optional `oneTimePassword` zurueckgeben — dann
                // OTP-Dialog anzeigen (vereinsfux-Pattern). AutohausPro returnt
                // void → nur Notify.
                if (data && typeof data === 'object' && 'oneTimePassword' in data) {
                    q.dialog({
                        title: 'Einmal-Passwort generiert',
                        message: `Bitte sicher übermitteln: ${data.oneTimePassword}`,
                        ok: { label: 'Verstanden' },
                    });
                } else {
                    q.notify({
                        type: 'positive',
                        message: 'Passwort-Reset ausgelöst.',
                        position: 'top',
                    });
                }
                void reload();
            },
        );
    });
}

function onDeactivateClick(row: UserRow): void {
    if (!props.submitDeactivate) return;
    const submit = props.submitDeactivate;
    q.dialog({
        title: `User "${row.email}" deaktivieren`,
        message: 'Grund für Audit (Pflichtfeld):',
        prompt: { model: '', type: 'text' },
        cancel: 'Abbrechen',
        ok: { label: 'Deaktivieren', color: 'negative' },
    }).onOk(async (reason: string) => {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            `User "${row.email}" deaktivieren — ${reason.trim()}.`,
            !!props.requireMfaForDeactivate,
            (code) => submit(row.id, reason, code),
            () => {
                q.notify({
                    type: 'positive',
                    message: `${row.email} deaktiviert.`,
                    position: 'top',
                });
                void reload();
            },
        );
    });
}
</script>

<style scoped>
.sa-users {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
    padding: 20px 28px 28px;
}
.sa-users__filter {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    align-items: center;
    flex-wrap: wrap;
}
.sa-users__filter > * {
    flex: 1;
    min-width: 200px;
}
.sa-users__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}
</style>
