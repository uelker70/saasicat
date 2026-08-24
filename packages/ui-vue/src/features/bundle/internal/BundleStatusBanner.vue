<template>
    <div :class="['bv-status-banner', `bv-status-${status}`]">
        <span class="bv-status-icon" aria-hidden="true">
            <q-icon v-if="status === 'live'" name="bolt" size="16px" />
            <q-icon v-else-if="status === 'scheduled'" name="schedule" size="16px" />
            <q-icon v-else-if="status === 'superseded'" name="delete" size="16px" />
            <q-icon v-else name="edit" size="16px" />
        </span>
        <div class="bv-status-text">
            <template v-if="status === 'live'">
                <b>v{{ version.version }}</b> {{ msg.statusBanner.is }}
                <b>{{ msg.statusBanner.live }}</b> {{ liveTail }}
                <span class="bv-status-warn">{{ msg.statusBanner.liveWarning }}</span>
            </template>
            <template v-else-if="status === 'scheduled'">
                <b>v{{ version.version }}</b> {{ msg.statusBanner.is }}
                <b>{{ msg.statusBanner.scheduled }}</b> {{ scheduledTail }}
                <span class="bv-status-ok">{{ msg.statusBanner.scheduledOk }}</span>
            </template>
            <template v-else-if="status === 'superseded'">
                <b>v{{ version.version }}</b> {{ msg.statusBanner.is }}
                <b>{{ msg.statusBanner.superseded }}</b> {{ supersededTail }}
            </template>
            <template v-else>
                <b>v{{ version.version }}</b> {{ msg.statusBanner.is }}
                <b>{{ msg.statusBanner.draft }}</b> {{ msg.statusBanner.draftTail }}
            </template>
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

import { bundleVersionStatus, formatDate } from './bundle-version-status';
import { formatMessage } from '../../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';

// BundleStatusBanner — inline hint per bundle version with plain-text info on
// editability (after plan simulation). Shows the status + the business
// consequence (live = read-only, scheduled = editable).

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
const { locale } = useSuperAdminI18n();

const status = computed(() => bundleVersionStatus(props.version, props.now));

const liveTail = computed(() =>
    formatMessage(msg.value.statusBanner.liveTail, {
        date: formatDate(props.version.validFrom, locale.value),
    }),
);
const scheduledTail = computed(() =>
    formatMessage(msg.value.statusBanner.scheduledTail, {
        date: formatDate(props.version.validFrom, locale.value),
    }),
);
const supersededTail = computed(() =>
    formatMessage(msg.value.statusBanner.supersededTail, {
        from: formatDate(props.version.validFrom, locale.value),
        until: formatDate(props.version.validUntil, locale.value),
    }),
);
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
.bv-status-live {
    background: var(--sa-color-positive-surface);
    border-color: var(--sa-color-positive-border);
    color: var(--sa-color-positive-fg);
}
.bv-status-scheduled {
    background: var(--sa-color-warning-surface);
    border-color: var(--sa-color-warning-border);
    color: var(--sa-color-warning-fg);
}
.bv-status-superseded {
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
