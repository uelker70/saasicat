<template>
    <div class="sa-emh">
        <header class="sa-emh__head">
            <div>
                <h1 class="sa-emh__title">{{ resolvedTitle }}</h1>
                <p class="sa-emh__sub">{{ msg.history.subtitle }}</p>
            </div>
            <q-btn flat icon="refresh" :label="common.reload" @click="applyFilter" />
        </header>

        <div class="sa-emh__body">
            <div class="sa-emh__filter">
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
            </div>

            <div class="sa-emh__card">
                <q-table
                    v-model:pagination="pagination"
                    flat
                    :rows="rows"
                    :columns="columns"
                    row-key="id"
                    :loading="loading"
                    :rows-number="pagination.rowsNumber"
                    @request="onRequest"
                    @row-click="(_evt, row) => openDetail(row)"
                >
                    <template #body-cell-status="{ row }">
                        <q-td>
                            <q-badge
                                :color="statusColor(row.status)"
                                :label="statusLabel(row.status)"
                            />
                        </q-td>
                    </template>
                    <template #body-cell-actions="{ row }">
                        <q-td class="text-right">
                            <q-btn
                                flat
                                dense
                                icon="send"
                                color="primary"
                                :title="msg.history.resend"
                                @click.stop="onResend(row.id)"
                            />
                            <q-btn
                                flat
                                dense
                                icon="delete"
                                color="negative"
                                :title="msg.history.removeFromHistory"
                                @click.stop="askDelete(row.id)"
                            />
                        </q-td>
                    </template>
                    <template #no-data>
                        <div class="sa-emh__empty">{{ msg.history.empty }}</div>
                    </template>
                </q-table>
            </div>
        </div>

        <q-dialog v-model="detailOpen">
            <q-card class="sa-emh__detail">
                <q-inner-loading :showing="detailLoading" />
                <template v-if="detail">
                    <q-card-section>
                        <div class="row items-center no-wrap q-gutter-sm">
                            <q-badge
                                :color="statusColor(detail.status)"
                                :label="statusLabel(detail.status)"
                            />
                            <div class="text-h6 ellipsis">{{ detail.subject }}</div>
                        </div>
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
                    </q-card-section>

                    <q-card-section
                        v-if="detail.status === 'FAILED' && detail.errorMessage"
                        class="q-pt-none"
                    >
                        <q-banner dense class="bg-red-1 text-red-9 sa-emh__error">
                            <template #avatar><q-icon name="error" color="negative" /></template>
                            {{ detail.errorMessage }}
                        </q-banner>
                    </q-card-section>

                    <q-card-section class="q-pt-none">
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
                    </q-card-section>

                    <q-card-section v-if="detail.smtpResponse" class="q-pt-none">
                        <div class="text-caption text-grey-7">{{ msg.history.smtpResponse }}</div>
                        <pre class="sa-emh__smtp">{{ detail.smtpResponse }}</pre>
                    </q-card-section>

                    <q-card-actions align="right">
                        <q-btn
                            flat
                            color="negative"
                            icon="delete"
                            :label="msg.history.remove"
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
                    </q-card-actions>
                </template>
            </q-card>
        </q-dialog>

        <q-dialog v-model="confirmDeleteOpen">
            <q-card class="sa-emh__confirm">
                <q-card-section>
                    <div class="text-h6">{{ msg.history.confirmRemoveTitle }}</div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                    {{ msg.history.confirmRemoveMessage }}
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn v-close-popup flat :label="common.cancel" />
                    <q-btn
                        unelevated
                        color="negative"
                        :label="msg.history.remove"
                        @click="confirmDelete"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <MfaPromptDialog
            v-if="requireMfaForWrite"
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
import { computed, reactive, ref } from 'vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import type {
    EmailHistoryRow,
    EmailHistoryDetail,
    EmailHistoryFilter,
    EmailHistoryListResult,
    EmailHistoryResendResult,
    EmailHistoryStatus,
} from './email-history.types';

// Platform standard page: email history of the platform sender. Like all
// standard pages data-agnostic — the app passes the API calls as props (with
// its own auth/MFA wiring). List/detail are read-only; remove and resend
// are MFA-required.

