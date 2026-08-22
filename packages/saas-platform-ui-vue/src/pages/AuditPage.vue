<template>
    <AdminPage class="sa-audit">
        <AdminHero
            :title="msg.title"
            :subtitle="formatMessage(msg.subtitle, { count: rows.length })"
        >
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection class="sa-audit__card">
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="filter.actor"
                        outlined
                        dense
                        :label="msg.filters.actor"
                        clearable
                        debounce="250"
                        @update:model-value="reload"
                    />
                    <q-input
                        v-model="filter.action"
                        outlined
                        dense
                        :label="msg.filters.action"
                        clearable
                        debounce="250"
                        @update:model-value="reload"
                    />
                    <q-input
                        v-model="filter.entity"
                        outlined
                        dense
                        :label="msg.filters.entity"
                        clearable
                        debounce="250"
                        @update:model-value="reload"
                    />
                    <q-input
                        v-model="filter.since"
                        outlined
                        dense
                        type="date"
                        :label="msg.filters.since"
                        clearable
                        @update:model-value="reload"
                    />
                </AdminFilters>

                <AdminTable :rows="rows" :columns="columns" :loading="loading" storage-key="audit">
                    <template #body-cell-changes="{ row }">
                        <q-td>
                            <q-btn flat dense icon="code" color="primary" @click="openDetail(row)">
                                <q-tooltip>{{ common.details }}</q-tooltip>
                            </q-btn>
                        </q-td>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <AdminDialog
            v-model="detailOpen"
            :title="`${detail?.action ?? ''} · ${detail?.entity ?? ''}`"
            :subtitle="detailSubtitle"
            size="md"
        >
            <pre class="sa-audit__kv">{{ JSON.stringify(detail?.changes ?? {}, null, 2) }}</pre>
            <template #footer>
                <div class="sa-dialog__actions">
                    <q-btn v-close-popup flat :label="common.close" />
                </div>
            </template>
        </AdminDialog>
    </AdminPage>
</template>

<script setup lang="ts">
import AdminTable from '../ui/data/AdminTable.vue';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { auditResource } from '../client/resources/audit.resource.js';
import AdminDialog from '../ui/overlay/AdminDialog.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: audit trail. It reads the platform's audit resource
// itself, so an app that wants the standard page writes no loader — and an app
// that needs the call diverted overrides that one operation.

export interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    user?: { email: string; firstName?: string; lastName?: string } | null;
    userEmail?: string | null;
}

const props = defineProps<{
    /**
     * Override the audit resource for this page only — a different host, or
     * the call wrapped. Layered over the app's own override; see AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof auditResource)['ops']>;
    /** How many entries to ask for. The endpoint caps this server-side. */
    pageSize?: number;
}>();

// The data layer, reached by name. The page used to take a `loadAudit` prop and
// every consumer spelled `/admin/audit` again.
const audit = useResource('audit', props.resources);

const msg = useSaMessages('audit');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const rows = ref<AuditRow[]>([]);
const loading = ref(false);
const filter = reactive({ actor: '', action: '', entity: '', since: '' });
const detailOpen = ref(false);
const detail = ref<AuditRow | null>(null);

// When and by whom, as one line — AdminDialog takes a subtitle as text.
const detailSubtitle = computed(() => {
    const row = detail.value;
    if (!row) return undefined;
    return `${formatTs(row.createdAt)} · ${msg.value.detailActorPrefix} ${actorEmail(row)}`;
});

const columns = computed(() => [
    {
        name: 'createdAt',
        label: msg.value.columns.time,
        field: (r: AuditRow) => formatTs(r.createdAt),
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'actor',
        label: msg.value.columns.actor,
        field: actorEmail,
        align: 'left' as const,
    },
    { name: 'action', label: msg.value.columns.action, field: 'action', align: 'left' as const },
    { name: 'entity', label: msg.value.columns.entity, field: 'entity', align: 'left' as const },
    {
        name: 'entityId',
        label: msg.value.columns.id,
        field: (r: AuditRow) => r.entityId.slice(0, 8),
        align: 'left' as const,
    },
    { name: 'changes', label: '', field: 'id', align: 'right' as const },
]);

async function reload() {
    loading.value = true;
    try {
        rows.value = await audit.list({
            actor: filter.actor || undefined,
            action: filter.action || undefined,
            entity: filter.entity || undefined,
            since: filter.since || undefined,
            limit: props.pageSize ?? 200,
        });
    } catch (err) {
        // Backend endpoint missing → empty table, no page crash.
        rows.value = [];
        console.warn('[AuditPage] loading the audit trail failed:', err);
    } finally {
        loading.value = false;
    }
}

onMounted(reload);

function openDetail(row: AuditRow) {
    detail.value = row;
    detailOpen.value = true;
}

function actorEmail(r: AuditRow): string {
    return r.user?.email ?? r.userEmail ?? '—';
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
.sa-audit__kv {
    background: var(--sa-color-bg-sunken);
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    padding: 12px;
    font-size: var(--sa-text-sm);
    margin: 0;
    overflow-x: auto;
    max-height: 50vh;
}
</style>
