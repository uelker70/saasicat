<template>
    <AdminPage class="sa-pemail">
        <AdminHero :title="resolvedTitle" :subtitle="msg.provider.subtitle">
            <template #actions>
                <button
                    class="sa-btn sa-btn--primary"
                    type="button"
                    v-if="rows.length === 0"
                    @click="openCreate"
                >
                    <q-icon name="add" size="16px" />
                    <span>{{ msg.sender }}</span>
                </button>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection class="sa-pemail__card">
                <AdminTable
                    :rows="rows"
                    :columns="columns"
                    :loading="loading"
                    storage-key="platform-email"
                >
                    <template #body-cell-active="{ row }">
                        <q-td>
                            <q-badge
                                :color="row.active ? 'positive' : 'grey'"
                                :label="
                                    row.active
                                        ? msg.provider.statusActive
                                        : msg.provider.statusInactive
                                "
                            />
                        </q-td>
                    </template>
                    <template #row-actions="{ row }">
                        <q-btn
                            flat
                            dense
                            icon="send"
                            color="primary"
                            :title="msg.provider.sendTestMail"
                            @click="openTest(row)"
                        />
                        <q-btn
                            flat
                            dense
                            icon="edit"
                            color="grey-7"
                            :title="common.edit"
                            @click="openEdit(row)"
                        />
                        <q-btn
                            flat
                            dense
                            icon="delete"
                            color="negative"
                            :title="common.delete"
                            @click="onDelete(row)"
                        />
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <q-dialog v-model="showForm">
            <q-card class="sa-pemail__dialog">
                <q-card-section>
                    <div class="text-h6">
                        {{
                            editing ? msg.provider.dialogEditTitle : msg.provider.dialogCreateTitle
                        }}
                    </div>
                </q-card-section>
                <q-card-section class="q-gutter-sm">
                    <q-input v-model="form.name" outlined dense :label="common.name" />
                    <q-input
                        v-model="form.smtpHost"
                        outlined
                        dense
                        :label="msg.provider.fieldSmtpHost"
                    />
                    <q-input
                        v-model.number="form.smtpPort"
                        outlined
                        dense
                        type="number"
                        :label="msg.provider.fieldSmtpPort"
                    />
                    <q-input
                        v-model="form.smtpUser"
                        outlined
                        dense
                        :label="msg.provider.fieldSmtpUser"
                    />
                    <q-input
                        v-model="form.smtpPassword"
                        outlined
                        dense
                        type="password"
                        :label="
                            editing
                                ? msg.provider.fieldSmtpPasswordEdit
                                : msg.provider.fieldSmtpPassword
                        "
                    />
                    <q-select
                        v-model="form.encryption"
                        outlined
                        dense
                        :label="msg.provider.fieldEncryption"
                        :options="encryptionOptions"
                    />
                    <q-input
                        v-model="form.fromEmail"
                        outlined
                        dense
                        :label="msg.provider.fieldFromEmail"
                    />
                    <q-input
                        v-model="form.fromName"
                        outlined
                        dense
                        :label="msg.provider.fieldFromName"
                    />
                    <q-toggle v-if="editing" v-model="form.active" :label="common.active" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat :label="common.cancel" @click="showForm = false" />
                    <q-btn
                        unelevated
                        color="primary"
                        :label="editing ? common.save : common.create"
                        @click="onSubmit"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <q-dialog v-model="showTest">
            <q-card class="sa-pemail__dialog">
                <q-card-section>
                    <div class="text-h6">{{ msg.provider.sendTestMail }}</div>
                    <div class="text-caption text-grey-7">{{ testTarget?.name }}</div>
                </q-card-section>
                <q-card-section class="q-gutter-sm">
                    <q-input
                        v-model="testForm.toEmail"
                        outlined
                        dense
                        :label="msg.recipient"
                        type="email"
                    />
                    <q-input
                        v-model="testForm.subject"
                        outlined
                        dense
                        :label="msg.provider.fieldSubject"
                    />
                    <q-banner
                        v-if="testResult"
                        :class="testResult.success ? 'bg-green-1' : 'bg-red-1'"
                    >
                        {{ testResult.message }}
                    </q-banner>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat :label="common.close" @click="showTest = false" />
                    <q-btn
                        unelevated
                        color="primary"
                        :label="msg.provider.send"
                        :loading="testing"
                        @click="onTest"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

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
import AdminTable from '../components/admin-page/AdminTable.vue';
import { computed, reactive, ref } from 'vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useQuasar } from 'quasar';
import AdminRefreshBtn from '../components/admin-page/AdminRefreshBtn.vue';
import AdminBody from '../components/admin-page/AdminBody.vue';
import AdminHero from '../components/admin-page/AdminHero.vue';
import AdminSection from '../components/admin-page/AdminSection.vue';
import AdminPage from '../components/admin-page/AdminPage.vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
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
        testProvider: (
            id: string,
            input: PlatformEmailTestInput,
        ) => Promise<PlatformEmailTestResult>;
        title?: string;
        requireMfaForWrite?: boolean;
        mfaSetupHint?: string;
    }>(),
    {
        requireMfaForWrite: false,
    },
);

