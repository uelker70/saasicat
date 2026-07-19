<template>
    <div class="sa-emh">
        <header class="sa-emh__head">
            <div>
                <h1 class="sa-emh__title">{{ title }}</h1>
                <p class="sa-emh__sub">
                    Über den Plattform-Absender versendete System-Mails — Empfänger, Status und
                    Fehler.
                </p>
            </div>
            <q-btn flat icon="refresh" label="Neu laden" @click="applyFilter" />
        </header>

        <div class="sa-emh__body">
            <div class="sa-emh__filter">
                <q-input
                    v-model="filter.search"
                    outlined
                    dense
                    clearable
                    label="Suche (Empfänger, Betreff, Inhalt …)"
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
                    label="Status"
                    :options="statusOptions"
                    @update:model-value="applyFilter"
                />
                <q-input
                    v-model="filter.from"
                    outlined
                    dense
                    clearable
                    type="date"
                    label="Von"
                    @update:model-value="applyFilter"
                />
                <q-input
                    v-model="filter.to"
                    outlined
                    dense
                    clearable
                    type="date"
                    label="Bis"
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
                            <q-badge :color="statusColor(row.status)" :label="statusLabel(row.status)" />
                        </q-td>
                    </template>
                    <template #body-cell-actions="{ row }">
                        <q-td class="text-right">
                            <q-btn
                                flat
                                dense
                                icon="send"
                                color="primary"
                                title="Erneut senden"
                                @click.stop="onResend(row.id)"
                            />
                            <q-btn
                                flat
                                dense
                                icon="delete"
                                color="negative"
                                title="Aus Verlauf entfernen"
                                @click.stop="askDelete(row.id)"
                            />
                        </q-td>
                    </template>
                    <template #no-data>
                        <div class="sa-emh__empty">Keine E-Mails im Verlauf.</div>
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
                            <q-badge :color="statusColor(detail.status)" :label="statusLabel(detail.status)" />
                            <div class="text-h6 ellipsis">{{ detail.subject }}</div>
                        </div>
                        <div class="text-caption text-grey-7 q-mt-xs">
                            Von {{ detail.fromEmail }} · An {{ detail.toEmail }}
                            <span v-if="detail.ccEmail"> · Cc {{ detail.ccEmail }}</span>
                            <span v-if="detail.bccEmail"> · Bcc {{ detail.bccEmail }}</span>
                        </div>
                        <div class="text-caption text-grey-7">
                            Erstellt {{ formatTs(detail.createdAt) }} · Gesendet
                            {{ formatTs(detail.sentAt) }}
                        </div>
                    </q-card-section>

                    <q-card-section v-if="detail.status === 'FAILED' && detail.errorMessage" class="q-pt-none">
                        <q-banner dense class="bg-red-1 text-red-9 sa-emh__error">
                            <template #avatar><q-icon name="error" color="negative" /></template>
                            {{ detail.errorMessage }}
                        </q-banner>
                    </q-card-section>

                    <q-card-section class="q-pt-none">
                        <!-- Sandbox ohne Flags: kein Script, kein same-origin — sicheres
                             Vorschau-Rendering beliebiger E-Mail-HTML. -->
                        <iframe
                            v-if="detail.bodyHtml"
                            :srcdoc="detail.bodyHtml"
                            sandbox=""
                            referrerpolicy="no-referrer"
                            class="sa-emh__frame"
                        />
                        <pre v-else-if="detail.bodyText" class="sa-emh__text">{{ detail.bodyText }}</pre>
                        <div v-else class="text-grey-6">Kein Inhalt gespeichert.</div>
                    </q-card-section>

                    <q-card-section v-if="detail.smtpResponse" class="q-pt-none">
                        <div class="text-caption text-grey-7">SMTP-Antwort</div>
                        <pre class="sa-emh__smtp">{{ detail.smtpResponse }}</pre>
                    </q-card-section>

                    <q-card-actions align="right">
                        <q-btn
                            flat
                            color="negative"
                            icon="delete"
                            label="Entfernen"
                            @click="askDelete(detail.id)"
                        />
                        <q-btn
                            unelevated
                            color="primary"
                            icon="send"
                            label="Erneut senden"
                            @click="onResend(detail.id)"
                        />
                        <q-btn v-close-popup flat label="Schließen" />
                    </q-card-actions>
                </template>
            </q-card>
        </q-dialog>

        <q-dialog v-model="confirmDeleteOpen">
            <q-card class="sa-emh__confirm">
                <q-card-section>
                    <div class="text-h6">E-Mail entfernen</div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                    Diese E-Mail aus dem Verlauf entfernen? Der Eintrag wird ausgeblendet, bleibt
                    aber für das Audit erhalten.
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn v-close-popup flat label="Abbrechen" />
                    <q-btn unelevated color="negative" label="Entfernen" @click="confirmDelete" />
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
import { reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import type {
    EmailHistoryRow,
    EmailHistoryDetail,
    EmailHistoryFilter,
    EmailHistoryListResult,
    EmailHistoryResendResult,
    EmailHistoryStatus,
} from './email-history.types';

// Plattform-Standard-Page: E-Mail-Verlauf des Plattform-Absenders. Wie alle
// Standard-Pages datenagnostisch — die App reicht die API-Calls als Props (mit
// eigenem Auth-/MFA-Wiring). Liste/Detail sind read-only; Entfernen und Erneut-
// Senden sind MFA-pflichtig.

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
        title: 'Plattform-E-Mail-Verlauf',
        pageSize: 25,
        requireMfaForWrite: false,
    },
);

