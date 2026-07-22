<template>
    <section class="pc-card">
        <div class="pc-card-head">
            <div class="pc-card-head-text">
                <div class="pc-card-title">{{ panelTitle }}</div>
                <div class="pc-card-sub">
                    {{ diffPair ? msg.diff.subOnPublish : msg.diff.noComparison }}
                </div>
            </div>
            <div v-if="diffPair" class="pc-pillrow">
                <span class="pc-pill" style="background: #ecfdf5; color: #047857">
                    +{{ diff.addedFeatures.length }} F
                </span>
                <span class="pc-pill" style="background: #fef2f2; color: #b91c1c">
                    −{{ diff.removedFeatures.length }} F
                </span>
                <span class="pc-pill" style="background: #fffbeb; color: #b45309">
                    {{
                        diff.changedQuotas.length +
                        diff.addedQuotas.length +
                        diff.removedQuotas.length
                    }}
                    Q
                </span>
            </div>
        </div>
        <div class="pc-diff-body">
            <div
                v-for="d in diffRows"
                :key="d.id"
                class="pc-diff-row"
                :style="{ background: d.bg, borderColor: d.border }"
            >
                <span class="pc-diff-sign" :style="{ background: d.color }">{{ d.sign }}</span>
                <div class="pc-diff-main">
                    <div class="pc-diff-headline">
                        <span class="pc-diff-section" :style="{ color: d.color }">{{
                            d.section
                        }}</span>
                        <span class="pc-diff-label">{{ d.label }}</span>
                        <code v-if="d.sub" class="pc-mono pc-mono--xs">{{ d.sub }}</code>
                    </div>
                    <div v-if="d.from !== undefined" class="pc-diff-change">
                        <span class="pc-diff-from">{{ d.from }}</span>
                        <span class="pc-diff-arrow" :style="{ color: d.color }">
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path d="M5 12h14M13 5l7 7-7 7" />
                            </svg>
                        </span>
                        <span class="pc-diff-to">{{ d.to }}</span>
                    </div>
                </div>
                <span
                    class="pc-chip pc-diff-tag"
                    :style="{
                        background: '#fff',
                        color: d.color,
                        borderColor: d.border,
                    }"
                >
                    {{ d.tag }}
                </span>
            </div>
            <div v-if="diffRows.length === 0" class="pc-empty pc-empty--inline">
                {{ msg.diff.noChangesDetected }}
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { DiffRow, DiffSummary, PlanVersionPair } from './types';

const props = defineProps<{
    diffPair: PlanVersionPair | null;
    diff: DiffSummary;
    diffRows: DiffRow[];
}>();

const msg = useSaMessages('planDetail');

const panelTitle = computed(() => {
    const pair = props.diffPair;
    if (!pair) return msg.value.diff.title;
    return formatMessage(msg.value.diff.titleCompare, {
        from: pair.from.version,
        to: pair.to.version,
    });
});
</script>
