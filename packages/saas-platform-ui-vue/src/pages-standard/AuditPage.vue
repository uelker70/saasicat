<template>
    <div class="sa-audit">
        <header class="sa-audit__head">
            <div>
                <h1 class="sa-audit__title">Audit-Trail</h1>
                <p class="sa-audit__sub">{{ rows.length }} Einträge · plattformweit.</p>
            </div>
            <q-btn unelevated color="primary" icon="refresh" label="Filtern" @click="reload" />
        </header>

        <div class="sa-audit__body">
            <div class="sa-audit__filter">
                <q-input v-model="filter.actor" outlined dense label="Actor (E-Mail)" clearable />
                <q-input v-model="filter.action" outlined dense label="Action" clearable />
                <q-input v-model="filter.entity" outlined dense label="Entity" clearable />
                <q-input v-model="filter.since" outlined dense type="date" label="Seit" clearable />
            </div>

            <div class="sa-audit__card">
                <q-table
                    flat
                    :rows="rows"
                    :columns="columns"
                    row-key="id"
                    :pagination="{ rowsPerPage: 0 }"
                    :loading="loading"
                    hide-pagination
                >
                    <template #body-cell-changes="{ row }">
                        <q-td>
                            <q-btn flat dense icon="code" color="primary" @click="openDetail(row)">
                                <q-tooltip>Details</q-tooltip>
                            </q-btn>
                        </q-td>
                    </template>
                </q-table>
            </div>
        </div>

        <q-dialog v-model="detailOpen">
            <q-card style="min-width: 480px; max-width: 96vw">
                <q-card-section>
                    <div class="text-h6">{{ detail?.action }} · {{ detail?.entity }}</div>
                    <div class="text-caption text-grey-7">
                        {{ detail ? formatTs(detail.createdAt) : '' }} · Actor:
                        {{ detail ? actorEmail(detail) : '—' }}
                    </div>
                </q-card-section>
                <q-card-section>
                    <pre class="sa-audit__kv">{{
                        JSON.stringify(detail?.changes ?? {}, null, 2)
                    }}</pre>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn v-close-popup flat label="Schließen" />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';

// Plattform-Standard-Page: Audit-Trail. Datenagnostisch — App reicht
// `loadAudit({ actor, action, entity, since, limit })` durch.

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

interface AuditFilter {
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    limit?: number;
}

const props = defineProps<{
    loadAudit: (filter: AuditFilter) => Promise<AuditRow[]>;
    pageSize?: number;
}>();

const rows = ref<AuditRow[]>([]);
const loading = ref(false);
const filter = reactive({ actor: '', action: '', entity: '', since: '' });
const detailOpen = ref(false);
const detail = ref<AuditRow | null>(null);

const columns = [
    {
        name: 'createdAt',
        label: 'Zeit',
        field: (r: AuditRow) => formatTs(r.createdAt),
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'actor',
        label: 'Actor',
        field: actorEmail,
        align: 'left' as const,
    },
    { name: 'action', label: 'Action', field: 'action', align: 'left' as const },
    { name: 'entity', label: 'Entity', field: 'entity', align: 'left' as const },
    {
        name: 'entityId',
        label: 'ID',
        field: (r: AuditRow) => r.entityId.slice(0, 8),
        align: 'left' as const,
    },
    { name: 'changes', label: '', field: 'id', align: 'right' as const },
];

async function reload() {
    loading.value = true;
    try {
        rows.value = await props.loadAudit({
            actor: filter.actor || undefined,
            action: filter.action || undefined,
            entity: filter.entity || undefined,
            since: filter.since || undefined,
            limit: props.pageSize ?? 200,
        });
    } catch (err) {
        // Backend-Endpoint fehlt → leere Tabelle, keine Page-Crash.
        rows.value = [];
        console.warn('[AuditPage] loadAudit failed:', err);
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
.sa-audit {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
}
.sa-audit__head {
    padding: 20px 28px 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}
.sa-audit__title {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
    color: var(--sa-heading, #0f172a);
}
.sa-audit__sub {
    margin: 4px 0 0;
    color: var(--sa-muted-dark, #475569);
    font-size: 13.5px;
}
.sa-audit__body {
    padding: 12px 28px 28px;
}
.sa-audit__filter {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}
.sa-audit__filter > * {
    flex: 1;
    min-width: 180px;
}
.sa-audit__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    padding: 8px 0;
}
.sa-audit__kv {
    background: #f8fafc;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    margin: 0;
    overflow-x: auto;
    max-height: 50vh;
}
</style>
