<template>
    <AdminPage class="sa-maintenance">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <template v-if="overview && !open">
                    <q-btn flat no-caps icon="lock" :label="msg.lockNow" @click="lock({})" />
                    <q-btn
                        flat
                        no-caps
                        icon="campaign"
                        :label="msg.announce"
                        @click="openDialog(null)"
                    />
                </template>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.loadFailed" :retry="reload" />

            <AdminSection :title="msg.open.title">
                <AdminEmptyState
                    v-if="overview && !open"
                    :title="msg.open.none"
                    :description="msg.open.noneHint"
                    size="inline"
                />
                <template v-if="open">
                    <AdminBanner v-if="open.status === 'locked'" tone="negative" icon="lock">
                        {{ formatMessage(msg.open.locked, { since: at(open.lockedAt) }) }}
                        <template v-if="open.overrun">
                            {{ formatMessage(msg.open.overrun, { end: at(open.endsAt) }) }}
                        </template>
                    </AdminBanner>
                    <AdminBanner v-else-if="open.lapsed" tone="warning">
                        {{ msg.open.lapsed }}
                    </AdminBanner>

                    <div class="sa-maintenance__facts">
                        <KvBlock
                            :label="msg.open.startsAt"
                            :value="open.startsAt ? at(open.startsAt) : msg.open.notAnnounced"
                        />
                        <KvBlock :label="msg.open.endsAt" :value="at(open.endsAt)" />
                        <KvBlock
                            v-if="open.status === 'locked'"
                            :label="msg.open.lockedBy"
                            :value="open.lockedBy ?? '—'"
                        />
                        <KvBlock v-else :label="msg.open.announcedBy" :value="open.createdBy" />
                        <KvBlock :label="msg.open.message" :value="open.message ?? '—'" />
                    </div>

                    <div class="sa-maintenance__actions">
                        <template v-if="open.status === 'locked'">
                            <q-btn
                                flat
                                no-caps
                                icon="lock_open"
                                :label="msg.open.unlock"
                                @click="unlock(open.id)"
                            />
                            <q-btn
                                flat
                                no-caps
                                icon="schedule"
                                :label="msg.open.reschedule"
                                @click="openDialog(open)"
                            />
                        </template>
                        <template v-else>
                            <q-btn
                                flat
                                no-caps
                                icon="lock"
                                :label="msg.open.lock"
                                @click="lock({ windowId: open.id })"
                            />
                            <q-btn
                                flat
                                no-caps
                                icon="schedule"
                                :label="msg.open.reschedule"
                                @click="openDialog(open)"
                            />
                            <q-btn
                                flat
                                no-caps
                                icon="event_busy"
                                :label="msg.open.cancel"
                                @click="cancel(open.id)"
                            />
                        </template>
                    </div>
                </template>
                <p v-if="overview" class="sa-maintenance__hint">
                    {{
                        formatMessage(msg.open.takesEffect, {
                            seconds: overview.takesEffectWithinSeconds,
                        })
                    }}
                </p>
            </AdminSection>

            <AdminSection :title="msg.recent.title">
                <AdminEmptyState
                    v-if="overview && recentRows.length === 0"
                    :title="msg.recent.empty"
                    size="inline"
                />
                <AdminTable
                    v-else
                    :rows="recentRows"
                    :columns="recentColumns"
                    row-key="id"
                    :loading="loading"
                    storage-key="maintenance-windows"
                >
                    <template #body-cell-status="{ row }">
                        <q-td>
                            <AdminStatusPill
                                :label="msg.status[row.status as MaintenanceWindowStatus]"
                                :tone="STATUS_TONE[row.status as MaintenanceWindowStatus]"
                                size="sm"
                            />
                        </q-td>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <MaintenanceWindowDialog
            v-model="dialogOpen"
            :window="dialogWindow"
            :announce="announce"
            :reschedule="reschedule"
        />

        <MfaPromptDialog
            :model-value="mfa.show.value"
            :description="mfa.description.value"
            :error="mfa.error.value"
            @update:model-value="mfa.onVisibility"
            @confirm="mfa.onConfirm"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MaintenanceWindowStatus, MaintenanceWindowView } from '@saasicat/core';

