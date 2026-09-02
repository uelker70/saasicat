<template>
    <AdminPage class="sa-settings">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.loadFailed" :retry="reload" />

            <AdminSection :title="msg.applied.title">
                <AdminBanner v-if="view && !view.recorded" tone="warning">
                    {{ msg.applied.notRecorded }}
                </AdminBanner>
                <AdminBanner v-else-if="view && view.appliedAt === null" tone="warning">
                    {{ msg.applied.recordStale }}
                </AdminBanner>
                <div v-if="view" class="sa-settings__facts">
                    <KvBlock :label="msg.applied.appliedAt" :value="appliedAtLabel" />
                    <KvBlock :label="msg.applied.source" :value="view.source" />
                    <KvBlock :label="msg.applied.fingerprint" :value="view.fingerprint" />
                </div>
                <p class="sa-settings__hint">{{ msg.applied.readOnly }}</p>
            </AdminSection>

            <AdminSection :title="msg.changes.title">
                <AdminEmptyState
                    v-if="view && view.changes.length === 0"
                    :title="msg.changes.empty"
                    size="inline"
                />
                <article
                    v-for="change in view?.changes ?? []"
                    :key="change.id"
                    class="sa-settings__change"
                    :data-acknowledged="change.acknowledgedAt ? '' : undefined"
                >
                    <header class="sa-settings__change-head">
                        <AdminStatusPill
                            :label="
                                change.acknowledgedAt ? msg.changes.acknowledged : msg.changes.open
                            "
                            :tone="change.acknowledgedAt ? 'muted' : 'warning'"
                            size="sm"
                        />
                        <span class="sa-settings__noticed">
                            {{ msg.changes.noticedAt }} {{ formatDateTime(change.noticedAt) }}
                        </span>
                        <span v-if="change.acknowledgedAt" class="sa-settings__seen">
                            {{ seenBy(change) }}
                        </span>
                        <q-btn
                            v-else
                            flat
                            dense
                            no-caps
                            :label="msg.changes.acknowledge"
                            :loading="acknowledging === change.id"
                            @click="acknowledge(change.id)"
                        />
                    </header>
                    <AdminTable
                        :rows="change.differences"
                        :columns="differenceColumns"
                        row-key="path"
                        :storage-key="`settings-change-${change.id}`"
                    />
                </article>
            </AdminSection>

            <AdminSection :title="msg.values.title">
                <AdminTable
                    :rows="runningValues"
                    :columns="valueColumns"
                    row-key="path"
                    :loading="loading"
                    storage-key="settings-values"
                />
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { settingsResource } from '../client/resources/settings.resource.js';
import type { SettingsChangeView } from '../client/resources/settings.resource.js';
import { flattenSettings, showSettingValue } from '../client/settings-view.js';
import AdminTable from '../ui/data/AdminTable.vue';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import KvBlock from '../ui/data/KvBlock.vue';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useAppliedSettings } from '../vue/use-applied-settings.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import { formatMessage } from '../client/i18n/format.js';

// Platform standard page: the applied configuration, read-only.
//
// What it answers is the question an operator has after editing
// config/saas.yaml: has it landed? The timestamp is the requirement, not
// decoration — "applied 22 Aug 14:03, from /srv/app/config/saas.yaml" is the
// whole answer to somebody whose edit an hour ago has not. There are no
// editing controls, and there will not be: the file is the one place a setting
// lives. The one action here marks a change as seen.

const props = withDefaults(
    defineProps<{
        /** Override the settings resource for this page only — see AP3 §3.2. */
        resources?: ResourceOverride<(typeof settingsResource)['ops']>;
    }>(),
    {},
);

const msg = useSaMessages('settings');
const { intlLocale } = useSuperAdminI18n();
// The data layer, reached by name — no endpoint to pass in.
const { view, loading, error, acknowledging, reload, acknowledge } = useAppliedSettings(
    useResource('settings', props.resources),
    useSuperAdminNotify(),
);

const appliedAtLabel = computed(() => formatDateTime(view.value?.appliedAt ?? null) ?? '—');

const runningValues = computed(() =>
    flattenSettings(view.value?.settings ?? {}).map((leaf) => ({
        path: leaf.path,
        value: showSettingValue(leaf.value, msg.value.changes.absent),
    })),
);

const valueColumns = computed(() => [
    { name: 'path', label: msg.value.changes.leaf, field: 'path', align: 'left' as const },
    { name: 'value', label: msg.value.values.title, field: 'value', align: 'left' as const },
]);

const differenceColumns = computed(() => [
    { name: 'path', label: msg.value.changes.leaf, field: 'path', align: 'left' as const },
    {
        name: 'before',
        label: msg.value.changes.before,
        field: (row: { before?: unknown }) =>
            showSettingValue(row.before, msg.value.changes.absent),
        align: 'left' as const,
    },
    {
        name: 'after',
        label: msg.value.changes.after,
        field: (row: { after?: unknown }) => showSettingValue(row.after, msg.value.changes.absent),
        align: 'left' as const,
    },
]);

function seenBy(change: SettingsChangeView): string {
    return formatMessage(msg.value.changes.acknowledgedBy, {
        who: change.acknowledgedBy ?? '—',
        when: formatDateTime(change.acknowledgedAt) ?? '—',
    });
}

function formatDateTime(iso: string | null | undefined): string | null {
    if (!iso) return null;
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
.sa-settings__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--sa-space-3);
}
/* A grid item does not shrink below its content unless told to, and a
   fingerprint is one 71-character word. */
.sa-settings__facts > * {
    min-width: 0;
    overflow-wrap: anywhere;
}
.sa-settings__hint {
    margin: var(--sa-space-3) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
.sa-settings__change {
    display: grid;
    gap: var(--sa-space-2);
}
/* Same rule for the table inside: it scrolls within its own frame only if the
   grid lets it be narrower than its rows. */
.sa-settings__change > * {
    min-width: 0;
}
.sa-settings__change + .sa-settings__change {
    margin-top: var(--sa-space-4);
}
.sa-settings__change-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-settings__noticed,
.sa-settings__seen {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
</style>
