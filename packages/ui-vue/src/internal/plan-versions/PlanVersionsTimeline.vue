<template>
    <aside class="sa-pv-timeline">
        <div class="sa-pv-timeline__head">
            <div class="sa-pv-timeline__row">
                <div class="sa-pv-timeline__title">{{ title ?? msg.timeline.title }}</div>
            </div>
            <div class="sa-pv-timeline__count">{{ snapshotCountLabel }}</div>
        </div>

        <div class="sa-pv-timeline__list">
            <div v-for="(s, i) in snapshots" :key="s.id" class="sa-pv-timeline__item">
                <span
                    v-if="i < snapshots.length - 1"
                    class="sa-pv-timeline__line"
                    aria-hidden="true"
                />
                <!-- @optionSurface
                     A node on a timeline. The button IS the node: its position and its dot
                     carry the version, and a button chrome would cover the line. -->
                <button
                    type="button"
                    class="sa-pv-timeline__btn"
                    :class="{ 'sa-pv-timeline__btn--selected': selectedId === s.id }"
                    @click="emit('select', s.id)"
                    @contextmenu.prevent="emit('setCompare', s.id)"
                >
                    <span
                        class="sa-pv-timeline__node"
                        :class="`sa-pv-timeline__node--${s.status.toLowerCase()}`"
                    >
                        <q-icon v-if="s.kind === 'active'" name="check" size="13px" />
                        <q-icon v-else-if="s.kind === 'drafts'" name="edit_note" size="12px" />
                        <span v-else class="sa-pv-timeline__node-dot" />
                    </span>
                    <span class="sa-pv-timeline__main">
                        <span class="sa-pv-timeline__top">
                            <span class="sa-pv-timeline__label">{{ s.label }}</span>
                            <span
                                class="sa-pv-timeline__status"
                                :class="`sa-pv-timeline__status--${s.status.toLowerCase()}`"
                            >
                                {{ statusLabel(s.status) }}
                            </span>
                            <span v-if="compareId === s.id" class="sa-pv-timeline__vs">VS</span>
                        </span>
                        <span class="sa-pv-timeline__h2">{{ s.title }}</span>
                        <span class="sa-pv-timeline__meta">
                            <q-icon
                                :name="s.kind === 'drafts' ? 'edit_note' : 'schedule'"
                                size="11px"
                            />
                            <span>{{ metaText(s) }}</span>
                        </span>
                    </span>
                </button>
            </div>
        </div>

        <div class="sa-pv-timeline__foot">
            <div class="sa-pv-timeline__hint">
                <q-icon name="info" size="13px" />
                <span>{{ msg.timeline.compareHint }}</span>
            </div>
            <q-btn
                v-if="compareId"
                class="sa-pv-timeline__clear-btn"
                flat
                dense
                no-caps
                :label="msg.compareEnd"
                @click="emit('clearCompare')"
            />
        </div>
    </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { CatalogSnapshot } from './catalog-history.types.js';
import { formatRelative } from './format.js';

const props = defineProps<{
    snapshots: CatalogSnapshot[];
    selectedId: string;
    compareId: string | null;
    title?: string;
}>();

const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'setCompare', id: string): void;
    (e: 'clearCompare'): void;
}>();

const msg = useSaMessages('planVersions');

const snapshotCountLabel = computed(() =>
    formatMessage(msg.value.timeline.snapshotCount, { count: props.snapshots.length }),
);

function statusLabel(status: CatalogSnapshot['status']): string {
    if (status === 'DRAFT') return msg.value.status.draft;
    if (status === 'ACTIVE') return msg.value.status.active;
    return msg.value.status.archived;
}

function metaText(s: CatalogSnapshot): string {
    if (s.kind === 'drafts') {
        return s.draftCount === 0
            ? msg.value.timeline.noOpenDrafts
            : formatMessage(msg.value.timeline.openCount, { count: s.draftCount });
    }
    if (s.publishedAt) return formatRelative(s.publishedAt, msg.value);
    return msg.value.timeline.unknown;
}
</script>

<style scoped>
.sa-pv-timeline {
    width: 280px;
    flex-shrink: 0;
    background: var(--sa-color-bg-surface);
    border-right: 1px solid var(--sa-color-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.sa-pv-timeline__head {
    padding: var(--sa-space-4) var(--sa-space-5);
    border-bottom: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface-raised);
}
.sa-pv-timeline__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.sa-pv-timeline__title {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-muted);
    text-transform: uppercase;
}
.sa-pv-timeline__count {
    margin-top: var(--sa-space-1);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}

.sa-pv-timeline__list {
    flex: 1;
    overflow-y: auto;
    padding: var(--sa-space-3) var(--sa-space-2);
}
.sa-pv-timeline__item {
    position: relative;
}
.sa-pv-timeline__line {
    position: absolute;
    left: var(--sa-space-6);
    top: var(--sa-space-8);
    bottom: calc(-1 * var(--sa-space-2));
    width: 2px;
    background: var(--sa-color-border);
    z-index: 0;
}
.sa-pv-timeline__btn {
    position: relative;
    z-index: 1;
    width: calc(100% - 8px);
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    margin: var(--sa-space-1) var(--sa-space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--sa-radius-tile);
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
    font-family: inherit;
    color: inherit;
}
.sa-pv-timeline__btn:hover:not(.sa-pv-timeline__btn--selected) {
    background: var(--sa-color-border-soft);
}
.sa-pv-timeline__btn--selected {
    background: var(--sa-color-accent-surface);
    border-color: var(--sa-color-accent-border);
}

.sa-pv-timeline__node {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 2px solid;
}
.sa-pv-timeline__node--draft {
    background: var(--sa-color-warning-surface-strong);
    border-color: var(--sa-color-warning-fg);
    color: var(--sa-color-warning-fg);
}
.sa-pv-timeline__node--active {
    background: var(--sa-color-positive-surface);
    border-color: var(--sa-color-positive);
    color: var(--sa-color-positive-fg);
}
.sa-pv-timeline__node--archived {
    background: var(--sa-color-border-soft);
    border-color: var(--sa-color-fg-muted);
    color: var(--sa-color-fg-muted);
}
.sa-pv-timeline__node-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

.sa-pv-timeline__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.sa-pv-timeline__top {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    margin-bottom: var(--sa-space-1);
}
.sa-pv-timeline__label {
    font-family: var(--sa-font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
    font-size: var(--sa-text-sm);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sa-pv-timeline__status {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-wider);
    padding: var(--sa-space-1) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.sa-pv-timeline__status--draft {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-pv-timeline__status--active {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
}
.sa-pv-timeline__status--archived {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-muted);
}
.sa-pv-timeline__vs {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-wider);
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
    padding: var(--sa-space-1) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.sa-pv-timeline__h2 {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-body);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.sa-pv-timeline__meta {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}

.sa-pv-timeline__foot {
    padding: var(--sa-space-3) var(--sa-space-4);
    border-top: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface-raised);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}
.sa-pv-timeline__hint {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.sa-pv-timeline__clear-btn {
    margin-top: var(--sa-space-2);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-2) var(--sa-space-3);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    color: var(--sa-color-fg-body);
    cursor: pointer;
}
</style>
