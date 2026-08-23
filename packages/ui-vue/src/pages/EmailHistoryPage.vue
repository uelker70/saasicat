<template>
    <AdminPage class="sa-emh">
        <AdminHero :title="resolvedTitle" :subtitle="msg.history.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="applyFilter" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection>
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="filter.search"
                        outlined
                        dense
                        clearable
                        :label="msg.history.searchLabel"
                        debounce="350"
                        @keyup.enter="applyFilter"
                        @update:model-value="applyFilter"
                    >
                        <template #prepend><q-icon name="search" /></template>
                    </q-input>
                    <q-select
                        v-model="filter.status"
                        outlined
                        dense
                        clearable
                        emit-value
                        map-options
                        :label="common.status"
                        :options="statusOptions"
                        @update:model-value="applyFilter"
                    />
                    <q-input
                        v-model="filter.from"
                        outlined
                        dense
                        clearable
                        type="date"
                        :label="common.from"
                        @update:model-value="applyFilter"
                    />
                    <q-input
                        v-model="filter.to"
                        outlined
                        dense
                        clearable
                        type="date"
                        :label="common.to"
                        @update:model-value="applyFilter"
                    />
                </AdminFilters>

                <AdminTable
                    server-side
                    :rows="rows"
                    :columns="columns"
                    :loading="loading"
                    :page="pagination.page"
                    :rows-per-page="pagination.rowsPerPage"
                    :total="pagination.rowsNumber"
                    storage-key="email-history"
                    @row-click="(_evt: Event, row: EmailHistoryRow) => openDetail(row)"
                    @update:page="onPageChange"
                    @update:rows-per-page="onRowsPerPageChange"
                >
                    <template #body-cell-status="{ row }">
                        <q-td>
                            <AdminStatusPill
                                :label="statusLabel(row.status)"
                                :tone="statusTone(row.status)"
                            />
                        </q-td>
                    </template>
                    <template #row-actions="{ row }">
                        <button
                            type="button"
                            class="sa-icon-btn"
                            :title="msg.history.resend"
                            @click.stop="onResend(row.id)"
                        >
                            <q-icon name="send" size="18px" />
                        </button>
                        <button
                            type="button"
                            class="sa-icon-btn sa-icon-btn--negative"
                            :title="msg.history.removeFromHistory"
                            @click.stop="askDelete(row.id)"
                        >
                            <q-icon name="delete" size="18px" />
                        </button>
                    </template>
                    <template #no-data>
                        <div class="sa-emh__empty">{{ msg.history.empty }}</div>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <AdminDialog
            v-model="detailOpen"
            :title="detail?.subject ?? msg.history.title"
            size="lg"
            :loading="detailLoading"
        >
            <template #header-extra>
                <AdminStatusPill
                    v-if="detail"
                    :label="statusLabel(detail.status)"
                    :tone="statusTone(detail.status)"
                />
            </template>
            <template v-if="detail">
                <div>
                    <div class="text-caption text-grey-7 q-mt-xs">
                        {{
                            formatMessage(msg.history.detailFromTo, {
                                from: detail.fromEmail,
                                to: detail.toEmail,
                            })
                        }}
                        <span v-if="detail.ccEmail"> · Cc {{ detail.ccEmail }}</span>
                        <span v-if="detail.bccEmail"> · Bcc {{ detail.bccEmail }}</span>
                    </div>
                    <div class="text-caption text-grey-7">
                        {{
                            formatMessage(msg.history.detailTimestamps, {
                                created: formatTs(detail.createdAt),
                                sent: formatTs(detail.sentAt),
                            })
                        }}
                    </div>
                </div>

                <div v-if="detail.status === 'FAILED' && detail.errorMessage">
                    <AdminBanner tone="negative" dense>
                        {{ detail.errorMessage }}
                    </AdminBanner>
                </div>

                <div>
                    <!-- Sandbox without flags: no script, no same-origin — safe
                             preview rendering of arbitrary email HTML. -->
                    <iframe
                        v-if="detail.bodyHtml"
                        :srcdoc="detail.bodyHtml"
                        sandbox=""
                        referrerpolicy="no-referrer"
                        class="sa-emh__frame"
                    />
                    <pre v-else-if="detail.bodyText" class="sa-emh__text">{{
                        detail.bodyText
                    }}</pre>
                    <div v-else class="text-grey-6">{{ msg.history.noContent }}</div>
                </div>

                <div v-if="detail.smtpResponse">
                    <div class="text-caption text-grey-7">{{ msg.history.smtpResponse }}</div>
                    <pre class="sa-emh__smtp">{{ detail.smtpResponse }}</pre>
                </div>
            </template>
            <template v-if="detail" #footer>
                <div class="sa-dialog__actions">
                    <q-btn
                        flat
                        color="negative"
                        icon="delete"
                        :label="common.remove"
                        @click="askDelete(detail.id)"
                    />
                    <q-btn
                        unelevated
                        color="primary"
                        icon="send"
                        :label="msg.history.resend"
                        @click="onResend(detail.id)"
                    />
                    <q-btn v-close-popup flat :label="common.close" />
                </div>
            </template>
        </AdminDialog>

        <AdminDialog
            v-model="confirmDeleteOpen"
            :title="msg.history.confirmRemoveTitle"
            size="sm"
            persistent
        >
            <p class="sa-dialog__message">{{ msg.history.confirmRemoveMessage }}</p>
            <template #footer>
                <div class="sa-dialog__actions">
                    <q-btn v-close-popup flat :label="common.cancel" />
                    <q-btn
                        unelevated
                        color="negative"
                        :label="common.remove"
                        @click="confirmDelete"
                    />
                </div>
            </template>
        </AdminDialog>

        <MfaPromptDialog
            v-if="requireMfaForWrite"
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
import AdminTable from '../ui/data/AdminTable.vue';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { emailHistoryResource } from '../client/resources/platform-email.resource.js';
import { adminErrorMessage, httpStatusOf } from '../client/admin-error.js';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import AdminDialog from '../ui/overlay/AdminDialog.vue';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import type { PillTone } from '../vue/status.js';
import { computed, reactive, ref } from 'vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import type {
    EmailHistoryRow,
    EmailHistoryDetail,
    EmailHistoryStatus,
} from '../internal/email-history/email-history.types';