const q = useQuasar();
const notify = useSuperAdminNotify();
const msg = useSaMessages('email');
const common = useSaMessages('common');
const shell = useSaMessages('shell');
const rows = ref<PlatformEmailProvider[]>([]);
const loading = ref(false);

const resolvedTitle = computed(() => props.title ?? msg.value.provider.title);

const encryptionOptions = ['NONE', 'SSL', 'TLS', 'STARTTLS'];

const columns = computed(() => [
    { name: 'name', label: common.value.name, field: 'name', align: 'left' as const },
    {
        name: 'host',
        label: msg.value.provider.columnHost,
        field: (r: PlatformEmailProvider) => `${r.smtpHost}:${r.smtpPort}`,
        align: 'left' as const,
    },
    { name: 'fromEmail', label: msg.value.sender, field: 'fromEmail', align: 'left' as const },
    {
        name: 'encryption',
        label: msg.value.provider.columnEncryption,
        field: 'encryption',
        align: 'left' as const,
    },
    { name: 'active', label: common.value.status, field: 'active', align: 'left' as const },
]);

const showForm = ref(false);
const editing = ref<PlatformEmailProvider | null>(null);
const form = reactive<PlatformEmailWriteInput>(emptyForm());

const showTest = ref(false);
const testTarget = ref<PlatformEmailProvider | null>(null);
const testForm = reactive<PlatformEmailTestInput>({ toEmail: '', subject: '' });
const testResult = ref<PlatformEmailTestResult | null>(null);
const testing = ref(false);

// MFA loop analogous to UsersPage (promise-resolver pattern).
const mfa = useMfaPrompt();

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

function errMsg(err: unknown): string {
    return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        msg.value.errorAction
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
async function runWrite(
    label: string,
    invoke: (code: string) => Promise<unknown>,
): Promise<boolean> {
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
        const code = await mfa.prompt(label);
        if (code === null) return false;
        try {
            await invoke(code);
            mfa.show.value = false;
            return true;
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
                mfa.error.value = shell.value.mfa.invalidCode;
                continue;
            }
            mfa.show.value = false;
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
        formatMessage(current ? msg.value.provider.mfaSave : msg.value.provider.mfaCreate, {
            name: input.name,
        }),
        (code) =>
            current
                ? props.updateProvider(current.id, input, code || undefined)
                : props.createProvider(input, code || undefined),
    );
    if (ok) {
        showForm.value = false;
        notify('positive', msg.value.provider.saved);
        void reload();
    }
}

function onDelete(row: PlatformEmailProvider): void {
    q.dialog({
        title: msg.value.provider.deleteDialogTitle,
        message: formatMessage(msg.value.provider.deleteDialogMessage, { name: row.name }),
        cancel: common.value.cancel,
        ok: { label: common.value.delete, color: 'negative' },
    }).onOk(async () => {
        const ok = await runWrite(
            formatMessage(msg.value.provider.mfaDelete, { name: row.name }),
            (code) => props.deleteProvider(row.id, code || undefined),
        );
        if (ok) {
            notify('positive', msg.value.provider.deleted);
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
.sa-pemail__dialog {
    min-width: 420px;
}
</style>
