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
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BundleVersionRow } from '@saasicat/core';

import { bundleVersionStatus } from './bundle-version-status';
import { describeVersionSale, versionSale } from '../../../client/version-sale.js';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';

// BundleStatusBanner — inline hint per bundle version: where it stands, with
// its day, and what that means for editing (on sale = read-only, scheduled =
// editable until it starts).

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
</style>