import { formatMessage, formatMoment } from '../client/i18n/format.js';
import type { maintenanceResource } from '../client/resources/maintenance.resource.js';
import MaintenanceWindowDialog from '../internal/maintenance/MaintenanceWindowDialog.vue';
import { useSuperAdminConfirm } from '../quasar/confirm.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import AdminTable from '../ui/data/AdminTable.vue';
import KvBlock from '../ui/data/KvBlock.vue';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useMaintenance } from '../vue/use-maintenance.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import type { PillTone } from '../vue/status.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: maintenance windows.
//
// What it answers is the operator's question before a deploy with a migration
// that must not race with requests: have the tenants been told, and are they
// out? Announcing tells them; locking puts them out until somebody unlocks —
// the announced end is what they were told, not when the lock ends
// (`SC-OPS-014`). Locking and unlocking ask for a confirmation and the second
// factor (`SC-ADM-029`).

const props = withDefaults(
    defineProps<{
        /** Override the maintenance resource for this page only — see AP3 §3.2. */
        resources?: ResourceOverride<(typeof maintenanceResource)['ops']>;
    }>(),
    {},
);

const STATUS_TONE: Readonly<Record<MaintenanceWindowStatus, PillTone>> = {
    announced: 'info',
    locked: 'negative',
    ended: 'muted',
    cancelled: 'muted',
};

const msg = useSaMessages('maintenance');
const { intlLocale } = useSuperAdminI18n();
const mfa = useMfaPrompt();
const { overview, loading, error, open, reload, announce, reschedule, cancel, lock, unlock } =
    useMaintenance(
        useResource('maintenance', props.resources),
        useSuperAdminNotify(),
        useSuperAdminConfirm(),
        mfa,
    );

const dialogOpen = ref(false);
const dialogWindow = ref<MaintenanceWindowView | null>(null);

function openDialog(window: MaintenanceWindowView | null): void {
    dialogWindow.value = window;
    dialogOpen.value = true;
}

const recentRows = computed(() =>
    // The resource checks the shape; a resource an application put in its place
    // may not, and a list that is not one must not take the route down.
    (Array.isArray(overview.value?.recent) ? overview.value.recent : []).map((window) => ({
        id: window.id,
        status: window.status,
        announcedFor: window.startsAt ? `${at(window.startsAt)} – ${at(window.endsAt)}` : '—',
        lockedAt: at(window.lockedAt),
        endedAt: at(window.endedAt),
        by: window.createdBy,
    })),
);

const recentColumns = computed(() => [
    { name: 'status', label: msg.value.recent.status, field: 'status', align: 'left' as const },
    {
        name: 'announcedFor',
        label: msg.value.recent.startsAt,
        field: 'announcedFor',
        align: 'left' as const,
    },
    {
        name: 'lockedAt',
        label: msg.value.recent.lockedAt,
        field: 'lockedAt',
        align: 'left' as const,
    },
    { name: 'endedAt', label: msg.value.recent.endedAt, field: 'endedAt', align: 'left' as const },
    { name: 'by', label: msg.value.recent.by, field: 'by', align: 'left' as const },
]);

/** A moment in the operator's own zone and language; a dash for none. */
function at(iso: string | null): string {
    return formatMoment(iso, intlLocale.value);
}
</script>

<style scoped>
.sa-maintenance__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-3);
}
/* A message is one long word as often as not; the tile must not push the
   grid wider than the page. */
.sa-maintenance__facts > * {
    min-width: 0;
    overflow-wrap: anywhere;
}
.sa-maintenance__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-4);
}
.sa-maintenance__hint {
    margin: var(--sa-space-3) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
</style>
