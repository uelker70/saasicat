<template>
    <div class="sa-tenant-detail">
        <header class="sa-page-head">
            <div>
                <q-btn
                    flat
                    dense
                    icon="arrow_back"
                    :label="backLabel"
                    :to="backRoute"
                    class="sa-tenant-detail__back"
                />
                <h1 class="sa-page-head__title">{{ data?.name ?? titleLabel }}</h1>
                <p v-if="data" class="sa-page-head__sub">
                    {{ slugLabel }}: <code>{{ data.slug }}</code>
                </p>
            </div>
            <slot name="header-actions" :data="data" :reload="load" />
        </header>

        <div class="sa-tenant-detail__body">
            <div v-if="loading" class="sa-tenant-detail__state">
                <q-spinner size="32px" /> wird geladen…
            </div>

            <template v-else-if="data">
                <!-- Master data -->
                <div class="sa-card q-mb-md">
                    <header class="sa-tenant-detail__card-head">
                        <div>
                            <h2 class="sa-card__title">{{ stammdatenLabel }}</h2>
                            <p v-if="stammdatenSub" class="sa-tenant-detail__card-sub">
                                {{ stammdatenSub }}
                            </p>
                        </div>
                        <div class="sa-tenant-detail__card-actions">
                            <!-- Manifest-driven default actions (Suspend/Reactivate) -->
                            <q-btn
                                v-for="action in manifestActions"
                                :key="action.def.id"
                                outline
                                :color="toneColor(action.def.actionKey)"
                                :icon="iconForActionKey(action.def.actionKey)"
                                :label="action.def.label"
                                @click="action.onClick"
                            />
                            <slot name="card-actions" :data="data" :reload="load" />
                        </div>
                    </header>
                    <slot name="stammdaten" :data="data">
                        <div class="sa-tenant-detail__grid">
                            <KvBlock :label="planLabel" :value="data.subscription?.plan ?? '—'" />
                            <KvBlock
                                :label="statusLabel"
                                :value="data.subscription?.status ?? '—'"
                            />
                            <KvBlock
                                :label="pilotLabel"
                                :value="data.subscription?.isPilot ? 'ja' : 'nein'"
                            />
                            <KvBlock
                                :label="trialEndLabel"
                                :value="formatDate(data.subscription?.trialEndsAt)"
                            />
                            <KvBlock
                                :label="pilotEndLabel"
                                :value="formatDate(data.subscription?.pilotEndsAt)"
                            />
                            <KvBlock v-if="data.vatId" :label="vatIdLabel" :value="data.vatId" />
                            <slot name="extra-stammdaten" :data="data" />
                        </div>
                    </slot>
                </div>

                <!-- Usage -->
                <div v-if="verbrauchFields.length > 0" class="sa-card q-mb-md">
                    <h3 class="sa-card__title">{{ verbrauchLabel }}</h3>
                    <div class="sa-tenant-detail__grid">
                        <KvBlock
                            v-for="(field, i) in verbrauchFields"
                            :key="field.label + i"
                            :label="field.label"
                            :value="resolveVerbrauch(field)"
                        />
                    </div>
                </div>

                <!-- Users -->
                <div v-if="showUsers && data.users" class="sa-card q-mb-md">
                    <h3 class="sa-card__title">{{ usersLabel }}</h3>
                    <q-table
                        flat
                        :rows="data.users"
                        :columns="userColumns ?? DEFAULT_USER_COLUMNS"
                        row-key="id"
                        :pagination="{ rowsPerPage: 0 }"
                        hide-pagination
                    />
                </div>

                <slot name="extra-cards" :data="data" :reload="load" />
            </template>
        </div>

        <!-- Manifest-driven action flow dialogs -->
        <MfaPromptDialog
            v-model="mfaState.show"
            :description="mfaState.description"
            :error="mfaState.error"
            @update:model-value="onMfaDialogVisibility"
            @confirm="onMfaConfirm"
        />
        <TenantActionConfirmDialog
            v-model="confirmState.show"
            :def="confirmState.def"
            :row="confirmState.row"
            @update:model-value="onConfirmDialogVisibility"
            @submit="onConfirmSubmit"
            @cancel="onConfirmCancel"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { QTableColumn } from 'quasar';