// Platform standard page: email history of the platform sender. Like all
// standard pages data-agnostic — the app passes the API calls as props (with
// its own auth/MFA wiring). List/detail are read-only; remove and resend
// are MFA-required.

const props = withDefaults(
    defineProps<{
        /**
         * Override the email-history resource for this page only. Layered over
         * the app's own override; see AP3 §3.2.
         */
        resources?: ResourceOverride<(typeof emailHistoryResource)['ops']>;
        title?: string;
        pageSize?: number;
        requireMfaForWrite?: boolean;
        mfaSetupHint?: string;
    }>(),
    {
        pageSize: 25,
        requireMfaForWrite: false,
    },
);

const notify = useSuperAdminNotify();

// The data layer, reached by name. The send log is served by the consuming app,
// at the path every consumer already calls.
const history = useResource('emailHistory', props.resources);
const msg = useSaMessages('email');
const errors = useSaMessages('errors');
const common = useSaMessages('common');
const shell = useSaMessages('shell');
const { intlLocale } = useSuperAdminI18n();

const resolvedTitle = computed(() => props.title ?? msg.value.history.title);

const rows = ref<EmailHistoryRow[]>([]);
const loading = ref(false);
const filter = reactive<{
    search: string;
    status: EmailHistoryStatus | null;
    from: string;
    to: string;
}>({ search: '', status: null, from: '', to: '' });

// Server always sorts createdAt desc — hence no sortBy/descending in the model.
const pagination = ref({
    page: 1,
    rowsPerPage: props.pageSize,
    rowsNumber: 0,
});

const statusOptions = computed(() => [
    { label: msg.value.history.statusSent, value: 'SENT' },
    { label: msg.value.history.statusFailed, value: 'FAILED' },
    { label: msg.value.history.statusPending, value: 'PENDING' },
    { label: msg.value.history.statusBounced, value: 'BOUNCED' },
]);

const columns = computed(() => [
    { name: 'status', label: common.value.status, field: 'status', align: 'left' as const },
    { name: 'toEmail', label: msg.value.recipient, field: 'toEmail', align: 'left' as const },
    {
        name: 'subject',
        label: msg.value.history.columnSubject,
        field: 'subject',
        align: 'left' as const,
    },
    { name: 'fromEmail', label: msg.value.sender, field: 'fromEmail', align: 'left' as const },
    {
        name: 'createdAt',
        label: msg.value.history.columnCreatedAt,
        field: (r: EmailHistoryRow) => formatTs(r.createdAt),
        align: 'left' as const,
    },
    {
        name: 'sentAt',
        label: msg.value.history.columnSentAt,
        field: (r: EmailHistoryRow) => formatTs(r.sentAt),
        align: 'left' as const,
    },
]);

const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<EmailHistoryDetail | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteId = ref<string | null>(null);

// MFA loop analogous to PlatformEmailPage (promise-resolver pattern).
const mfa = useMfaPrompt();

// Sequence guard: with rapidly changing filters a stale (out-of-order)
// response must not overwrite the newest.
let reloadSeq = 0;