const props = withDefaults(
    defineProps<{
        loadEmails: (filter: EmailHistoryFilter) => Promise<EmailHistoryListResult>;
        loadEmailDetail: (id: string) => Promise<EmailHistoryDetail>;
        deleteEmail: (id: string, mfaCode?: string) => Promise<unknown>;
        resendEmail: (id: string, mfaCode?: string) => Promise<EmailHistoryResendResult>;
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
const msg = useSaMessages('email');
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
    { name: 'actions', label: '', field: 'id' as never, align: 'right' as const },
]);

const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<EmailHistoryDetail | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteId = ref<string | null>(null);

// MFA loop analogous to PlatformEmailPage (promise-resolver pattern).
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
let pendingMfaResolve: ((code: string | null) => void) | null = null;

// Sequence guard: with rapidly changing filters a stale (out-of-order)
// response must not overwrite the newest.
let reloadSeq = 0;

async function reload(): Promise<void> {
    const seq = ++reloadSeq;
    loading.value = true;
    try {
        const result = await props.loadEmails({
            search: filter.search || undefined,
            status: filter.status || undefined,
            from: filter.from || undefined,
            to: filter.to || undefined,
            page: pagination.value.page,
            limit: pagination.value.rowsPerPage,
        });
        if (seq !== reloadSeq) return;
        rows.value = result.rows;
        pagination.value.rowsNumber = result.total;
    } catch (err) {
        if (seq !== reloadSeq) return;
        rows.value = [];
        pagination.value.rowsNumber = 0;
        notify('negative', errMsg(err));
    } finally {
        if (seq === reloadSeq) loading.value = false;
    }
}

void reload();
defineExpose({ reload });

async function onRequest(req: {
    pagination: { page: number; rowsPerPage: number };
}): Promise<void> {
    pagination.value.page = req.pagination.page;
    pagination.value.rowsPerPage = req.pagination.rowsPerPage;
    await reload();
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
        detail.value = await props.loadEmailDetail(row.id);
    } catch (err) {
        detailOpen.value = false;
        notify('negative', errMsg(err));
    } finally {
        detailLoading.value = false;
    }
}

async function onResend(id: string): Promise<void> {
    const { ok, result } = await runWrite(msg.value.history.mfaResend, (code) =>
        props.resendEmail(id, code || undefined),
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
        props.deleteEmail(id, code || undefined),
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
            notify('negative', errMsg(err));
            return { ok: false };
        }
    }
    for (;;) {
        const code = await promptMfa(label);
        if (code === null) return { ok: false };
        try {
            const result = await invoke(code);
            showMfa.value = false;
            return { ok: true, result };
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfaError.value = shell.value.mfa.invalidCode;
                continue;
            }
            showMfa.value = false;
            notify('negative', errMsg(err));
            return { ok: false };
        }
    }
}

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

function statusColor(status: EmailHistoryStatus): string {
    switch (status) {
        case 'SENT':
            return 'positive';
        case 'FAILED':
            return 'negative';
        case 'BOUNCED':
            return 'orange';
        default:
            return 'grey';
    }
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

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        msg.value.errorAction
    );
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
.sa-emh {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
}
.sa-emh__head {
    padding: 20px 28px 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}
.sa-emh__title {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
    color: var(--sa-heading, #0f172a);
}
.sa-emh__sub {
    margin: 4px 0 0;
    color: var(--sa-muted-dark, #475569);
    font-size: 13.5px;
}
.sa-emh__body {
    padding: 12px 28px 28px;
}
.sa-emh__filter {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}
.sa-emh__filter > * {
    flex: 1;
    min-width: 180px;
}
.sa-emh__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    padding: 8px 0;
}
.sa-emh__empty {
    width: 100%;
    text-align: center;
    color: var(--sa-muted-dark, #64748b);
    padding: 24px 0;
}
.sa-emh__detail {
    min-width: 560px;
    max-width: 96vw;
}
.sa-emh__confirm {
    min-width: 380px;
    max-width: 96vw;
}
.sa-emh__error {
    border-radius: 8px;
}
.sa-emh__frame {
    width: 100%;
    min-height: 320px;
    max-height: 60vh;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    background: #fff;
}
.sa-emh__text,
.sa-emh__smtp {
    background: #f8fafc;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    margin: 4px 0 0;
    overflow-x: auto;
    max-height: 50vh;
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
