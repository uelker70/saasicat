<template>
    <AdminPage class="sa-tenant-detail">
        <AdminHero :title="data?.name ?? labels.title">
            <template v-if="data" #subtitle>
                {{ labels.slug }}: <code>{{ data.slug }}</code>
            </template>
            <!--
                Back first, then the tenant-level actions, then whatever the app
                adds — the same order every other hero uses. Both are plain
                `.sa-btn` buttons: a hero is where a page's own actions live, and
                a detail page's "suspend" is exactly that. It used to sit on the
                master-data section instead, which read as an action on that one
                card rather than on the tenant.
            -->
            <template #actions>
                <button class="sa-btn" type="button" @click="goBack">
                    <q-icon name="arrow_back" size="16px" />
                    <span>{{ labels.back }}</span>
                </button>
                <button
                    v-for="action in manifestActions"
                    :key="action.def.id"
                    :class="['sa-btn', toneClass(action.def.actionKey)]"
                    type="button"
                    @click="action.onClick"
                >
                    <q-icon :name="iconForActionKey(action.def.actionKey)" size="16px" />
                    <span>{{ action.def.label }}</span>
                </button>
                <slot name="header-actions" :data="data" :reload="load" />
            </template>
        </AdminHero>

        <AdminBody :loading="loading" :empty="!data">
            <template v-if="data">
                <!-- Master data -->
                <AdminSection
                    :title="labels.masterData"
                    :subtitle="options?.stammdatenSub"
                    class="q-mb-md"
                >
                    <template #actions>
                        <slot name="card-actions" :data="data" :reload="load" />
                    </template>
                    <slot name="stammdaten" :data="data">
                        <TenantMasterData
                            :data="data"
                            :labels="labels"
                            :format-date="formatDateResolved"
                            :yes="common.yes"
                            :no="common.no"
                        >
                            <slot name="extra-stammdaten" :data="data" />
                        </TenantMasterData>
                    </slot>
                </AdminSection>

                <!-- Usage -->
                <AdminSection
                    v-if="(options?.verbrauchFields?.length ?? 0) > 0"
                    :title="labels.usage"
                    class="q-mb-md"
                >
                    <TenantUsage :data="data" :fields="options?.verbrauchFields ?? []" />
                </AdminSection>

                <!-- Users -->
                <AdminSection
                    v-if="options?.showUsers && data.users"
                    :title="labels.users"
                    class="q-mb-md"
                >
                    <TenantUsers
                        :users="data.users"
                        :columns="options?.userColumns ?? defaultUserColumns"
                    />
                </AdminSection>

                <slot name="extra-cards" :data="data" :reload="load" />
            </template>
        </AdminBody>

        <!-- Manifest-driven action flow dialogs -->
        <MfaPromptDialog
            :model-value="mfa.show.value"
            :description="mfa.description.value"
            :error="mfa.error.value"
            @update:model-value="mfa.onVisibility"
            @confirm="mfa.onConfirm"
        />
        <TenantActionConfirmDialog
            v-model="confirmState.show"
            :def="confirmState.def"
            :row="confirmState.row"
            @update:model-value="onConfirmDialogVisibility"
            @submit="onConfirmSubmit"
            @cancel="onConfirmCancel"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminBody from '../ui/page/AdminBody.vue';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import type { TenantDetailData, VerbrauchField } from '../internal/tenant-detail/types.js';
import type { QTableColumn } from 'quasar';
import { useSuperAdminNotify } from '../quasar/notify.js';
import type { AdminManifest, TenantActionDef, TenantDto } from '@saasicat/types';
import { formatMessage } from '../client/i18n/format.js';
import TenantMasterData from '../internal/tenant-detail/TenantMasterData.vue';
import TenantUsage from '../internal/tenant-detail/TenantUsage.vue';
import TenantUsers from '../internal/tenant-detail/TenantUsers.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import TenantActionConfirmDialog from '../features/tenant/TenantActionConfirmDialog.vue';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import { useTenantActionFlow } from '../vue/use-tenant-action-flow.js';

export type { TenantDetailData, VerbrauchField } from '../internal/tenant-detail/types.js';

/**
 * What an app may change about this page.
 *
 * One object rather than eighteen props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind the
 * last one.
 *
 * The thirteen `*Label` entries are overrides on top of the i18n catalog, not
 * the only source of those words — a page with no options still renders in the
 * operator's language.
 */
export interface TenantDetailPageOptions {
    /** Where the back link goes. */
    backRoute?: RouteLocationRaw;
    /** Manifest source for the suspend/reactivate card actions. */
    manifest?: AdminManifest | null;
    verbrauchFields?: VerbrauchField[];
    userColumns?: QTableColumn[];
    showUsers?: boolean;
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
}