const q = useQuasar();

const rows = ref<EmailHistoryRow[]>([]);
const loading = ref(false);
const filter = reactive<{
    search: string;
    status: EmailHistoryStatus | null;
    from: string;
    to: string;
}>({ search: '', status: null, from: '', to: '' });

// Server sortiert immer createdAt desc — daher kein sortBy/descending im Model.
const pagination = ref({
    page: 1,
    rowsPerPage: props.pageSize,
    rowsNumber: 0,
});

const statusOptions = [
    { label: 'Gesendet', value: 'SENT' },
    { label: 'Fehlgeschlagen', value: 'FAILED' },
    { label: 'Ausstehend', value: 'PENDING' },
    { label: 'Bounced', value: 'BOUNCED' },
];

const columns = [
    { name: 'status', label: 'Status', field: 'status', align: 'left' as const },
    { name: 'toEmail', label: 'Empfänger', field: 'toEmail', align: 'left' as const },
    { name: 'subject', label: 'Betreff', field: 'subject', align: 'left' as const },
    { name: 'fromEmail', label: 'Absender', field: 'fromEmail', align: 'left' as const },
    {
        name: 'createdAt',
        label: 'Erstellt',
        field: (r: EmailHistoryRow) => formatTs(r.createdAt),
        align: 'left' as const,
    },
    {
        name: 'sentAt',
        label: 'Gesendet',
        field: (r: EmailHistoryRow) => formatTs(r.sentAt),
        align: 'left' as const,
    },
    { name: 'actions', label: '', field: 'id' as never, align: 'right' as const },
];

const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<EmailHistoryDetail | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteId = ref<string | null>(null);

// MFA-Loop analog PlatformEmailPage (Promise-Resolver-Pattern).
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
let pendingMfaResolve: ((code: string | null) => void) | null = null;

// Sequenz-Guard: bei schnell wechselnden Filtern darf eine veraltete (out-of-
// order) Antwort die neueste nicht überschreiben.
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
        q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
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
        q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
    } finally {
        detailLoading.value = false;
    }
}

async function onResend(id: string): Promise<void> {
    const { ok, result } = await runWrite('Plattform-Mail erneut senden', (code) =>
        props.resendEmail(id, code || undefined),
    );
    if (!ok) return;
    if (result && result.success === false) {
        q.notify({
            type: 'negative',
            message: result.message ?? 'Versand fehlgeschlagen',
            position: 'top',
        });
    } else {
        q.notify({ type: 'positive', message: 'E-Mail erneut versendet', position: 'top' });
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
    const { ok } = await runWrite('Plattform-Mail aus Verlauf entfernen', (code) =>
        props.deleteEmail(id, code || undefined),
    );
    if (!ok) return;
    q.notify({ type: 'positive', message: 'Aus Verlauf entfernt', position: 'top' });
    if (detail.value?.id === id) detailOpen.value = false;
    await reload();
}

// MFA-Loop: bei 401 bleibt der Dialog offen und fragt erneut. Liefert das
// Ergebnis des Writes mit zurück (für Resend, dessen SMTP-Ausgang im Body steht).
async function runWrite<T>(
    label: string,
    invoke: (code: string) => Promise<T>,
): Promise<{ ok: boolean; result?: T }> {
    if (!props.requireMfaForWrite) {
        try {
            const result = await invoke('');
            return { ok: true, result };
        } catch (err) {
            q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
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
                mfaError.value = 'TOTP-Code ungültig oder MFA nicht eingerichtet.';
                continue;
            }
            showMfa.value = false;
            q.notify({ type: 'negative', message: errMsg(err), position: 'top' });
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
            return 'Gesendet';
        case 'FAILED':
            return 'Fehlgeschlagen';
        case 'BOUNCED':
            return 'Bounced';
        default:
            return 'Ausstehend';
    }
}

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Aktion fehlgeschlagen'
    );
}

function formatTs(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('de-DE', {
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
