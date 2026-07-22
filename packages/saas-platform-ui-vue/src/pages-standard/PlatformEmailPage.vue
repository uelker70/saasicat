<template>
    <div class="sa-pemail">
        <header class="sa-page-head">
            <div>
                <h1 class="sa-page-head__title">{{ title }}</h1>
                <p class="sa-page-head__sub">
                    Zentraler Absender für Registrierungs- und System-Mails dieser Plattform.
                </p>
            </div>
            <div class="sa-page-head__actions">
                <q-btn
                    v-if="rows.length === 0"
                    unelevated
                    color="primary"
                    icon="add"
                    label="Absender"
                    @click="openCreate"
                />
                <q-btn flat icon="refresh" label="Neu laden" @click="reload" />
            </div>
        </header>

        <div class="sa-pemail__card">
            <q-table
                flat
                :rows="rows"
                :columns="columns"
                row-key="id"
                :loading="loading"
                :pagination="{ rowsPerPage: 0 }"
                hide-pagination
            >
                <template #body-cell-active="{ row }">
                    <q-td>
                        <q-badge
                            :color="row.active ? 'positive' : 'grey'"
                            :label="row.active ? 'aktiv' : 'inaktiv'"
                        />
                    </q-td>
                </template>
                <template #body-cell-actions="{ row }">
                    <q-td>
                        <q-btn
                            flat
                            dense
                            icon="send"
                            color="primary"
                            title="Test-Mail senden"
                            @click="openTest(row)"
                        />
                        <q-btn
                            flat
                            dense
                            icon="edit"
                            color="grey-7"
                            title="Bearbeiten"
                            @click="openEdit(row)"
                        />
                        <q-btn
                            flat
                            dense
                            icon="delete"
                            color="negative"
                            title="Löschen"
                            @click="onDelete(row)"
                        />
                    </q-td>
                </template>
            </q-table>
        </div>

        <q-dialog v-model="showForm">
            <q-card class="sa-pemail__dialog">
                <q-card-section>
                    <div class="text-h6">
                        {{ editing ? 'Absender bearbeiten' : 'Absender anlegen' }}
                    </div>
                </q-card-section>
                <q-card-section class="q-gutter-sm">
                    <q-input v-model="form.name" outlined dense label="Name" />
                    <q-input v-model="form.smtpHost" outlined dense label="SMTP-Host" />
                    <q-input
                        v-model.number="form.smtpPort"
                        outlined
                        dense
                        type="number"
                        label="SMTP-Port"
                    />
                    <q-input v-model="form.smtpUser" outlined dense label="SMTP-Benutzer" />
                    <q-input
                        v-model="form.smtpPassword"
                        outlined
                        dense
                        type="password"
                        :label="editing ? 'SMTP-Passwort (leer = unverändert)' : 'SMTP-Passwort'"
                    />
                    <q-select
                        v-model="form.encryption"
                        outlined
                        dense
                        label="Verschlüsselung"
                        :options="encryptionOptions"
                    />
                    <q-input v-model="form.fromEmail" outlined dense label="Absender-Adresse" />
                    <q-input v-model="form.fromName" outlined dense label="Absender-Name" />
                    <q-toggle v-if="editing" v-model="form.active" label="Aktiv" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Abbrechen" @click="showForm = false" />
                    <q-btn unelevated color="primary" :label="editing ? 'Speichern' : 'Anlegen'" @click="onSubmit" />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <q-dialog v-model="showTest">
            <q-card class="sa-pemail__dialog">
                <q-card-section>
                    <div class="text-h6">Test-Mail senden</div>
                    <div class="text-caption text-grey-7">{{ testTarget?.name }}</div>
                </q-card-section>
                <q-card-section class="q-gutter-sm">
                    <q-input v-model="testForm.toEmail" outlined dense label="Empfänger" type="email" />
                    <q-input v-model="testForm.subject" outlined dense label="Betreff (optional)" />
                    <q-banner v-if="testResult" :class="testResult.success ? 'bg-green-1' : 'bg-red-1'">
                        {{ testResult.message }}
                    </q-banner>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Schließen" @click="showTest = false" />
                    <q-btn
                        unelevated
                        color="primary"
                        label="Senden"
                        :loading="testing"
                        @click="onTest"
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
import { reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useSuperAdminNotify } from '../quasar/notify.js';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import type {
    PlatformEmailProvider,
    PlatformEmailWriteInput,
    PlatformEmailTestInput,
    PlatformEmailTestResult,
} from './platform-email.types';

// Platform standard page: system/platform email sender. Like all standard
// pages, data-agnostic — the app passes the API calls in as props (with its
// own auth/MFA wiring). Create/update/delete require MFA, the test send does
// not.

const props = withDefaults(
    defineProps<{
        loadProviders: () => Promise<PlatformEmailProvider[]>;
        createProvider: (input: PlatformEmailWriteInput, mfaCode?: string) => Promise<unknown>;
        updateProvider: (
            id: string,
            input: PlatformEmailWriteInput,
            mfaCode?: string,
        ) => Promise<unknown>;
        deleteProvider: (id: string, mfaCode?: string) => Promise<unknown>;
        testProvider: (id: string, input: PlatformEmailTestInput) => Promise<PlatformEmailTestResult>;
        title?: string;
        requireMfaForWrite?: boolean;
        mfaSetupHint?: string;
    }>(),
    {
        title: 'Plattform-E-Mail',
        requireMfaForWrite: false,
    },
);

const q = useQuasar();
const notify = useSuperAdminNotify();
const rows = ref<PlatformEmailProvider[]>([]);
const loading = ref(false);