const props = defineProps<{
    /**
     * Override the tenants resource for this page only — a different host,
     * or one operation wrapped. Layered over the app's own override; see
     * AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof tenantsResource)['ops']>;
    /**
     * Which tenant. Defaults to the route's `slug` param, which is where a
     * detail route puts it — an app only passes this when it mounts the
     * page outside such a route.
     */
    slug?: string;
    /** Presentation and capability. Never data, never a callback. */
    options?: TenantDetailPageOptions;
}>();

const msg = useSaMessages('tenants');
const common = useSaMessages('common');

// Every label stays overridable via props — only the German literals moved
// into the catalog.
const labels = computed(() => ({
    back: props.options?.backLabel ?? msg.value.detail.backToList,
    title: props.options?.titleLabel ?? msg.value.tenant,
    slug: props.options?.slugLabel ?? msg.value.detail.slug,
    masterData: props.options?.stammdatenLabel ?? msg.value.detail.masterData,
    plan: props.options?.planLabel ?? msg.value.plan,
    status: props.options?.statusLabel ?? common.value.status,
    pilot: props.options?.pilotLabel ?? msg.value.detail.pilot,
    trialEnd: props.options?.trialEndLabel ?? msg.value.detail.trialEnd,
    pilotEnd: props.options?.pilotEndLabel ?? msg.value.detail.pilotEnd,
    vatId: props.options?.vatIdLabel ?? msg.value.detail.vatId,
    usage: props.options?.verbrauchLabel ?? msg.value.detail.usage,
    users: props.options?.usersLabel ?? msg.value.detail.users,
}));

const notify = useSuperAdminNotify();
const data = ref<TenantDetailData | null>(null);
const loading = ref(false);

// The data layer, reached by name. The page used to take a pre-bound
// `loadDetail` prop, which meant every consumer wrote a closure over the route
// param just to hand the slug back to a call that could read it here.
const tenants = useResource('tenants', props.resources);
const route = useRoute();
const tenantSlug = computed(() => props.slug ?? String(route.params.slug ?? ''));

async function load(): Promise<void> {
    if (!tenantSlug.value) {
        data.value = null;
        return;
    }
    loading.value = true;
    try {
        data.value = (await tenants.detail(tenantSlug.value)) as TenantDetailData | null;
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

function formatDateResolved(value: string | null | undefined): string {
    return defaultFormatDate(value);
}

// ── Manifest-driven Action Flow (Suspend/Reactivate, Default) ──────────
const manifestRef = computed(() => props.options?.manifest ?? null);

const mfa = useMfaPrompt();

function showMfaDialog(def: TenantActionDef, ctx: { row: TenantDto }): Promise<string | null> {
    return mfa.prompt(
        formatMessage(msg.value.actions.mfaDescription, {
            action: def.label,
            tenant: ctx.row.name,
        }),
    );
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

const router = useRouter();

/**
 * The hero back button navigates rather than rendering a link.
 *
 * `backRoute` is a `RouteLocationRaw`, not an href, so there is no anchor to
 * build without duplicating the router's resolution — and every other hero in
 * the package uses a button for the same step.
 */
function goBack(): void {
    void router.push(props.options?.backRoute ?? '/admin/tenants');
}

function iconForActionKey(actionKey: string): string {
    if (actionKey.endsWith('.suspend')) return 'block';
    if (actionKey.endsWith('.reactivate')) return 'play_arrow';
    return 'bolt';
}

function toneClass(actionKey: string): string {
    if (actionKey.endsWith('.suspend')) return 'sa-btn--danger';
    if (actionKey.endsWith('.reactivate')) return 'sa-btn--positive';
    return 'sa-btn--primary';
}

const defaultUserColumns = computed<QTableColumn[]>(() => [
    { name: 'email', label: msg.value.detail.userEmail, field: 'email', align: 'left' },
    {
        name: 'name',
        label: common.value.name,
        field: (r: unknown) => {
            const row = r as Record<string, unknown>;
            return `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
        },
        align: 'left',
    },
    { name: 'role', label: msg.value.detail.userRole, field: 'role', align: 'left' },
    {
        name: 'status',
        label: common.value.status,
        field: (r: unknown) =>
            (r as Record<string, unknown>).isActive ? common.value.active : common.value.inactive,
        align: 'left',
    },
    {
        name: 'lastLogin',
        label: msg.value.detail.userLastLogin,
        field: (r: unknown) => {
            const v = (r as Record<string, unknown>).lastLoginAt;
            return v ? String(v).slice(0, 10) : '—';
        },
        align: 'left',
    },
]);
</script>

<style scoped>
.sa-tenant-detail__card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--sa-color-border-soft);
    padding-bottom: 14px;
    margin-bottom: 16px;
}
.sa-tenant-detail__card-sub {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-md);
    margin: 4px 0 0;
}
.sa-tenant-detail__card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}
.sa-tenant-detail__empty {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-md);
}
code {
    background: var(--sa-color-bg-sunken);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: var(--sa-text-sm);
}
</style>
