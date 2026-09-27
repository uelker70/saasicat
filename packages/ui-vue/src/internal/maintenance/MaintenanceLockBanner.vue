<template>
    <AdminBanner v-if="locked" :tone="locked.overrun ? 'negative' : 'warning'" icon="lock" dense>
        {{ text }}
        <router-link :to="to" class="sa-maintenance-lock__link">{{ msg.banner.open }}</router-link>
    </AdminBanner>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';

import { formatMessage } from '../../client/i18n/format.js';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import { SUPER_ADMIN_RESOURCES_KEY } from '../../vue/resource-registry.js';
import { useMaintenanceLockWatch } from '../../vue/use-maintenance-lock-watch.js';
import type { MaintenanceResource } from '../../vue/use-maintenance.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// The strip every page of the administration shows while tenants are locked
// out (`SC-ADM-030`), louder once the announced end has passed. A lock ends
// only when somebody unlocks, and this is how the operator who forgot is told
// wherever they are.
//
// A shell assembled without a resource registry renders nothing here rather
// than failing: the layout must not go down for a strip it can do without.

const props = defineProps<{
    /** Whether the installation keeps maintenance windows at all. */
    enabled: boolean;
    /** Where the maintenance page is mounted. */
    to: string;
}>();

const msg = useSaMessages('maintenance');
const { intlLocale } = useSuperAdminI18n();
const registry = inject(SUPER_ADMIN_RESOURCES_KEY, null);
// Asked for only where the installation keeps windows, so a registry that
// knows no `maintenance` is never asked for one.
const resource = computed(() =>
    props.enabled && registry ? (registry.get('maintenance') as MaintenanceResource) : null,
);
const { locked } = useMaintenanceLockWatch(resource);

const text = computed(() => {
    const window = locked.value;
    if (!window) return '';
    const since = at(window.lockedAt);
    if (window.overrun)
        return formatMessage(msg.value.banner.overrun, { since, end: at(window.endsAt) });
    return window.endsAt
        ? formatMessage(msg.value.banner.lockedUntil, { since, end: at(window.endsAt) })
        : formatMessage(msg.value.banner.locked, { since });
});

function at(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(intlLocale.value, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}
</script>

<style scoped>
.sa-maintenance-lock__link {
    margin-left: var(--sa-space-2);
    color: inherit;
    font-weight: 600;
}
</style>
