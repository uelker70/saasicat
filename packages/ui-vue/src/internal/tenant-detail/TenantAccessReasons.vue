<template>
    <p v-if="reasons.length === 0" class="sa-tenant-access__open">{{ labels.open }}</p>
    <ul v-else class="sa-tenant-access__reasons">
        <li
            v-for="reason in reasons"
            :key="`${reason.kind}-${reason.since}`"
            class="sa-tenant-access__reason"
        >
            <span class="sa-tenant-access__what">
                {{ whatOf(reason) }}
                <router-link
                    v-if="reason.kind === 'overdue' && reason.invoice"
                    class="sa-tenant-access__invoice"
                    :to="recordRoute(reason.invoice.subscriberId)"
                >
                    {{ reason.invoice.number }}
                </router-link>
            </span>
            <span class="sa-tenant-access__since">{{ sinceOf(reason) }}</span>
            <span v-if="reason.note" class="sa-tenant-access__note">{{ noteOf(reason.note) }}</span>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { AdminTenantAccessReason } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatMessage } from '../../client/i18n/format.js';
import type { TenantAccessLabels } from './types.js';

// Every reason a tenant is held back for, the oldest first, as the operator
// reads it on the detail page (`SC-ADM-053`): what it is, since when, the
// operator's note on a suspension, and an invoice unpaid on its due date by
// its number, linked to the record that lists it. Pure presentation: the page
// resolves the labels and writes the days.

const props = defineProps<{
    reasons: readonly AdminTenantAccessReason[];
    labels: TenantAccessLabels;
    /** A moment, as the installation's day the page writes. */
    dayOf: (iso: string) => string;
    /** Where a subscriber's record answers. */
    recordRoute: (subscriberId: string) => RouteLocationRaw;
}>();

function whatOf(reason: AdminTenantAccessReason): string {
    if (reason.kind === 'suspended') return props.labels.suspended;
    if (reason.kind === 'ended') return props.labels.ended;
    if (reason.kind === 'deleting') return props.labels.deleting;
    return reason.invoice ? props.labels.overdue : props.labels.overdueUnnamed;
}

function sinceOf(reason: AdminTenantAccessReason): string {
    return formatMessage(props.labels.since, { day: props.dayOf(reason.since) });
}

function noteOf(note: string): string {
    return formatMessage(props.labels.note, { note });
}
</script>

<style scoped>
.sa-tenant-access__open {
    margin: 0;
    color: var(--sa-color-fg-muted);
}
.sa-tenant-access__reasons {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--sa-space-3);
}
.sa-tenant-access__reason {
    display: grid;
    gap: var(--sa-space-1);
}
.sa-tenant-access__what {
    font-weight: var(--sa-weight-semibold);
    color: var(--sa-color-fg-heading);
}
.sa-tenant-access__since,
.sa-tenant-access__note {
    color: var(--sa-color-fg-muted);
}
</style>