import { useSuperAdminNotify } from '../quasar/notify.js';
import type { AdminManifest, TenantActionDef, TenantDto } from '@saasicat/types';
import KvBlock from '../components/KvBlock.vue';
import MfaPromptDialog from '../components/MfaPromptDialog.vue';
import TenantActionConfirmDialog from '../components/TenantActionConfirmDialog.vue';
import { useTenantActionFlow } from '../vue/use-tenant-action-flow.js';

export interface TenantDetailData {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    vatId?: string | null;
    subscription?: {
        plan?: string | null;
        status?: string | null;
        isPilot?: boolean | null;
        trialEndsAt?: string | null;
        pilotEndsAt?: string | null;
    } | null;
    users?: Array<Record<string, unknown> & { id: string }>;
    /** Freely selectable usage numbers — the page renders them via `verbrauchFields`. */
    counts?: Record<string, number | string>;
}

export interface VerbrauchField {
    label: string;
    /** Lookup key in `data.counts`. */
    key?: string;
    /** Alternative: custom getter. Takes precedence over `key`. */
    getter?: (data: TenantDetailData) => string | number;
}

const props = withDefaults(
    defineProps<{
        loadDetail: () => Promise<TenantDetailData>;
        backRoute: RouteLocationRaw;
        manifest: AdminManifest | null;
        verbrauchFields?: VerbrauchField[];
        userColumns?: QTableColumn[];
        showUsers?: boolean;
        formatDate?: (value: string | null | undefined) => string;
        // i18n labels
        backLabel?: string;
        titleLabel?: string;
        slugLabel?: string;
        stammdatenLabel?: string;
        stammdatenSub?: string;
        planLabel?: string;
        statusLabel?: string;
        pilotLabel?: string;
        trialEndLabel?: string;
        pilotEndLabel?: string;
        vatIdLabel?: string;
        verbrauchLabel?: string;
        usersLabel?: string;
    }>(),
    {
        verbrauchFields: () => [],
        showUsers: true,
        backLabel: 'Mandanten-Liste',
        titleLabel: 'Mandant',
        slugLabel: 'Slug',
        stammdatenLabel: 'Stammdaten',
        planLabel: 'Plan',
        statusLabel: 'Status',
        pilotLabel: 'Pilot',
        trialEndLabel: 'Trial-Ende',
        pilotEndLabel: 'Pilot-Ende',
        vatIdLabel: 'USt-IdNr.',
        verbrauchLabel: 'Verbrauch',
        usersLabel: 'User',
    },
);

const notify = useSuperAdminNotify();
const data = ref<TenantDetailData | null>(null);
const loading = ref(false);

async function load(): Promise<void> {
    loading.value = true;
    try {
        data.value = await props.loadDetail();
    } finally {
        loading.value = false;
    }
}

onMounted(load);

defineExpose({ reload: load });

function defaultFormatDate(value: string | null | undefined): string {
    if (!value) return '—';
    return String(value).slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
    return props.formatDate ? props.formatDate(value) : defaultFormatDate(value);
}

function resolveVerbrauch(field: VerbrauchField): string {
    if (!data.value) return '—';
    if (field.getter) return String(field.getter(data.value));
    if (field.key) {
        const v = data.value.counts?.[field.key];
        return v === undefined || v === null ? '0' : String(v);
    }
    return '—';
}

// ── Manifest-driven Action Flow (Suspend/Reactivate, Default) ──────────
const manifestRef = toRef(() => props.manifest);

const mfaState = ref<{ show: boolean; description: string; error: string }>({
    show: false,
    description: '',
    error: '',
});
let pendingMfaResolve: ((code: string | null) => void) | null = null;

function showMfaDialog(def: TenantActionDef, ctx: { row: TenantDto }): Promise<string | null> {
    return new Promise((resolve) => {
        mfaState.value = {
            show: true,
            description: `${def.label} — Tenant „${ctx.row.name}". TOTP-Code aus Authenticator eingeben.`,
            error: '',
        };
        pendingMfaResolve = (code) => {
            pendingMfaResolve = null;
            resolve(code);
        };
    });
}

function onMfaConfirm(code: string): void {
    pendingMfaResolve?.(code);
    mfaState.value.show = false;
}

function onMfaDialogVisibility(open: boolean): void {
    mfaState.value.show = open;
    if (!open && pendingMfaResolve) pendingMfaResolve(null);
}

