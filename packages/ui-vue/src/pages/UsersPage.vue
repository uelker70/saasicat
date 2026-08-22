<template>
    <AdminPage class="sa-users">
        <AdminHero :title="resolvedTitle" :subtitle="options?.subtitle" />

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

                <AdminTable
                    :rows="filteredRows"
                    :columns="effectiveColumns"
                    :loading="loading"
                    storage-key="users"
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
                    <template #row-actions="{ row }">
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
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <!-- One dialog, owned by the page. It used to sit in the status cell's
             slot, which is instantiated once per rendered row: a password reset
             opened as many stacked overlays as there were users, each with its
             own focus trap. -->
        <AdminDialog
            :model-value="otpMessage !== null"
            :title="msg.resetPassword.otpTitle"
            size="sm"
            persistent
            @update:model-value="otpMessage = null"
        >
            <p class="sa-dialog__message">{{ otpMessage }}</p>
            <template #footer>
                <div class="sa-dialog__actions">
                    <q-btn
                        unelevated
                        color="primary"
                        no-caps
                        :label="msg.resetPassword.otpAcknowledge"
                        @click="otpMessage = null"
                    />
                </div>
            </template>
        </AdminDialog>

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
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { usersResource } from '../client/resources/users.resource.js';
import { adminErrorMessage, httpStatusOf } from '../client/admin-error.js';
import { computed, onMounted, reactive, ref } from 'vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import { useSuperAdminConfirm } from '../quasar/confirm.js';
import AdminDialog from '../ui/overlay/AdminDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminKpi from '../ui/data/AdminKpi.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminStatistics from '../ui/data/AdminStatistics.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
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

/**
 * What an app may change about this page.
 *
 * One object rather than nine props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind the
 * last one. A consumer then reads three slots instead of a list that grows
 * every time a page learns something.
 */
export interface UsersPageOptions {
    title?: string;
    subtitle?: string;
    actions?: readonly UserRowAction[];
    /** Offer the reset-password flow. The endpoint is the app's to serve. */
    enableResetPassword?: boolean;
    /** Offer the deactivate flow. */
    enableDeactivate?: boolean;
    /** Per-flow MFA for reset password — the prompt follows the reason. */
    requireMfaForResetPassword?: boolean;
    /** Per-flow MFA for deactivate. */
    requireMfaForDeactivate?: boolean;
    /** Markup shown under the MFA input, e.g. a link to your setup docs. */
    mfaSetupHint?: string;
}

export interface UserRowAction {
    id: string;
    label: string;
    icon: string;
    color?: string;
    condition?: (row: UserRow) => boolean;
    handler: (row: UserRow) => void;
}

const props = defineProps<{
    /**
     * Override the users resource for this page only — a different host, or
     * one operation wrapped. Layered over the app's own override; see
     * AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof usersResource)['ops']>;
    /** Presentation and capability. Never data, never a callback. */
    options?: UsersPageOptions;
}>();

const notify = useSuperAdminNotify();
// `confirm` is taken — `window.confirm` shadows it.
const askConfirm = useSuperAdminConfirm();

// The data layer, reached by name. `resetPassword` and `deactivate` are served
// by the consuming app rather than by the platform — the descriptor records the
// paths every consumer already calls, so the page needs no callbacks for them.
const users = useResource('users', props.resources);

// The generated one-time password. Deliberately not the confirm port: that port
// asks a question, and this dialog asks nothing — it shows a value the operator
// gets exactly one chance to read. A cancel button, or a backdrop that closes
// it, would throw that value away.
const otpMessage = ref<string | null>(null);
const msg = useSaMessages('users');
const errors = useSaMessages('errors');
const common = useSaMessages('common');
const shell = useSaMessages('shell');
const { intlLocale } = useSuperAdminI18n();

const resolvedTitle = computed(() => props.options?.title ?? msg.value.title);
const rows = ref<UserRow[]>([]);
const loading = ref(false);
const filter = reactive({ q: '', tenant: '' });

// Per-flow MFA for reset/deactivate: the action handler awaits `mfa.prompt`,
// which resolves with the code or with null when the user closes the dialog.
const mfa = useMfaPrompt();
const needsMfaDialog = computed(
    () => props.options?.requireMfaForResetPassword || props.options?.requireMfaForDeactivate,
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
    if (props.options?.enableResetPassword) {
        out.push({
            id: 'reset-password',
            label: msg.value.resetPassword.action,
            icon: 'lock_reset',
            color: 'primary',
            handler: (row) => onResetPasswordClick(row),
        });
    }
    if (props.options?.enableDeactivate) {
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
    ...(props.options?.actions ?? []),
    ...bakedActions.value,
]);

const effectiveColumns = computed(() => {
    const cols = [...baseColumns.value];
    return cols;
});

function visibleActions(row: UserRow): UserRowAction[] {
    return mergedActions.value.filter((a) => !a.condition || a.condition(row));
}

async function reload() {
    loading.value = true;
    try {
        rows.value = await users.list({
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
            notify('negative', adminErrorMessage(err, errors.value));
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
            const status = httpStatusOf(err);
            if (status === 401) {
                mfa.error.value = shell.value.mfa.invalidCode;
                continue;
            }
            mfa.show.value = false;
            notify('negative', adminErrorMessage(err, errors.value));
            return;
        }
    }
}

async function onResetPasswordClick(row: UserRow): Promise<void> {
    const { ok: confirmed, value: reason } = await askConfirm({
        title: formatMessage(msg.value.resetPassword.dialogTitle, { email: row.email }),
        message: msg.value.reasonPrompt,
        confirmLabel: common.value.reset,
        cancelLabel: common.value.cancel,
        prompt: { type: 'text' },
    });
    if (confirmed) {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            formatMessage(msg.value.resetPassword.mfaDescription, {
                email: row.email,
                reason: reason.trim(),
            }),
            !!props.options?.requireMfaForResetPassword,
            (code) => users.resetPassword(row.id, reason, code),
            (data) => {
                // The server can optionally return `oneTimePassword` — then
                // show the OTP dialog. Backends without OTP return
                // void → Notify only.
                if (data && typeof data === 'object' && 'oneTimePassword' in data) {
                    otpMessage.value = formatMessage(msg.value.resetPassword.otpMessage, {
                        password: String(data.oneTimePassword),
                    });
                } else {
                    notify('positive', msg.value.resetPassword.success);
                }
                void reload();
            },
        );
    }
}

async function onDeactivateClick(row: UserRow): Promise<void> {
    const { ok: confirmed, value: reason } = await askConfirm({
        title: formatMessage(msg.value.deactivate.dialogTitle, { email: row.email }),
        message: msg.value.reasonPrompt,
        confirmLabel: msg.value.deactivate.action,
        cancelLabel: common.value.cancel,
        tone: 'negative',
        prompt: { type: 'text' },
    });
    if (confirmed) {
        if (!reason || reason.trim().length === 0) return;
        await runAction(
            formatMessage(msg.value.deactivate.mfaDescription, {
                email: row.email,
                reason: reason.trim(),
            }),
            !!props.options?.requireMfaForDeactivate,
            (code) => users.deactivate(row.id, reason, code),
            () => {
                notify(
                    'positive',
                    formatMessage(msg.value.deactivate.success, { email: row.email }),
                );
                void reload();
            },
        );
    }
}
</script>

<style scoped></style>
