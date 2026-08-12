<template>
    <AdminPage class="sa-users">
        <AdminHero :title="resolvedTitle" :subtitle="subtitle" />

        <AdminBody>
            <AdminSection>
                <AdminStatistics :label="resolvedTitle">
                    <AdminKpi
                        v-for="tile in statTiles"
                        :key="tile.id"
                        :label="tile.label"
                        :value="tile.count"
                        :tone="tile.tone"
                        :selected="statusFilter === tile.id"
                        :action="() => (statusFilter = tile.id)"
                    />
                </AdminStatistics>
            </AdminSection>

            <AdminSection :title="common.results" class="sa-users__card">
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="filter.q"
                        outlined
                        dense
                        :label="msg.filterQuery"
                        clearable
                        debounce="250"
                        @update:model-value="reload"
                    />
                    <q-input
                        v-model="filter.tenant"
                        outlined
                        dense
                        :label="msg.filterTenant"
                        clearable
                        debounce="250"
                        @update:model-value="reload"
                    />
                    <slot name="filters-extra" />
                </AdminFilters>

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
                                :label="row.isActive ? msg.statusActive : msg.statusDeactivated"
                            />
                            <q-badge
                                v-if="row.invitationStatus === 'PENDING'"
                                color="amber-7"
                                :label="msg.badgePending"
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
            </AdminSection>
        </AdminBody>

        <MfaPromptDialog
            v-if="needsMfaDialog"
            :model-value="mfa.show.value"
            :description="mfa.description.value"
            :error="mfa.error.value"
            :setup-hint="mfaSetupHint"
            @update:model-value="mfa.onVisibility"
            @confirm="mfa.onConfirm"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useQuasar } from 'quasar';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminBody from '../components/admin-page/AdminBody.vue';
import AdminFilters from '../components/admin-page/AdminFilters.vue';
import AdminHero from '../components/admin-page/AdminHero.vue';
import AdminKpi from '../components/admin-page/AdminKpi.vue';
import AdminPage from '../components/admin-page/AdminPage.vue';
import AdminSection from '../components/admin-page/AdminSection.vue';
import AdminStatistics from '../components/admin-page/AdminStatistics.vue';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: user search. Data-agnostic.
//
// Optional baked-in flows: enableResetPassword/Deactivate + submit* callbacks.
// Default actions are APPENDED to consumer actions.

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
        /** Per-flow MFA for reset password — shows MfaPromptDialog after the reason prompt. */
        requireMfaForResetPassword?: boolean;
        /** Per-flow MFA for deactivate — shows MfaPromptDialog after the reason prompt. */
        requireMfaForDeactivate?: boolean;
        mfaSetupHint?: string;
        // Return value: either `{oneTimePassword}` (shows OTP dialog)
        // or `void` (Notify only). The page decides based on the return
        // whether the OTP dialog is shown.
        submitResetPassword?: (
            id: string,
            reason: string,
            mfaCode?: string,
        ) => Promise<{ oneTimePassword: string } | void>;
        submitDeactivate?: (id: string, reason: string, mfaCode?: string) => Promise<void>;
    }>(),
    {
        requireMfaForResetPassword: false,
        requireMfaForDeactivate: false,
    },
);

const q = useQuasar();
const notify = useSuperAdminNotify();
const msg = useSaMessages('users');
const common = useSaMessages('common');
const shell = useSaMessages('shell');
const { intlLocale } = useSuperAdminI18n();

const resolvedTitle = computed(() => props.title ?? msg.value.title);
const rows = ref<UserRow[]>([]);
const loading = ref(false);
const filter = reactive({ q: '', tenant: '' });

// Per-flow MFA for reset/deactivate: the action handler awaits `mfa.prompt`,
// which resolves with the code or with null when the user closes the dialog.
const mfa = useMfaPrompt();
const needsMfaDialog = computed(
    () => props.requireMfaForResetPassword || props.requireMfaForDeactivate,
);

// Stat-pill filter (analogous to plan simulation users.jsx):
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
        { id: 'all', label: common.value.all, count: rows.value.length },
        { id: 'active', label: common.value.active, count: active, tone: 'positive' },
        { id: 'blocked', label: msg.value.tiles.blocked, count: blocked, tone: 'muted' },
        { id: 'never', label: msg.value.tiles.neverLoggedIn, count: never, tone: 'warn' },
        { id: 'super', label: msg.value.tiles.superAdmins, count: supr, tone: 'purple' },
    ];
});

