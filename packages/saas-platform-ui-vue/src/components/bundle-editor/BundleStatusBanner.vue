<template>
    <div :class="['bv-status-banner', `bv-status-${status}`]">
        <span class="bv-status-icon" aria-hidden="true">
            <svg
                v-if="status === 'live'"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <svg
                v-else-if="status === 'scheduled'"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </svg>
            <svg
                v-else-if="status === 'superseded'"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14"
                />
            </svg>
            <svg
                v-else
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path d="M12 20h9M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
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
        <button
            v-if="status === 'scheduled' || status === 'draft'"
            class="bv-status-discard"
            type="button"
            :title="msg.statusBanner.discardTooltip"
            @click="$emit('discard')"
        >
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                />
            </svg>
            <span>{{ msg.statusBanner.discard }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BundleVersionRow } from '@saasicat/types';

import { bundleVersionStatus, formatDate } from './bundle-version-status';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

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
    gap: 12px;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-size: 13px;
    line-height: 1.4;
}
.bv-status-live {
    background: #ecfdf5;
    border-color: #a7f3d0;
    color: #065f46;
}
.bv-status-scheduled {
    background: #fffbeb;
    border-color: #fde68a;
    color: #92400e;
}
.bv-status-superseded {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #475569;
}
.bv-status-draft {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1e40af;
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
    color: #b45309;
    font-weight: 500;
}
.bv-status-ok {
    color: #047857;
    font-weight: 500;
}
.bv-status-discard {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    color: #b91c1c;
    font-family: inherit;
}
.bv-status-discard:hover {
    background: #fef2f2;
    border-color: #fecaca;
}
</style>