const confirmState = ref<{
    show: boolean;
    def: TenantActionDef | null;
    row: TenantDto | null;
}>({ show: false, def: null, row: null });
let pendingConfirmResolve: ((result: { ok: boolean; reason?: string | null }) => void) | null =
    null;

function showConfirmDialog(
    def: TenantActionDef,
    ctx: { row: TenantDto },
): Promise<{ ok: boolean; reason?: string | null }> {
    return new Promise((resolve) => {
        confirmState.value = { show: true, def, row: ctx.row };
        pendingConfirmResolve = (result) => {
            pendingConfirmResolve = null;
            resolve(result);
        };
    });
}

function onConfirmSubmit(payload: { reason: string | null }): void {
    pendingConfirmResolve?.({ ok: true, reason: payload.reason });
    confirmState.value.show = false;
}

function onConfirmCancel(): void {
    pendingConfirmResolve?.({ ok: false });
    confirmState.value.show = false;
}

function onConfirmDialogVisibility(open: boolean): void {
    confirmState.value.show = open;
    if (!open && pendingConfirmResolve) pendingConfirmResolve({ ok: false });
}

const SUPPORTED_ACTION_KEYS = new Set(['tenants.suspend', 'tenants.reactivate']);

const tenantRow = computed<TenantDto | null>(() => {
    const t = data.value;
    if (!t) return null;
    return { id: t.id, slug: t.slug, name: t.name, isActive: t.isActive, deletedAt: null };
});

const flow = useTenantActionFlow<TenantDto>(manifestRef, {
    confirm: showConfirmDialog,
    mfa: showMfaDialog,
    notify,
    onSuccess: () => void load(),
    visibleForRow: (def, row) => {
        if (def.actionKey === 'tenants.suspend') return row.isActive;
        if (def.actionKey === 'tenants.reactivate') return !row.isActive;
        return true;
    },
});

const manifestActions = computed(() => {
    const row = tenantRow.value;
    if (!row) return [];
    return flow
        .actionsForRow(row)
        .filter((a) => SUPPORTED_ACTION_KEYS.has(a.def.actionKey))
        .map((a) => ({ def: a.def, onClick: () => void a.invoke(row) }));
});

function iconForActionKey(actionKey: string): string {
    if (actionKey.endsWith('.suspend')) return 'block';
    if (actionKey.endsWith('.reactivate')) return 'play_arrow';
    return 'bolt';
}

function toneColor(actionKey: string): string {
    if (actionKey.endsWith('.suspend')) return 'negative';
    if (actionKey.endsWith('.reactivate')) return 'positive';
    return 'primary';
}

const DEFAULT_USER_COLUMNS: QTableColumn[] = [
    { name: 'email', label: 'E-Mail', field: 'email', align: 'left' },
    {
        name: 'name',
        label: 'Name',
        field: (r: unknown) => {
            const row = r as Record<string, unknown>;
            return `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
        },
        align: 'left',
    },
    { name: 'role', label: 'Rolle', field: 'role', align: 'left' },
    {
        name: 'status',
        label: 'Status',
        field: (r: unknown) => ((r as Record<string, unknown>).isActive ? 'aktiv' : 'deaktiviert'),
        align: 'left',
    },
    {
        name: 'lastLogin',
        label: 'Letzter Login',
        field: (r: unknown) => {
            const v = (r as Record<string, unknown>).lastLoginAt;
            return v ? String(v).slice(0, 10) : '—';
        },
        align: 'left',
    },
];
</script>

<style scoped>
.sa-tenant-detail {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app);
}
.sa-tenant-detail__back {
    margin-bottom: 6px;
}
.sa-tenant-detail__body {
    padding: 12px 28px 28px;
}
.sa-tenant-detail__card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--sa-border-soft);
    padding-bottom: 14px;
    margin-bottom: 16px;
}
.sa-tenant-detail__card-sub {
    color: var(--sa-muted);
    font-size: 13px;
    margin: 4px 0 0;
}
.sa-tenant-detail__card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}
.sa-tenant-detail__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
}
.sa-tenant-detail__state {
    padding: 32px 0;
    color: var(--sa-muted);
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-tenant-detail__empty {
    color: var(--sa-muted);
    font-size: 13px;
}
code {
    background: rgba(15, 23, 42, 0.06);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 12px;
}
</style>
