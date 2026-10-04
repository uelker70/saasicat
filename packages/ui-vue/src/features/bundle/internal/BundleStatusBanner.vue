<template>
    <div :class="['bv-status-banner', `bv-status-${status}`]">
        <span class="bv-status-icon" aria-hidden="true">
            <q-icon v-if="status === 'on-sale'" name="bolt" size="16px" />
            <q-icon v-else-if="status === 'scheduled'" name="schedule" size="16px" />
            <q-icon v-else-if="status === 'off-sale'" name="delete" size="16px" />
            <q-icon v-else name="edit" size="16px" />
        </span>
        <div class="bv-status-text">
            <b>v{{ version.version }}</b> · <b>{{ saleText(version) }}</b> —
            <template v-if="status === 'on-sale'">
                {{ msg.statusBanner.onSaleTail }}
                <span class="bv-status-warn">{{ msg.statusBanner.onSaleWarning }}</span>
            </template>
            <span v-else-if="status === 'scheduled'" class="bv-status-ok">{{
                msg.statusBanner.scheduledOk
            }}</span>
            <template v-else-if="status === 'off-sale'">
                {{ msg.statusBanner.offSaleTail }}
            </template>
            <template v-else>{{ msg.statusBanner.draftTail }}</template>
            <div v-if="retirement" class="bv-status-retirement">
                <span class="bv-status-retired" :title="retiredTitle(retirement)">{{
                    formatMessage(msg.statusBanner.retiredChip, {
                        version: retirement.replacement.version,
                    })
                }}</span>
                <RetirementProgressPills :progress="retirement.progress" />
            </div>
            <div v-if="retirementsUnreadable" class="bv-status-warn">
                {{ retirementsUnreadable }}
            </div>
        </div>
        <q-btn
            v-if="status === 'scheduled' || status === 'draft'"
            class="bv-status-discard"
            flat
            dense
            no-caps
            :label="common.discard"
            :title="msg.statusBanner.discardTooltip"
            @click="$emit('discard')"
        />
        <q-btn
            v-if="flow?.canRetire(version)"
            class="bv-status-retire"
            flat
            dense
            no-caps
            :label="msg.statusBanner.retireAction"
            :title="msg.statusBanner.retireTitle"
            @click="flow.open(version)"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BundleVersionRetirementView, BundleVersionRow } from '@saasicat/core';

import { bundleVersionStatus } from './bundle-version-status';
import { formatDay, formatMessage } from '../../../client/i18n/format.js';
import { describeVersionSale, versionSale } from '../../../client/version-sale.js';
import { injectBundleVersionRetirement } from '../../../vue/use-bundle-version-retirement.js';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';
import RetirementProgressPills from '../../retirement/RetirementProgressPills.vue';

// BundleStatusBanner — inline hint per bundle version: where it stands, with
// its day, and what that means for editing (on sale = read-only, scheduled =
// editable until it starts). Where the page offers retiring add-on versions,
// a version off sale can be retired from here, and one that was says onto
// which version and how far that has come.

const props = defineProps<{
    version: BundleVersionRow;
    /** Optional: reference point in time for the status check (tests). */
    now?: Date;
}>();

defineEmits<{
    (e: 'discard'): void;
}>();

const msg = useSaMessages('bundles');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const status = computed(() => bundleVersionStatus(props.version, props.now));

const flow = injectBundleVersionRetirement();
const retirement = computed(() => flow?.retirementOf(props.version) ?? null);
const retirementsUnreadable = computed(() => {
    const error = flow?.recordsError.value;
    return error ? formatMessage(msg.value.statusBanner.retirementsUnreadable, { error }) : '';
});

function retiredTitle(record: BundleVersionRetirementView): string {
    return formatMessage(msg.value.statusBanner.retiredTitle, {
        date: formatDay(String(record.announcedAt), intlLocale.value),
        by: record.announcedBy,
    });
}

function saleText(version: BundleVersionRow): string {
    return describeVersionSale(
        versionSale(version, props.now ?? new Date()),
        common.value.versionSale,
        intlLocale.value,
    );
}
</script>

<style scoped>
.bv-status-banner {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
    padding: var(--sa-space-4) var(--sa-space-4);
    border-radius: var(--sa-radius-field);
    border: 1px solid transparent;
    font-size: var(--sa-text-md);
    line-height: 1.4;
}
.bv-status-on-sale {
    background: var(--sa-color-positive-surface);
    border-color: var(--sa-color-positive-border);
    color: var(--sa-color-positive-fg);
}
.bv-status-scheduled {
    background: var(--sa-color-warning-surface);
    border-color: var(--sa-color-warning-border);
    color: var(--sa-color-warning-fg);
}
.bv-status-off-sale {
    background: var(--sa-color-border-soft);
    border-color: var(--sa-color-border-strong);
    color: var(--sa-color-fg-secondary);
}
.bv-status-draft {
    background: var(--sa-color-accent-surface-strong);
    border-color: var(--sa-color-info-border);
    color: var(--sa-color-info-fg);
}
.bv-status-icon {
    flex: 0 0 auto;
    display: inline-flex;
}
.bv-status-text {
    flex: 1;
    min-width: 0;
}
.bv-status-warn {
    color: var(--sa-color-warning-fg);
    font-weight: 500;
}
.bv-status-ok {
    color: var(--sa-color-positive-fg);
    font-weight: 500;
}
.bv-status-discard {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-2) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    cursor: pointer;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-negative-fg);
    font-family: inherit;
}
.bv-status-discard:hover {
    background: var(--sa-color-negative-surface);
    border-color: var(--sa-color-negative-border);
}
.bv-status-retirement {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-2);
}
.bv-status-retired {
    font-weight: 600;
}
.bv-status-retire {
    flex: 0 0 auto;
}
</style>