const baseColumns = computed(() => [
    {
        name: 'email',
        label: msg.value.columns.email,
        field: 'email',
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'name',
        label: common.value.name,
        field: (r: UserRow) => `${r.firstName} ${r.lastName}`,
        align: 'left' as const,
    },
    {
        name: 'tenant',
        label: msg.value.columns.tenant,
        field: (r: UserRow) => r.tenantSlug ?? msg.value.tenantFallback,
        align: 'left' as const,
    },
    { name: 'role', label: msg.value.columns.role, field: 'role', align: 'left' as const },
    { name: 'status', label: common.value.status, field: 'isActive', align: 'left' as const },
    {
        name: 'lastLogin',
        label: msg.value.columns.lastLogin,
        field: (r: UserRow) =>
            r.lastLoginAt
                ? new Date(r.lastLoginAt).toLocaleDateString(intlLocale.value, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                  })
                : '—',
        align: 'left' as const,
    },
]);

// Built-in default actions — APPENDED to consumer actions, not replaced.
const bakedActions = computed<UserRowAction[]>(() => {
    const out: UserRowAction[] = [];
    if (props.enableResetPassword && props.submitResetPassword) {
        out.push({
            id: 'reset-password',
            label: msg.value.resetPassword.action,
            icon: 'lock_reset',
            color: 'primary',
            handler: (row) => onResetPasswordClick(row),
        });
    }
    if (props.enableDeactivate && props.submitDeactivate) {
        out.push({
            id: 'deactivate',
            label: msg.value.deactivate.action,
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
    const cols = [...baseColumns.value];
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
        msg.value.errorAction
    );
}

// MFA loop analogous to PilotsPage: on 401 the dialog stays open.
// `invoke` must accept the code (empty when requireMfa=false) and deliver
// the `oneTimePassword` result optionally returned by the server.
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
            notify('negative', errMsg(err));
        }
        return;
    }
    while (true) {
        const code = await mfa.prompt(actionLabel);
        if (code === null) return;
        try {
            const result = await invoke(code);
            mfa.show.value = false;
            onSuccess(result);
            return;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfa.error.value = shell.value.mfa.invalidCode;
                continue;
            }
            mfa.show.value = false;
            notify('negative', errMsg(err));
            return;
        }
    }
}

function onResetPasswordClick(row: UserRow): void {
    if (!props.submitResetPassword) return;
    const submit = props.submitResetPassword;
    q.dialog({
        title: formatMessage(msg.value.resetPassword.dialogTitle, { email: row.email }),
        message: msg.value.reasonPrompt,
        prompt: { model: '', type: 'text' },
        cancel: common.value.cancel,
        ok: { label: common.value.reset, color: 'primary' },
    }).onOk(async (reason: string) => {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            formatMessage(msg.value.resetPassword.mfaDescription, {
                email: row.email,
                reason: reason.trim(),
            }),
            !!props.requireMfaForResetPassword,
            (code) => submit(row.id, reason, code),
            (data) => {
                // The server can optionally return `oneTimePassword` — then
                // show the OTP dialog. Backends without OTP return
                // void → Notify only.
                if (data && typeof data === 'object' && 'oneTimePassword' in data) {
                    q.dialog({
                        title: msg.value.resetPassword.otpTitle,
                        message: formatMessage(msg.value.resetPassword.otpMessage, {
                            password: data.oneTimePassword,
                        }),
                        ok: { label: msg.value.resetPassword.otpAcknowledge },
                    });
                } else {
                    notify('positive', msg.value.resetPassword.success);
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
        title: formatMessage(msg.value.deactivate.dialogTitle, { email: row.email }),
        message: msg.value.reasonPrompt,
        prompt: { model: '', type: 'text' },
        cancel: common.value.cancel,
        ok: { label: msg.value.deactivate.action, color: 'negative' },
    }).onOk(async (reason: string) => {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            formatMessage(msg.value.deactivate.mfaDescription, {
                email: row.email,
                reason: reason.trim(),
            }),
            !!props.requireMfaForDeactivate,
            (code) => submit(row.id, reason, code),
            () => {
                notify(
                    'positive',
                    formatMessage(msg.value.deactivate.success, { email: row.email }),
                );
                void reload();
            },
        );
    });
}
</script>

<style scoped></style>
