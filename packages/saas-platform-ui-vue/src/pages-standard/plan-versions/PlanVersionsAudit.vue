<template>
    <div class="sa-pv-audit">
        <div class="sa-pv-audit__card">
            <header class="sa-pv-audit__head">
                <q-icon name="history" size="18px" class="sa-pv-audit__head-icon" />
                <h3>Aktivität</h3>
                <span class="sa-pv-audit__count">{{ events.length }} Events</span>
                <q-space />
                <button v-if="!loading" type="button" class="sa-pv-audit__refresh" @click="reload">
                    <q-icon name="refresh" size="14px" /> Neu laden
                </button>
            </header>
            <div v-if="loading" class="sa-pv-audit__loading">
                <q-spinner size="20px" /> Audit-Trail wird geladen…
            </div>
            <div v-else-if="events.length === 0" class="sa-pv-audit__empty">
                Keine Plan-/Add-on-Events im Audit-Log gefunden.
            </div>
            <div v-else class="sa-pv-audit__list">
                <div
                    v-for="(e, i) in events"
                    :key="e.id"
                    class="sa-pv-audit__item"
                    :class="{ 'sa-pv-audit__item--last': i === events.length - 1 }"
                >
                    <div
                        class="sa-pv-audit__icon"
                        :style="{ background: `${meta(e.action).color}14` }"
                    >
                        <q-icon
                            :name="meta(e.action).icon"
                            size="17px"
                            :style="{ color: meta(e.action).color }"
                        />
                    </div>
                    <div class="sa-pv-audit__body">
                        <div class="sa-pv-audit__title-row">
                            <span class="sa-pv-audit__title">{{ meta(e.action).label }}</span>
                            <span class="sa-pv-audit__entity">{{ entityLabel(e) }}</span>
                        </div>
                        <div class="sa-pv-audit__detail">{{ detail(e) }}</div>
                        <div class="sa-pv-audit__meta">
                            <span
                                ><q-icon name="schedule" size="12px" />
                                {{ formatTsDe(e.createdAt) }}</span
                            >
                            <span v-if="actorEmail(e)">
                                <q-icon name="person" size="12px" /> {{ actorEmail(e) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { CatalogSnapshot } from '../../plan-versions-catalog.js';
import { formatTsDe } from './format.js';

// PlanVersionsAudit — data-agnostic. Consumers pass in a `loadAudit` loader
// that supplies events; the component filters them to match the current
// snapshot (drafts/active = everything ≤ 50, historical = ≤ asOf).
//
// The action meta map can be extended per app so that additional actions
// (e.g. app-specific audit keys) get their own icons and labels.

interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    /** Legacy style: nested user object with email. */
    user?: { email: string; firstName?: string; lastName?: string } | null;
    /** Platform style: flat userEmail field. */
    userEmail?: string | null;
}

interface ActionMeta {
    icon: string;
    color: string;
    label: string;
}

const props = withDefaults(
    defineProps<{
        snapshot: CatalogSnapshot;
        loadAudit: () => Promise<AuditRow[]>;
        actionMeta?: Record<string, ActionMeta>;
    }>(),
    {
        actionMeta: () => ({}),
    },
);

const loading = ref(false);
const events = ref<AuditRow[]>([]);

const DEFAULT_ACTION_META: Record<string, ActionMeta> = {
    PLAN_VERSION_PUBLISH: {
        icon: 'rocket_launch',
        color: '#047857',
        label: 'Plan publiziert',
    },
    PLAN_VERSION_DRAFT_CREATE: {
        icon: 'edit_note',
        color: '#b45309',
        label: 'Plan-Draft angelegt',
    },
    PLAN_VERSION_DRAFT_UPDATE: { icon: 'edit', color: '#3f6bff', label: 'Plan-Draft geändert' },
    PLAN_VERSION_DRAFT_DELETE: {
        icon: 'delete',
        color: '#dc2626',
        label: 'Plan-Draft gelöscht',
    },
    PLAN_CATALOG_UPDATE: {
        icon: 'rocket_launch',
        color: '#047857',
        label: 'Catalog publiziert',
    },
};

function meta(action: string): ActionMeta {
    return (
        props.actionMeta[action] ??
        DEFAULT_ACTION_META[action] ?? {
            icon: 'circle',
            color: '#64748b',
            label: action,
        }
    );
}

function entityLabel(e: AuditRow): string {
    const c = (e.changes ?? {}) as {
        planId?: string;
        key?: string;
        featureKey?: string;
        version?: number;
    };
    const versionPart = c.version != null ? ` v${c.version}` : '';
    if (c.planId) return `${c.planId}${versionPart}`;
    if (c.key) return `${c.key}${versionPart}`;
    if (c.featureKey) return `${c.featureKey}${versionPart}`;
    return e.entity;
}

function detail(e: AuditRow): string {
    const c = (e.changes ?? {}) as {
        changeNote?: string;
        nonRegressive?: boolean;
        changes?: unknown;
    };
    if (c.changeNote) return c.changeNote;
    if (c.nonRegressive === false) return 'Mit mindestens einer Verschlechterung publiziert.';
    if (Array.isArray(c.changes)) return `${c.changes.length} Felder geändert.`;
    return e.action;
}

function actorEmail(e: AuditRow): string | null {
    return e.user?.email ?? e.userEmail ?? null;
}

onMounted(reload);
watch(() => props.snapshot.id, reload);

async function reload(): Promise<void> {
    loading.value = true;
    try {
        const merged = await props.loadAudit();
        events.value = filterForSnapshot(merged);
    } finally {
        loading.value = false;
    }
}

function filterForSnapshot(rows: AuditRow[]): AuditRow[] {
    if (props.snapshot.kind !== 'historical' || !props.snapshot.asOf) return rows.slice(0, 50);
    const asOfMs = Date.parse(props.snapshot.asOf);
    return rows.filter((r) => Date.parse(r.createdAt) <= asOfMs).slice(0, 50);
}
</script>

<style scoped>
.sa-pv-audit {
    padding: 20px 28px;
}
.sa-pv-audit__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}
.sa-pv-audit__head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-pv-audit__head h3 {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-size: 15px;
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
}
.sa-pv-audit__head-icon {
    color: var(--sa-primary, #3f6bff);
}
.sa-pv-audit__count {
    font-size: 12px;
    color: var(--sa-muted, #64748b);
}
.sa-pv-audit__refresh {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sa-body, #1e293b);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.sa-pv-audit__loading,
.sa-pv-audit__empty {
    padding: 24px;
    color: var(--sa-muted, #64748b);
    display: flex;
    align-items: center;
    gap: 12px;
}

.sa-pv-audit__list {
    padding: 8px 0;
}
.sa-pv-audit__item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--sa-border-soft, #f1f5f9);
}
.sa-pv-audit__item--last {
    border-bottom: none;
}

.sa-pv-audit__icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.sa-pv-audit__body {
    flex: 1;
    min-width: 0;
}
.sa-pv-audit__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-pv-audit__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-heading, #0f172a);
}
.sa-pv-audit__entity {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--sa-muted, #64748b);
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 4px;
}
.sa-pv-audit__detail {
    font-size: 12.5px;
    color: var(--sa-body, #1e293b);
    margin-top: 3px;
    line-height: 1.4;
}
.sa-pv-audit__meta {
    font-size: 11px;
    color: var(--sa-muted, #64748b);
    margin-top: 4px;
    display: flex;
    gap: 10px;
}
.sa-pv-audit__meta span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
</style>