async function reload(): Promise<void> {
    const seq = ++reloadSeq;
    loading.value = true;
    try {
        const result = await history.list({
            search: filter.search || undefined,
            status: filter.status || undefined,
            from: filter.from || undefined,
            to: filter.to || undefined,
            page: pagination.value.page,
            limit: pagination.value.rowsPerPage,
        });
        if (seq !== reloadSeq) return;
        // A body that is not the paginated envelope leaves both undefined, and
        // `rows=undefined` is a table that throws while rendering rather than
        // an empty one. The app's own endpoint decides this shape, so the page
        // reads it defensively — it is a system boundary, not internal code.
        rows.value = result?.rows ?? [];
        pagination.value.rowsNumber = result?.total ?? 0;
    } catch (err) {
        if (seq !== reloadSeq) return;
        rows.value = [];
        pagination.value.rowsNumber = 0;
        notify('negative', adminErrorMessage(err, errors.value));
    } finally {
        if (seq === reloadSeq) loading.value = false;
    }
}

void reload();
defineExpose({ reload });

// The pager owns page and size; both need a fetch, and a size change starts
// over at page 1 — the row it would land on otherwise is arbitrary.
function onPageChange(page: number): void {
    pagination.value.page = page;
    void reload();
}

function onRowsPerPageChange(rows: number): void {
    pagination.value.rowsPerPage = rows;
    pagination.value.page = 1;
    void reload();
}

function applyFilter(): void {
    pagination.value.page = 1;
    void reload();
}

async function openDetail(row: EmailHistoryRow): Promise<void> {
    detailOpen.value = true;
    detailLoading.value = true;
    detail.value = null;
    try {
        detail.value = await history.detail(row.id);
    } catch (err) {
        detailOpen.value = false;
        notify('negative', adminErrorMessage(err, errors.value));
    } finally {
        detailLoading.value = false;
    }
}

async function onResend(id: string): Promise<void> {
    const { ok, result } = await runWrite(msg.value.history.mfaResend, (code) =>
        history.resend(id, code || undefined),
    );
    if (!ok) return;
    if (result && result.success === false) {
        notify('negative', result.message ?? msg.value.history.sendFailed);
    } else {
        notify('positive', msg.value.history.resendSuccess);
    }
    await reload();
}

function askDelete(id: string): void {
    pendingDeleteId.value = id;
    confirmDeleteOpen.value = true;
}

async function confirmDelete(): Promise<void> {
    const id = pendingDeleteId.value;
    confirmDeleteOpen.value = false;
    if (!id) return;
    const { ok } = await runWrite(msg.value.history.mfaRemove, (code) =>
        history.remove(id, code || undefined),
    );
    if (!ok) return;
    notify('positive', msg.value.history.removeSuccess);
    if (detail.value?.id === id) detailOpen.value = false;
    await reload();
}

// MFA loop: on 401 the dialog stays open and asks again. Also returns the
// result of the write (for resend, whose SMTP outcome is in the body).
async function runWrite<T>(
    label: string,
    invoke: (code: string) => Promise<T>,
): Promise<{ ok: boolean; result?: T }> {
    if (!props.requireMfaForWrite) {
        try {
            const result = await invoke('');
            return { ok: true, result };
        } catch (err) {
            notify('negative', adminErrorMessage(err, errors.value));
            return { ok: false };
        }
    }
    for (;;) {
        const code = await mfa.prompt(label);
        if (code === null) return { ok: false };
        try {
            const result = await invoke(code);
            mfa.show.value = false;
            return { ok: true, result };
        } catch (err) {
            const status = httpStatusOf(err);
            if (status === 401) {
                mfa.error.value = shell.value.mfa.invalidCode;
                continue;
            }
            mfa.show.value = false;
            notify('negative', adminErrorMessage(err, errors.value));
            return { ok: false };
        }
    }
}

// Tone per delivery status. Exhaustive by construction: a new status fails this
// to compile until it is given one, rather than silently rendering as grey.
const STATUS_TONE: Readonly<Record<EmailHistoryStatus, PillTone>> = {
    SENT: 'positive',
    FAILED: 'negative',
    BOUNCED: 'warning',
    PENDING: 'muted',
};

function statusTone(status: EmailHistoryStatus): PillTone {
    return STATUS_TONE[status];
}

function statusLabel(status: EmailHistoryStatus): string {
    switch (status) {
        case 'SENT':
            return msg.value.history.statusSent;
        case 'FAILED':
            return msg.value.history.statusFailed;
        case 'BOUNCED':
            return msg.value.history.statusBounced;
        default:
            return msg.value.history.statusPending;
    }
}

function formatTs(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(intlLocale.value, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return String(iso);
    }
}
</script>

<style scoped>
.sa-emh__empty {
    width: 100%;
    text-align: center;
    color: var(--sa-color-fg-secondary, var(--sa-color-fg-muted));
    padding: var(--sa-space-7) 0;
}
.sa-emh__frame {
    width: 100%;
    min-height: 320px;
    max-height: 60vh;
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    background: var(--sa-color-bg-surface);
}
.sa-emh__text,
.sa-emh__smtp {
    background: var(--sa-color-bg-sunken);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-4);
    font-size: var(--sa-text-sm);
    margin: var(--sa-space-2) 0 0;
    overflow-x: auto;
    max-height: 50vh;
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