const encryptionOptions = ['NONE', 'SSL', 'TLS', 'STARTTLS'];

const columns = [
    { name: 'name', label: 'Name', field: 'name', align: 'left' as const },
    {
        name: 'host',
        label: 'Host',
        field: (r: PlatformEmailProvider) => `${r.smtpHost}:${r.smtpPort}`,
        align: 'left' as const,
    },
    { name: 'fromEmail', label: 'Absender', field: 'fromEmail', align: 'left' as const },
    { name: 'encryption', label: 'Krypto', field: 'encryption', align: 'left' as const },
    { name: 'active', label: 'Status', field: 'active', align: 'left' as const },
    { name: 'actions', label: '', field: 'id' as never, align: 'right' as 'left' },
];

const showForm = ref(false);
const editing = ref<PlatformEmailProvider | null>(null);
const form = reactive<PlatformEmailWriteInput>(emptyForm());

const showTest = ref(false);
const testTarget = ref<PlatformEmailProvider | null>(null);
const testForm = reactive<PlatformEmailTestInput>({ toEmail: '', subject: '' });
const testResult = ref<PlatformEmailTestResult | null>(null);
const testing = ref(false);

// MFA loop analogous to UsersPage (promise-resolver pattern).
const showMfa = ref(false);
const mfaError = ref('');
const mfaDescription = ref('');
let pendingMfaResolve: ((code: string | null) => void) | null = null;

function emptyForm(): PlatformEmailWriteInput {
    return {
        name: '',
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        encryption: 'TLS',
        fromEmail: '',
        fromName: '',
        active: true,
    };
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

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Aktion fehlgeschlagen'
    );
}

async function reload(): Promise<void> {
    loading.value = true;
    try {
        rows.value = await props.loadProviders();
    } catch (err) {
        rows.value = [];
        notify('negative', errMsg(err));
    } finally {
        loading.value = false;
    }
}

void reload();
defineExpose({ reload });

function openCreate(): void {
    editing.value = null;
    Object.assign(form, emptyForm());
    showForm.value = true;
}

function openEdit(row: PlatformEmailProvider): void {
    editing.value = row;
    Object.assign(form, {
        name: row.name,
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        smtpUser: row.smtpUser,
        smtpPassword: '',
        encryption: row.encryption,
        fromEmail: row.fromEmail,
        fromName: row.fromName ?? '',
        active: row.active,
    });
    showForm.value = true;
}

// MFA loop: on 401 the dialog stays open and asks again.
async function runWrite(label: string, invoke: (code: string) => Promise<unknown>): Promise<boolean> {
    if (!props.requireMfaForWrite) {
        try {
            await invoke('');
            return true;
        } catch (err) {
            notify('negative', errMsg(err));
            return false;
        }
    }
    for (;;) {
        const code = await promptMfa(label);
        if (code === null) return false;
        try {
            await invoke(code);
            showMfa.value = false;
            return true;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfaError.value = 'TOTP-Code ungültig oder MFA nicht eingerichtet.';
                continue;
            }
            showMfa.value = false;
            notify('negative', errMsg(err));
            return false;
        }
    }
}

function buildWriteInput(): PlatformEmailWriteInput {
    const input: PlatformEmailWriteInput = {
        name: form.name,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpUser: form.smtpUser,
        encryption: form.encryption,
        fromEmail: form.fromEmail,
        fromName: form.fromName || undefined,
    };
    // Only send the password when set — on update, empty means "unchanged".
    if (form.smtpPassword && form.smtpPassword.length > 0) {
        input.smtpPassword = form.smtpPassword;
    }
    if (editing.value) {
        input.active = form.active;
    }
    return input;
}

async function onSubmit(): Promise<void> {
    const current = editing.value;
    const input = buildWriteInput();
    const ok = await runWrite(
        current ? `Absender "${input.name}" speichern.` : `Absender "${input.name}" anlegen.`,
        (code) =>
            current
                ? props.updateProvider(current.id, input, code || undefined)
                : props.createProvider(input, code || undefined),
    );
    if (ok) {
        showForm.value = false;
        notify('positive', 'Gespeichert.');
        void reload();
    }
}

function onDelete(row: PlatformEmailProvider): void {
    q.dialog({
        title: 'Absender löschen',
        message: `"${row.name}" wirklich löschen?`,
        cancel: 'Abbrechen',
        ok: { label: 'Löschen', color: 'negative' },
    }).onOk(async () => {
        const ok = await runWrite(`Absender "${row.name}" löschen.`, (code) =>
            props.deleteProvider(row.id, code || undefined),
        );
        if (ok) {
            notify('positive', 'Gelöscht.');
            void reload();
        }
    });
}

function openTest(row: PlatformEmailProvider): void {
    testTarget.value = row;
    testForm.toEmail = '';
    testForm.subject = '';
    testResult.value = null;
    showTest.value = true;
}

async function onTest(): Promise<void> {
    const target = testTarget.value;
    if (!target) return;
    testing.value = true;
    testResult.value = null;
    try {
        testResult.value = await props.testProvider(target.id, {
            toEmail: testForm.toEmail,
            subject: testForm.subject || undefined,
        });
    } catch (err) {
        testResult.value = { success: false, message: errMsg(err) };
    } finally {
        testing.value = false;
    }
}
</script>

<style scoped>
.sa-pemail {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
    padding: 20px 28px 28px;
}
.sa-pemail__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}
.sa-pemail__dialog {
    min-width: 420px;
}
</style>
