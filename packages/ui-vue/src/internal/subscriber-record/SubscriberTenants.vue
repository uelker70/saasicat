<template>
    <AdminSection
        :title="msg.record.tenants.title"
        :subtitle="msg.record.tenants.subtitle"
        class="q-mb-md"
    >
        <template v-if="canJoin" #actions>
            <q-btn flat no-caps icon="merge_type" :label="msg.join.action" @click="emit('join')" />
        </template>
        <p v-if="tenants.length === 0" class="sa-subscriber-tenants__note">
            {{ msg.record.tenants.none }}
        </p>
        <ul v-else class="sa-subscriber-tenants">
            <li v-for="tenant in shown" :key="tenant.key" class="sa-subscriber-tenants__entry">
                <div class="sa-subscriber-tenants__name">
                    <router-link
                        v-if="tenant.to"
                        :to="tenant.to"
                        :aria-label="tenant.openLabel"
                        class="sa-link"
                    >
                        {{ tenant.name }}
                    </router-link>
                    <span v-else>{{ tenant.name }}</span>
                    <AdminStatusPill v-if="tenant.live" :label="common.active" tone="positive" />
                </div>
                <div class="sa-subscriber-tenants__when">{{ tenant.when }}</div>
                <AdminBanner v-if="tenant.warning" tone="warning" :title="tenant.warning" />
                <div v-else-if="tenant.deleted" class="sa-subscriber-tenants__when">
                    {{ tenant.deleted }}
                </div>
            </li>
        </ul>
        <section
            v-if="joinedFrom.length > 0"
            class="sa-subscriber-tenants__joined"
            :aria-label="msg.join.joinedFromTitle"
        >
            <h3 class="sa-subscriber-tenants__heading">{{ msg.join.joinedFromTitle }}</h3>
            <ul class="sa-subscriber-tenants">
                <li v-for="note in joinedFrom" :key="note.subscriberId">
                    <router-link
                        v-if="subscriberRoute"
                        :to="subscriberRoute(note.subscriberId)"
                        class="sa-link"
                    >
                        {{ note.text }}
                    </router-link>
                    <span v-else>{{ note.text }}</span>
                </li>
            </ul>
        </section>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminSubscriberJoinNote, AdminSubscriberTenant } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatDay, formatMessage } from '../../client/i18n/format.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// Every tenant the subscriber is and was linked to, the live one first. A
// tenant the application still knows leads to its page; one it no longer
// knows is named by its id, and where its link was never closed the record
// says so rather than reading the link as ended (`SC-ADM-036`).
const props = defineProps<{
    tenants: readonly AdminSubscriberTenant[];
    /** Where a tenant's page answers. */
    tenantRoute: (slug: string) => RouteLocationRaw;
    /** The subscribers joined into this one (`SC-ADM-027`), the latest first. */
    joins?: readonly AdminSubscriberJoinNote[];
    /** Whether this subscriber's live tenant can be joined into an earlier subscriber. */
    canJoin?: boolean;
    /** Where another subscriber's record answers. */
    subscriberRoute?: (subscriberId: string) => RouteLocationRaw;
}>();

const emit = defineEmits<{ (e: 'join'): void }>();

const msg = useSaMessages('subscribers');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();
const days = useInstallationDays();

const shown = computed(() => {
    const m = msg.value.record.tenants;
    const day = (iso: string): string => formatDay(days.ofMoment(iso), intlLocale.value);
    return props.tenants.map((tenant) => {
        const name = tenant.name ?? tenant.slug ?? tenant.tenantId;
        const live = tenant.unlinkedAt === null;
        return {
            key: `${tenant.tenantId}:${tenant.linkedAt}`,
            name,
            live,
            to: tenant.known && tenant.slug ? props.tenantRoute(tenant.slug) : null,
            openLabel: formatMessage(m.open, { name }),
            when: live
                ? formatMessage(m.live, { date: day(tenant.linkedAt) })
                : formatMessage(m.closed, {
                      from: day(tenant.linkedAt),
                      until: day(tenant.unlinkedAt ?? tenant.linkedAt),
                  }),
            warning:
                live && !tenant.known
                    ? formatMessage(m.unknown, { tenantId: tenant.tenantId })
                    : null,
            deleted: tenant.deletedAt
                ? formatMessage(m.deleted, { date: day(tenant.deletedAt) })
                : null,
        };
    });
});

const joinedFrom = computed(() =>
    (props.joins ?? []).map((note) => ({
        subscriberId: note.subscriberId,
        text: formatMessage(msg.value.join.joinedFrom, {
            ...note,
            date: formatDay(days.ofMoment(note.joinedAt), intlLocale.value),
            by: note.joinedBy,
        }),
    })),
);
</script>

<style scoped>
.sa-subscriber-tenants {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sa-space-3);
}
.sa-subscriber-tenants__name {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-weight: var(--sa-weight-medium);
}
.sa-subscriber-tenants__joined {
    display: grid;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-3);
}
.sa-subscriber-tenants__heading {
    margin: 0;
    font-size: var(--sa-text-sm);
    font-weight: var(--sa-weight-medium);
}
.sa-subscriber-tenants__when,
.sa-subscriber-tenants__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
</style>
