<template>
    <div class="sa-deletion-record">
        <p v-for="line in wording.export" :key="line" class="sa-deletion-record__note">
            {{ line }}
        </p>

        <div class="sa-deletion-record__part sa-deletion-record__keep">
            <h4 class="sa-deletion-record__heading">{{ m.keep }}</h4>
            <dl v-if="keep.length > 0" class="sa-deletion-record__counts">
                <template v-for="line in keep" :key="line.category">
                    <dt>{{ line.label }}</dt>
                    <dd>{{ line.count }}</dd>
                </template>
            </dl>
            <p v-else class="sa-deletion-record__note">{{ m.keepNone }}</p>
        </div>

        <div class="sa-deletion-record__part">
            <h4 class="sa-deletion-record__heading">{{ m.stores }}</h4>
            <ul class="sa-deletion-record__stores">
                <li
                    v-for="store in wording.stores"
                    :key="store.store"
                    class="sa-deletion-record__store"
                >
                    <code>{{ store.store }}</code>
                    <span class="sa-deletion-record__note">{{ store.counted }}</span>
                    <span class="sa-deletion-record__note">{{ store.erased }}</span>
                    <dl v-if="store.counts.length > 0" class="sa-deletion-record__counts">
                        <template v-for="counted in store.counts" :key="counted.category">
                            <dt>{{ counted.category }}</dt>
                            <dd>{{ writers.count(counted.count) }}</dd>
                        </template>
                    </dl>
                </li>
            </ul>
        </div>

        <div class="sa-deletion-record__part">
            <h4 class="sa-deletion-record__heading">{{ m.commercial }}</h4>
            <AdminTable :rows="commercial" :columns="commercialColumns" row-key="part">
                <template #body-cell-after="cell">
                    <q-td :props="cell">
                        {{ cell.value }}
                        <AdminStatusPill
                            v-if="cell.row.lost"
                            :label="m.lost"
                            tone="negative"
                            size="sm"
                        />
                    </q-td>
                </template>
            </AdminTable>
        </div>

        <div class="sa-deletion-record__part">
            <h4 class="sa-deletion-record__heading">{{ m.reminders }}</h4>
            <AdminTable
                :rows="reminders"
                :columns="reminderColumns"
                row-key="key"
                :empty-text="m.remindersNone"
            />
        </div>

        <div class="sa-deletion-record__part">
            <h4 class="sa-deletion-record__heading">{{ m.downloads }}</h4>
            <AdminTable
                :rows="downloads"
                :columns="downloadColumns"
                row-key="key"
                :empty-text="m.downloadsNone"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminTenantDeletionRecord } from '@saasicat/core';

import { keepLineLabel } from '../../client/keep-line-label.js';
import { tenantDeletionRecordWording } from '../../client/tenant-deletion-lines.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import AdminTable from '../../ui/data/AdminTable.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import { useTenantDeletionWriters } from '../../vue/use-tenant-deletion-writers.js';

// What the subscriber's record keeps of a begun deletion (`SC-PRIV-023`,
// `SC-PRIV-024`): since when the export was offered, whether a suspension kept
// it, whether the day was told, what the tenant was told to keep in the
// operator's language, what each store counted under the application's own
// category keys and when it confirmed, the commercial record before and after
// with every part that fell marked, the reminders and the downloads — roles
// and numbers, never a person. Pure presentation: the words come from
// `client/tenant-deletion-lines`.
const props = defineProps<{ record: AdminTenantDeletionRecord }>();

const subscribersMsg = useSaMessages('subscribers');
const tenantsMsg = useSaMessages('tenants');
const { locale } = useSuperAdminI18n();
const writers = useTenantDeletionWriters();

const m = computed(() => subscribersMsg.value.record.deletions);

const wording = computed(() =>
    tenantDeletionRecordWording(
        props.record,
        { deletion: tenantsMsg.value.detail.deletion, record: m.value },
        writers.value,
    ),
);

const keep = computed(() =>
    props.record.keep.map((line) => ({
        category: line.category,
        label: keepLineLabel(line.labels, locale.value),
        count: writers.value.count(line.count),
    })),
);

/** A count not taken yet. */
const NONE = '—';

const commercial = computed(() =>
    wording.value.commercial.map((row) => ({
        part: row.part,
        before: row.before === null ? NONE : writers.value.count(row.before),
        after: row.after === null ? NONE : writers.value.count(row.after),
        lost: row.lost,
    })),
);

const reminders = computed(() =>
    wording.value.reminders.map((row) => ({
        key: `${row.daysBefore}:${row.recorded}`,
        daysBefore: row.daysBefore,
        recorded: row.recorded,
        delivered: row.delivered,
        channel: row.channel ?? NONE,
        recipients: row.recipients ?? NONE,
    })),
);

const downloads = computed(() =>
    wording.value.downloads.map((row, index) => ({ key: `${index}:${row.at}`, ...row })),
);

const commercialColumns = computed<QTableColumn[]>(() => [
    { name: 'part', label: m.value.columnPart, field: 'part', align: 'left' },
    { name: 'before', label: m.value.columnBefore, field: 'before', align: 'right' },
    { name: 'after', label: m.value.columnAfter, field: 'after', align: 'right' },
]);

const reminderColumns = computed<QTableColumn[]>(() => [
    { name: 'daysBefore', label: m.value.columnDaysBefore, field: 'daysBefore', align: 'right' },
    { name: 'recorded', label: m.value.columnRecorded, field: 'recorded', align: 'left' },
    { name: 'delivered', label: m.value.columnDelivered, field: 'delivered', align: 'left' },
    { name: 'channel', label: m.value.columnChannel, field: 'channel', align: 'left' },
    { name: 'recipients', label: m.value.columnRecipients, field: 'recipients', align: 'right' },
]);

const downloadColumns = computed<QTableColumn[]>(() => [
    { name: 'at', label: m.value.columnAt, field: 'at', align: 'left' },
    { name: 'size', label: m.value.columnSize, field: 'size', align: 'right' },
    { name: 'by', label: m.value.columnBy, field: 'by', align: 'left' },
]);
</script>

<style scoped>
.sa-deletion-record {
    display: grid;
    gap: var(--sa-space-3);
}
.sa-deletion-record__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
.sa-deletion-record__heading {
    font-size: var(--sa-text-sm);
    font-weight: var(--sa-weight-semibold);
    margin: 0 0 var(--sa-space-2);
}
.sa-deletion-record__counts {
    display: grid;
    grid-template-columns: max-content max-content;
    gap: var(--sa-space-1) var(--sa-space-3);
    margin: 0;
}
.sa-deletion-record__counts dd {
    margin: 0;
    text-align: end;
}
.sa-deletion-record__stores {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sa-space-2);
}
.sa-deletion-record__store {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--sa-space-1) var(--sa-space-3);
}
.sa-deletion-record__store .sa-deletion-record__counts {
    flex-basis: 100%;
}
</style>
