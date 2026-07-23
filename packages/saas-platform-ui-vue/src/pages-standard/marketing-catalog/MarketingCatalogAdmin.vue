<template>
    <div class="mc-admin">
        <div class="mc-admin-head">
            <div style="flex: 1">
                <div class="mc-admin-title">{{ msg.tabs.admin }}</div>
                <div class="mc-admin-sub">{{ msg.admin.subtitle }}</div>
            </div>
        </div>

        <div class="mc-admin-grid">
            <div class="mc-admin-thead">
                <div>{{ msg.admin.colPlan }}</div>
                <div>{{ msg.admin.colVisible }}</div>
                <div>{{ msg.admin.colBadge }}</div>
                <div>{{ msg.admin.colPriority }}</div>
                <div>{{ msg.admin.colHighlight }}</div>
                <div></div>
            </div>

            <template v-for="row in adminRows" :key="row.plan.id">
                <div class="mc-admin-row" :class="{ 'mc-admin-row--disabled': !row.liveVersion }">
                    <div>
                        <div class="mc-plan-cell">
                            <div
                                class="mc-plan-mark"
                                :style="{
                                    background: row.accent + '15',
                                    color: row.accent,
                                    borderColor: row.accent + '33',
                                }"
                            >
                                {{ row.plan.planKey.slice(0, 3) }}
                            </div>
                            <div>
                                <div class="mc-plan-label">
                                    {{ row.m.displayLabel || row.plan.label }}
                                </div>
                                <div class="mc-plan-key">{{ row.plan.planKey }}</div>
                            </div>
                        </div>
                        <div
                            v-if="row.publishedVersions.length > 1"
                            class="mc-version-tabs"
                            role="tablist"
                            :aria-label="
                                formatMessage(msg.admin.versionTabsLabel, { plan: row.plan.label })
                            "
                        >
                            <button
                                v-for="v in row.publishedVersions"
                                :key="v.id"
                                type="button"
                                role="tab"
                                class="mc-version-tab"
                                :class="{ 'mc-version-tab--active': row.liveVersion?.id === v.id }"
                                :title="formatVersionTitle(v)"
                                @click="$emit('select-version', row.plan, v.id)"
                            >
                                {{ formatVersionTab(v) }}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label class="mc-toggle" :class="{ disabled: !row.liveVersion }">
                            <input
                                type="checkbox"
                                :checked="row.m.visible"
                                :disabled="!row.liveVersion || busy"
                                @change="$emit('patch', row, { visible: checked($event) })"
                            />
                            <span />
                        </label>
                    </div>
                    <div>
                        <input
                            class="mc-field"
                            style="max-width: 120px"
                            placeholder="—"
                            :value="row.m.badge"
                            :disabled="!row.liveVersion || busy"
                            @change="$emit('patch', row, { badge: textValue($event) })"
                        />
                    </div>
                    <div>
                        <input
                            type="number"
                            min="0"
                            max="9999"
                            class="mc-field"
                            style="max-width: 72px"
                            :value="row.m.priority"
                            :disabled="!row.liveVersion || busy"
                            @change="$emit('patch', row, { priority: numberValue($event) })"
                        />
                    </div>
                    <div>
                        <label class="mc-toggle" :class="{ disabled: !row.liveVersion }">
                            <input
                                type="checkbox"
                                :checked="row.m.highlight"
                                :disabled="!row.liveVersion || busy"
                                @change="$emit('patch', row, { highlight: checked($event) })"
                            />
                            <span />
                        </label>
                    </div>
                    <div class="mc-admin-row-end">
                        <span v-if="!row.liveVersion" class="mc-chip mc-chip--muted">
                            {{ msg.admin.noLiveVersion }}
                        </span>
                        <span v-else-if="!row.m.visible" class="mc-chip mc-chip--muted">
                            {{ msg.admin.hidden }}
                        </span>
                        <span v-else-if="row.m.highlight" class="mc-chip mc-chip--featured">
                            {{ msg.admin.featured }}
                        </span>
                        <span v-else class="mc-chip mc-chip--live">{{ msg.admin.live }}</span>
                        <button
                            v-if="row.liveVersion"
                            type="button"
                            class="mc-expand-btn"
                            :title="
                                expandedKey === row.plan.planKey
                                    ? common.close
                                    : msg.admin.expandTitle
                            "
                            @click="$emit('toggle-expand', row)"
                        >
                            <span
                                class="mc-chev"
                                :class="{ open: expandedKey === row.plan.planKey }"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.5"
                                >
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </span>
                        </button>
                    </div>
                </div>

                <div v-if="expandedKey === row.plan.planKey" class="mc-admin-expand">
                    <div class="mc-expand-grid">
                        <div class="mc-expand-col">
                            <div class="mc-expand-sec">
                                <div class="mc-field-head">
                                    <label class="mc-expand-label">
                                        {{ msg.admin.planNameLabel }}
                                    </label>
                                    <span
                                        v-if="activeLocale !== defaultLocale"
                                        class="mc-source-hint"
                                    >
                                        {{ defaultLocale.toUpperCase() }}:
                                        <em>
                                            {{
                                                formatMessage(msg.admin.planNameSourceValue, {
                                                    label: row.plan.label,
                                                })
                                            }}
                                        </em>
                                    </span>
                                </div>
                                <div v-if="activeLocale === defaultLocale" class="mc-locked-value">
                                    <span>{{ row.plan.label }}</span>
                                    <span class="mc-locked-hint">
                                        {{ msg.admin.planNameLocked }}
                                    </span>
                                </div>
                                <input
                                    v-else
                                    class="mc-field"
                                    :placeholder="row.plan.label"
                                    :value="row.m.displayLabel"
                                    :disabled="busy"
                                    @change="$emit('patch-display-label', row, textValue($event))"
                                />
                                <div
                                    v-if="activeLocale !== defaultLocale && !row.m.displayLabel"
                                    class="mc-expand-hint"
                                >
                                    {{
                                        formatMessage(msg.admin.planNameFallbackHint, {
                                            label: row.plan.label,
                                        })
                                    }}
                                </div>
                            </div>

                            <div class="mc-expand-sec">
                                <label class="mc-expand-label">{{ msg.admin.teaserLabel }}</label>
                                <textarea
                                    class="mc-field mc-field--area"
                                    rows="2"
                                    :placeholder="msg.admin.teaserPlaceholder"
                                    :value="row.m.description"
                                    :disabled="busy"
                                    @change="
                                        $emit('patch', row, { description: textValue($event) })
                                    "
                                />
                                <div class="mc-expand-hint">{{ msg.admin.teaserHint }}</div>
                            </div>

                            <div class="mc-expand-sec">
                                <label class="mc-expand-label">{{ msg.admin.trialLabel }}</label>
                                <div class="mc-trial-row">
                                    <label class="mc-toggle">
                                        <input
                                            type="checkbox"
                                            :checked="row.m.trialEnabled"
                                            :disabled="busy"
                                            @change="
                                                $emit('patch', row, {
                                                    trialEnabled: checked($event),
                                                })
                                            "
                                        />
                                        <span />
                                    </label>
                                    <span class="mc-trial-label">
                                        {{
                                            row.m.trialEnabled
                                                ? msg.admin.trialOn
                                                : msg.admin.trialOff
                                        }}
                                    </span>
                                    <span class="mc-trial-days">
                                        <input
                                            type="number"
                                            min="1"
                                            max="365"
                                            class="mc-field"
                                            style="max-width: 72px"
                                            :value="row.m.trialDays"
                                            :disabled="!row.m.trialEnabled || busy"
                                            @change="
                                                $emit('patch', row, {
                                                    trialDays: numberValue($event),
                                                })
                                            "
                                        />
                                        <span class="mc-trial-unit">
                                            {{ msg.admin.trialDaysUnit }}
                                        </span>
                                    </span>
                                </div>
                                <div class="mc-expand-hint">{{ trialCtaHint(row) }}</div>
                            </div>

                            <div class="mc-expand-sec">
                                <label class="mc-expand-label">
                                    {{ msg.admin.ctaOverrideLabel }}
                                </label>
                                <input
                                    class="mc-field"
                                    :placeholder="autoCtaText(row)"
                                    :value="row.m.ctaLabel ?? ''"
                                    :disabled="busy"
                                    @change="
                                        $emit('patch', row, {
                                            ctaLabel: ctaValue(textValue($event)),
                                        })
                                    "
                                />
                                <div class="mc-expand-hint">{{ msg.admin.ctaOverrideHint }}</div>
                            </div>
                        </div>

                        <div class="mc-expand-col">
                            <div class="mc-expand-sec">
                                <div class="mc-tf-head">
                                    <label class="mc-expand-label" style="margin: 0">
                                        {{ msg.topFeatures }}
                                    </label>
                                    <span class="mc-expand-hint" style="margin-left: auto">
                                        {{
                                            formatMessage(msg.admin.topFeatureCount, {
                                                count: editFeatures.length,
                                            })
                                        }}
                                    </span>
                                </div>

                                <div class="mc-tf-list">
                                    <div v-for="(f, i) in editFeatures" :key="i" class="mc-tf-row">
                                        <span class="mc-tf-num">{{ i + 1 }}</span>
                                        <input
                                            class="mc-field mc-tf-label"
                                            :placeholder="
                                                f.key
                                                    ? resolveComponentLabel(f.key)
                                                    : msg.admin.featureLabelPlaceholder
                                            "
                                            :value="f.label"
                                            :disabled="busy"
                                            @input="
                                                $emit('update-feature-label', i, textValue($event))
                                            "
                                            @change="$emit('persist-features', row)"
                                        />
                                        <input
                                            class="mc-field mc-tf-strong"
                                            :placeholder="msg.admin.featureStrongPlaceholder"
                                            :value="f.strong"
                                            :disabled="busy"
                                            @input="
                                                $emit('update-feature-strong', i, textValue($event))
                                            "
                                            @change="$emit('persist-features', row)"
                                        />
                                        <div class="mc-tf-actions">
                                            <button
                                                type="button"
                                                class="mc-iconbtn"
                                                :title="msg.admin.moveUp"
                                                :disabled="i === 0 || busy"
                                                @click="$emit('move-feature', row, i, -1)"
                                            >
                                                ▲
                                            </button>
                                            <button
                                                type="button"
                                                class="mc-iconbtn"
                                                :title="msg.admin.moveDown"
                                                :disabled="i === editFeatures.length - 1 || busy"
                                                @click="$emit('move-feature', row, i, 1)"
                                            >
                                                ▼
                                            </button>
                                            <button
                                                type="button"
                                                class="mc-iconbtn mc-iconbtn--danger"
                                                :title="common.remove"
                                                :disabled="busy"
                                                @click="$emit('remove-feature', row, i)"
                                            >
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2.5"
                                                >
                                                    <path d="M18 6 6 18M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div v-if="editFeatures.length === 0" class="mc-tf-empty">
                                        {{ msg.admin.topFeaturesEmpty }}
                                    </div>
                                </div>

                                <div class="mc-tf-add">
                                    <button
                                        type="button"
                                        class="mc-btn mc-btn--sm"
                                        :disabled="busy"
                                        @click="$emit('add-feature', row)"
                                    >
                                        <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2.5"
                                        >
                                            <path d="M12 5v14M5 12h14" />
                                        </svg>
                                        <span>{{ msg.admin.addCustomFeature }}</span>
                                    </button>
                                    <div
                                        v-if="suggestionsFor(row).length > 0"
                                        class="mc-tf-suggestions"
                                    >
                                        <span class="mc-expand-hint">
                                            {{ msg.admin.suggestionsLabel }}
                                        </span>
                                        <button
                                            v-for="(s, i) in suggestionsFor(row)"
                                            :key="i"
                                            type="button"
                                            class="mc-tf-chip"
                                            :disabled="busy"
                                            :title="
                                                formatMessage(msg.admin.addSuggestionTitle, {
                                                    label: s.label,
                                                })
                                            "
                                            @click="$emit('add-suggestion', row, s)"
                                        >
                                            <svg
                                                width="11"
                                                height="11"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2.5"
                                            >
                                                <path d="M12 5v14M5 12h14" />
                                            </svg>
                                            <span>{{ s.label }}</span>
                                            <em v-if="s.strong">· {{ s.strong }}</em>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { MarketingTopFeature, PlanRow, PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { FeatureSuggestion, MarketingRow, ResolvedMarketing } from './types.js';

defineProps<{
    adminRows: MarketingRow[];
    busy: boolean;
    expandedKey: string | null;
    activeLocale: string;
    defaultLocale: string;
    editFeatures: MarketingTopFeature[];
    formatVersionTitle: (version: PlanVersionRow) => string;
    formatVersionTab: (version: PlanVersionRow) => string;
    autoCtaText: (row: MarketingRow) => string;
    ctaValue: (raw: string) => string | null;
    resolveComponentLabel: (key: string) => string;
    suggestionsFor: (row: MarketingRow) => FeatureSuggestion[];
}>();

defineEmits<{
    (e: 'select-version', plan: PlanRow, versionId: string): void;
    (e: 'patch', row: MarketingRow, partial: Partial<ResolvedMarketing>): void;
    (e: 'patch-display-label', row: MarketingRow, value: string): void;
    (e: 'toggle-expand', row: MarketingRow): void;
    (e: 'update-feature-label', index: number, value: string): void;
    (e: 'update-feature-strong', index: number, value: string): void;
    (e: 'persist-features', row: MarketingRow): void;
    (e: 'move-feature', row: MarketingRow, index: number, dir: -1 | 1): void;
    (e: 'remove-feature', row: MarketingRow, index: number): void;
    (e: 'add-feature', row: MarketingRow): void;
    (e: 'add-suggestion', row: MarketingRow, suggestion: FeatureSuggestion): void;
}>();

const msg = useSaMessages('marketing');
const common = useSaMessages('common');

/** Hint below the trial toggle — shows the auto CTA text for the set trial days. */
function trialCtaHint(row: MarketingRow): string {
    const cta = formatMessage(msg.value.cta.trial, { days: row.m.trialDays });
    return formatMessage(msg.value.admin.ctaAutoHint, { cta });
}

function textValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
}

function numberValue(event: Event): number {
    return Number((event.target as HTMLInputElement | null)?.value ?? 0);
}

function checked(event: Event): boolean {
    return (event.target as HTMLInputElement | null)?.checked ?? false;
}
</script>
