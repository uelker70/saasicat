<template>
    <AdminSection :title="msg.subscriber.history.title" class="q-mb-md">
        <AdminErrorBanner
            :error="history.error.value"
            :title="msg.subscriber.history.loadFailed"
            :retry="history.reload"
        />
        <AdminTable
            v-if="!history.error.value"
            :rows="rows"
            :columns="columns"
            row-key="key"
            :loading="history.pending.value"
            :empty-text="msg.subscriber.history.empty"
            storage-key="tenant-subscriber-history"
        />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminSubscriberHistoryEntry } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { AsyncData } from '../../vue/use-async-data.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// Every correction of the subscriber's identity, change of its country or
// business status, and check of its VAT number, the latest first — who, when,
// what it was before and after, and why. Read only.

const props = defineProps<{ history: AsyncData<AdminSubscriberHistoryEntry[]> }>();

const msg = useSaMessages('tenants');
const { intlLocale } = useSuperAdminI18n();

const EMPTY = '—';

function valueOf(field: string, value: unknown): string {
    const m = msg.value.subscriber;
    if (field === 'business') {
        if (value === null || value === undefined) return m.notStated;
        return value ? m.businessTrue : m.businessFalse;
    }
    return value === null || value === undefined ? m.history.cleared : String(value);
}

/** `Name: old → new; VAT ID: cleared → DE…` for the fields that moved. */
function changeOf(previous: Record<string, unknown>, next: Record<string, unknown>): string {
    const labels = msg.value.subscriber.changedField as Record<string, string>;
    return Object.keys(next)
        .map((field) => {
            const before = field in previous ? valueOf(field, previous[field]) : EMPTY;
            return `${labels[field] ?? field}: ${before} → ${valueOf(field, next[field])}`;
        })
        .join('; ');
}

function rowOf(entry: AdminSubscriberHistoryEntry, index: number) {
    const h = msg.value.subscriber.history;
    const at = new Date(entry.at).toLocaleString(intlLocale.value, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
    if (entry.kind === 'vat-id-checked') {
        const result = formatMessage(entry.valid ? h.checkValid : h.checkInvalid, {
            vatId: entry.vatId,
            service: entry.service,
        });
        return {
            key: `${index}`,
            at,
            what: h.vatIdChecked,
            change: entry.counts ? `${result} · ${h.counts}` : result,
            reason: EMPTY,
            by: EMPTY,
        };
    }
    const corrected = entry.kind === 'identity-corrected';
    return {
        key: `${index}`,
        at,
        what: corrected ? h.identityCorrected : h.taxOriginChanged,
        change: changeOf(entry.previous, corrected ? entry.corrected : entry.changed),
        reason: entry.reason ?? EMPTY,
        by: entry.by,
    };
}

const rows = computed(() => props.history.data.value.map(rowOf));

const columns = computed<QTableColumn[]>(() => {
    const h = msg.value.subscriber.history;
    return [
        { name: 'at', label: h.columnAt, field: 'at', align: 'left' },
        { name: 'what', label: h.columnWhat, field: 'what', align: 'left' },
        { name: 'change', label: h.columnChange, field: 'change', align: 'left' },
        { name: 'reason', label: h.columnReason, field: 'reason', align: 'left' },
        { name: 'by', label: h.columnBy, field: 'by', align: 'left' },
    ];
});
</script>
