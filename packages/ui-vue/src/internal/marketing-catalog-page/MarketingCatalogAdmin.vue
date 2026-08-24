<template>
    <div class="sa-marketing-admin">
        <div class="sa-marketing-admin-head">
            <div style="flex: 1">
                <div class="sa-marketing-admin-title">{{ msg.tabs.admin }}</div>
                <div class="sa-marketing-admin-sub">{{ msg.admin.subtitle }}</div>
            </div>
        </div>

        <div class="sa-marketing-admin-grid">
            <div class="sa-marketing-admin-thead">
                <div>
                    <span class="sa-sr-only">{{ msg.admin.colOrder }}</span>
                </div>
                <div>{{ msg.admin.colPlan }}</div>
                <div>{{ msg.admin.colVisible }}</div>
                <div>{{ msg.admin.colBadge }}</div>
                <div>{{ msg.admin.colHighlight }}</div>
            </div>

            <template v-for="row in adminRows" :key="row.plan.id">
                <div
                    class="sa-marketing-admin-row"
                    :class="{
                        'sa-marketing-admin-row--disabled': !row.liveVersion,
                        'sa-marketing-admin-row--open': expandedKey === row.plan.planKey,
                        'sa-marketing-admin-row--dragging':
                            reorder.draggingIndex.value === dragIndexOf(row),
                        'sa-marketing-admin-row--drop-above': dropEdge(row) === 'above',
                        'sa-marketing-admin-row--drop-below': dropEdge(row) === 'below',
                    }"
                    @click="onRowClick(row, $event)"
                >
                    <div class="sa-marketing-grip-cell">
                        <!-- @optionSurface
                             The drag handle, and the row's keyboard path to its own position:
                             arrow keys move the row one step, which WCAG 2.2 SC 2.5.7 requires
                             to exist without a pointer. `q-btn` renders a label and a ripple
                             around its icon; what this needs is the icon and a grab cursor. -->
                        <button
                            v-if="dragIndexOf(row) !== null"
                            :ref="(el) => registerHandle(dragIndexOf(row)!, el)"
                            type="button"
                            class="sa-marketing-grip"
                            :class="{
                                'sa-marketing-grip--dragging':
                                    reorder.draggingIndex.value === dragIndexOf(row),
                            }"
                            :disabled="busy"
                            :aria-label="
                                formatMessage(msg.admin.reorderLabel, {
                                    plan: row.m.displayLabel || row.plan.label,
                                    position: dragIndexOf(row)! + 1,
                                    total: draggableRows.length,
                                })
                            "
                            :title="msg.admin.reorderTitle"
                            @pointerdown="reorder.start(dragIndexOf(row)!, $event)"
                            @keydown.up.prevent="moveBy(dragIndexOf(row)!, -1)"
                            @keydown.down.prevent="moveBy(dragIndexOf(row)!, 1)"
                        >
                            <q-icon name="drag_indicator" size="18px" />
                        </button>
                    </div>
                    <div>
                        <!-- @optionSurface
                             The row's KEYBOARD path to the disclosure, and the element that
                             owns `aria-expanded` and `aria-controls`. A pointer may click the
                             whole row (see `onRowClick`); a keyboard needs one thing to tab to,
                             and it cannot be the row — five grid cells carrying two checkboxes
                             and two text fields are not a control. `q-btn` renders a label, and
                             what this wraps is a two-line block with a colour mark. -->
                        <button
                            type="button"
                            class="sa-marketing-plan-cell"
                            :class="{ 'sa-marketing-plan-cell--static': !row.liveVersion }"
                            :disabled="!row.liveVersion"
                            :title="row.liveVersion ? msg.admin.expandTitle : undefined"
                            :aria-expanded="
                                row.liveVersion ? expandedKey === row.plan.planKey : undefined
                            "
                            :aria-controls="row.liveVersion ? panelId(row) : undefined"
                            @click="row.liveVersion && $emit('toggle-expand', row)"
                        >
                            <div
                                class="sa-marketing-plan-mark"
                                :style="identityChipStyle(row.accent)"
                            >
                                {{ row.plan.planKey.slice(0, 3) }}
                            </div>
                            <div>
                                <div class="sa-marketing-plan-titlerow">
                                    <span class="sa-marketing-plan-label">
                                        {{ row.m.displayLabel || row.plan.label }}
                                    </span>
                                    <span
                                        v-if="!row.liveVersion"
                                        class="sa-marketing-chip sa-marketing-chip--muted"
                                    >
                                        {{ msg.admin.noLiveVersion }}
                                    </span>
                                    <span
                                        v-else-if="!row.m.visible"
                                        class="sa-marketing-chip sa-marketing-chip--muted"
                                    >
                                        {{ msg.admin.hidden }}
                                    </span>
                                    <span
                                        v-else-if="row.m.highlight"
                                        class="sa-marketing-chip sa-marketing-chip--featured"
                                    >
                                        {{ msg.admin.featured }}
                                    </span>
                                    <span
                                        v-else
                                        class="sa-marketing-chip sa-marketing-chip--live"
                                        >{{ msg.admin.live }}</span
                                    >
                                </div>
                                <div class="sa-marketing-plan-key">{{ row.plan.planKey }}</div>
                            </div>
                        </button>
                        <div
                            v-if="row.publishedVersions.length > 1"
                            class="sa-marketing-version-tabs"
                            role="tablist"
                            :aria-label="
                                formatMessage(msg.admin.versionTabsLabel, { plan: row.plan.label })
                            "
                        >
                            <q-btn
                                v-for="v in row.publishedVersions"
                                :key="v.id"
                                class="sa-marketing-version-tab"
                                flat
                                dense
                                no-caps
                                :label="formatVersionTab(v)"
                                role="tab"
                                :class="{
                                    'sa-marketing-version-tab--active':
                                        row.liveVersion?.id === v.id,
                                }"
                                :title="formatVersionTitle(v)"
                                @click="$emit('select-version', row.plan, v.id)"
                            />
                        </div>
                    </div>
                    <div>
                        <q-toggle
                            :model-value="row.m.visible"
                            dense
                            :disable="!row.liveVersion || busy"
                            @update:model-value="$emit('patch', row, { visible: $event })"
                        />
                    </div>
                    <div>
                        <q-input
                            :model-value="row.m.badge"
                            outlined
                            dense
                            class="sa-marketing-field--badge"
                            placeholder="—"
                            :disable="!row.liveVersion || busy"
                            @update:model-value="
                                $emit('patch', row, { badge: String($event ?? '') })
                            "
                        />
                    </div>
                    <div>
                        <q-toggle
                            :model-value="row.m.highlight"
                            dense
                            :disable="!row.liveVersion || busy"
                            @update:model-value="$emit('patch', row, { highlight: $event })"
                        />
                    </div>
                </div>

                <div
                    v-if="expandedKey === row.plan.planKey"
                    :id="panelId(row)"
                    class="sa-marketing-admin-expand"
                >
                    <div class="sa-marketing-expand-grid">
                        <div class="sa-marketing-expand-col">
                            <div class="sa-marketing-expand-sec">
                                <div class="sa-marketing-field-head">
                                    <label class="sa-marketing-expand-label">
                                        {{ msg.admin.planNameLabel }}
                                    </label>
                                    <span
                                        v-if="activeLocale !== defaultLocale"
                                        class="sa-marketing-source-hint"
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
                                <div
                                    v-if="activeLocale === defaultLocale"
                                    class="sa-marketing-locked-value"
                                >
                                    <span>{{ row.plan.label }}</span>
                                    <span class="sa-marketing-locked-hint">
                                        {{ msg.admin.planNameLocked }}
                                    </span>
                                </div>
                                <q-input
                                    v-else
                                    :model-value="row.m.displayLabel"
                                    outlined
                                    dense
                                    :placeholder="row.plan.label"
                                    :disable="busy"
                                    @update:model-value="
                                        $emit('patch-display-label', row, String($event ?? ''))
                                    "
                                />
                                <div
                                    v-if="activeLocale !== defaultLocale && !row.m.displayLabel"
                                    class="sa-marketing-expand-hint"
                                >
                                    {{
                                        formatMessage(msg.admin.planNameFallbackHint, {
                                            label: row.plan.label,
                                        })
                                    }}
                                </div>
                            </div>

                            <div class="sa-marketing-expand-sec">
                                <label class="sa-marketing-expand-label">{{
                                    msg.admin.teaserLabel
                                }}</label>
                                <q-input
                                    :model-value="row.m.description"
                                    outlined
                                    dense
                                    type="textarea"
                                    :rows="2"
                                    :placeholder="msg.admin.teaserPlaceholder"
                                    :disable="busy"
                                    @update:model-value="
                                        $emit('patch', row, { description: String($event ?? '') })
                                    "
                                />
                                <div class="sa-marketing-expand-hint">
                                    {{ msg.admin.teaserHint }}
                                </div>
                            </div>

                            <div class="sa-marketing-expand-sec">
                                <label class="sa-marketing-expand-label">{{
                                    msg.admin.trialLabel
                                }}</label>
                                <div class="sa-marketing-trial-row">
                                    <q-toggle
                                        :model-value="row.m.trialEnabled"
                                        dense
                                        :disable="busy"
                                        @update:model-value="
                                            $emit('patch', row, { trialEnabled: $event })
                                        "
                                    />
                                    <span class="sa-marketing-trial-label">
                                        {{
                                            row.m.trialEnabled
                                                ? msg.admin.trialOn
                                                : msg.admin.trialOff
                                        }}
                                    </span>
                                    <span class="sa-marketing-trial-days">
                                        <q-input
                                            :model-value="row.m.trialDays"
                                            outlined
                                            dense
                                            type="number"
                                            min="1"
                                            max="365"
                                            class="sa-marketing-field--number"
                                            :disable="!row.m.trialEnabled || busy"
                                            @update:model-value="
                                                $emit('patch', row, {
                                                    trialDays: Number($event) || 0,
                                                })
                                            "
                                        />
                                        <span class="sa-marketing-trial-unit">
                                            {{ msg.admin.trialDaysUnit }}
                                        </span>
                                    </span>
                                </div>
                                <div class="sa-marketing-expand-hint">{{ trialCtaHint(row) }}</div>
                            </div>

                            <div class="sa-marketing-expand-sec">
                                <label class="sa-marketing-expand-label">
                                    {{ msg.admin.ctaOverrideLabel }}
                                </label>
                                <q-input
                                    :model-value="row.m.ctaLabel ?? ''"
                                    outlined
                                    dense
                                    :placeholder="autoCtaText(row)"
                                    :disable="busy"
                                    @update:model-value="
                                        $emit('patch', row, {
                                            ctaLabel: ctaValue(String($event ?? '')),
                                        })
                                    "
                                />
                                <div class="sa-marketing-expand-hint">
                                    {{ msg.admin.ctaOverrideHint }}
                                </div>
                            </div>
                        </div>

                        <div class="sa-marketing-expand-col">
                            <div class="sa-marketing-expand-sec">
                                <div class="sa-marketing-tf-head">
                                    <label class="sa-marketing-expand-label" style="margin: 0">
                                        {{ msg.topFeatures }}
                                    </label>
                                    <span
                                        class="sa-marketing-expand-hint"
                                        style="margin-left: auto"
                                    >
                                        {{
                                            formatMessage(msg.admin.topFeatureCount, {
                                                count: editFeatures.length,
                                            })
                                        }}
                                    </span>
                                </div>

                                <div class="sa-marketing-tf-list">
                                    <div
                                        v-for="(f, i) in editFeatures"
                                        :key="i"
                                        class="sa-marketing-tf-row"
                                    >
                                        <span class="sa-marketing-tf-num">{{ i + 1 }}</span>
                                        <q-input
                                            :model-value="f.label"
                                            outlined
                                            dense
                                            class="sa-marketing-tf-label"
                                            :placeholder="
                                                f.key
                                                    ? resolveComponentLabel(f.key)
                                                    : msg.admin.featureLabelPlaceholder
                                            "
                                            :disable="busy"
                                            @update:model-value="
                                                $emit(
                                                    'update-feature-label',
                                                    i,
                                                    String($event ?? ''),
                                                )
                                            "
                                            @blur="$emit('persist-features', row)"
                                        />
                                        <q-input
                                            :model-value="f.strong"
                                            outlined
                                            dense
                                            class="sa-marketing-tf-strong"
                                            :placeholder="msg.admin.featureStrongPlaceholder"
                                            :disable="busy"
                                            @update:model-value="
                                                $emit(
                                                    'update-feature-strong',
                                                    i,
                                                    String($event ?? ''),
                                                )
                                            "
                                            @blur="$emit('persist-features', row)"
                                        />
                                        <div class="sa-marketing-tf-actions">
                                            <q-btn
                                                class="sa-marketing-iconbtn"
                                                flat
                                                dense
                                                icon="arrow_upward"
                                                :title="msg.admin.moveUp"
                                                :disable="i === 0 || busy"
                                                @click="$emit('move-feature', row, i, -1)"
                                            />
                                            <q-btn
                                                class="sa-marketing-iconbtn"
                                                flat
                                                dense
                                                icon="arrow_downward"
                                                :title="msg.admin.moveDown"
                                                :disable="i === editFeatures.length - 1 || busy"
                                                @click="$emit('move-feature', row, i, 1)"
                                            />
                                            <q-btn
                                                class="sa-marketing-iconbtn"
                                                flat
                                                no-caps
                                                color="negative"
                                                :title="common.remove"
                                                :disable="busy"
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
                                            </q-btn>
                                        </div>
                                    </div>
                                    <div
                                        v-if="editFeatures.length === 0"
                                        class="sa-marketing-tf-empty"
                                    >
                                        {{ msg.admin.topFeaturesEmpty }}
                                    </div>
                                </div>

                                <div class="sa-marketing-tf-add">
                                    <q-btn
                                        flat
                                        dense
                                        no-caps
                                        :label="msg.admin.addCustomFeature"
                                        :disable="busy"
                                        @click="$emit('add-feature', row)"
                                    />
                                    <div
                                        v-if="suggestionsFor(row).length > 0"
                                        class="sa-marketing-tf-suggestions"
                                    >
                                        <span class="sa-marketing-expand-hint">
                                            {{ msg.admin.suggestionsLabel }}
                                        </span>
                                        <q-btn
                                            v-for="(s, i) in suggestionsFor(row)"
                                            :key="i"
                                            class="sa-marketing-tf-chip"
                                            flat
                                            dense
                                            no-caps
                                            icon="add"
                                            :disable="busy"
                                            :title="
                                                formatMessage(msg.admin.addSuggestionTitle, {
                                                    label: s.label,
                                                })
                                            "
                                            @click="$emit('add-suggestion', row, s)"
                                        >
                                            <span>{{ s.label }}</span>
                                            <em v-if="s.strong">· {{ s.strong }}</em>
                                        </q-btn>
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
import { computed, useId } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { MarketingTopFeature, PlanRow, PlanVersionRow } from '@saasicat/core';
import { identityChipStyle } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { useRowReorder } from '../../vue/use-row-reorder.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { FeatureSuggestion, MarketingRow, ResolvedMarketing } from './types.js';

const props = defineProps<{
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

const emit = defineEmits<{
    (e: 'select-version', plan: PlanRow, versionId: string): void;
    (e: 'patch', row: MarketingRow, partial: Partial<ResolvedMarketing>): void;
    (e: 'patch-display-label', row: MarketingRow, value: string): void;
    (e: 'toggle-expand', row: MarketingRow): void;
    /** A row moved from one position to another. Positions, not priorities. */
    (e: 'reorder', from: number, to: number): void;
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

// sa-disclosure-exempt(writes `aria-expanded`):
// this row is five grid cells, not a header that opens a body
//
// Every other disclosure in the package is an `AdminAccordion`. This one cannot
// be, and the obstacle is structural rather than a matter of taste.
//
// The rows here are `display: contents` inside a five-column grid, and the open
// editor is a sibling at `grid-column: 1 / -1` (both declared in
// `MarketingCatalogPage.vue`). A self-contained wrapper around either would put
// a box between the grid and its cells, and the columns would stop lining up.
// A wrapper-less `AdminAccordion` variant would not rescue it either: the
// component's recipe is a trigger that FILLS the header, and this header is
// five cells carrying two checkboxes and two text inputs — interactive content
// nested in a `<button>` is not valid HTML. What would be left of the component
// after removing its wrapper, its full-width trigger, its badge and its body
// padding is a second component wearing the first one's name.
//
// So the disclosure stays here, and what it takes from the shared one is the
// part that has nothing to do with layout: the WAI-ARIA disclosure pattern —
// a `<button>` (it already was one) that says whether it is expanded and which
// element it controls. Not the `role="region"` half of `AdminAccordion`'s body:
// its trigger is named by the row it opens, whereas this one is named by the
// plan, and a screenful of regions all named "Edit teaser, trial & top
// features" would be worse than none.
//
// The title no longer flips to "Close" when open. `aria-expanded` says that
// now, and a control whose NAME changes with its state is announced as a
// different control each time.

/**
 * What a click has to land on to mean "not the row".
 *
 * The row is five cells, four of which hold a control, and a pointer that means
 * to flip a toggle must not also open the editor. Rather than list the cells —
 * a list drifts the moment a column is added — this asks each element the
 * question that actually decides it: can it take focus on its own, or does it
 * label something that can? That covers a native control, anything Quasar gives
 * a tab stop (its toggle is a `<div role="checkbox" tabindex="0">`), and the
 * `<label>` its fields wrap around their input.
 *
 * A role by itself is deliberately not in here. `role="alert"` and
 * `role="tablist"` sit on elements nobody clicks, and counting them as controls
 * would silence parts of the row for nothing. The walk that uses this stops at
 * the row — see `onRowClick`.
 */
const CONTROL_SELECTOR = 'a[href], button, input, select, textarea, label, [tabindex]';
const uid = useId();

/** The panel a row opens — unique per row, and per instance of this list. */
function panelId(row: MarketingRow): string {
    return `${uid}-marketing-panel-${row.plan.id}`;
}

/**
 * Opens the row unless the click was meant for something inside it.
 *
 * The identity block is a real `<button>`, so a click there is handled by the
 * button and stops here — the walk finds it, and the row does nothing. That is
 * what keeps one click from counting twice.
 */
function onRowClick(row: MarketingRow, event: MouseEvent): void {
    if (!row.liveVersion) return;
    const rowElement = event.currentTarget as HTMLElement;
    // Walked by hand rather than with `closest`, because `closest` does not
    // stop: it climbs out of the row and keeps going, so one focusable ancestor
    // above it — a dialog, a focus container, a consumer's layout — would answer
    // for the row and make every click in it look like a click on a control.
    for (let node = event.target as HTMLElement | null; node && node !== rowElement;) {
        if (node.matches(CONTROL_SELECTOR)) return;
        node = node.parentElement;
    }
    emit('toggle-expand', row);
}

// ── Reordering ──
//
// The list is sorted by priority, and the number that produced it used to be a
// field in every row: to move a plan up you had to work out what number would
// put it there, in a list that re-sorted under the cursor while you typed it.
// The handle says the same thing by pointing at where the row should be, and
// the page turns that into the numbers (`reorderedPriorities`).

/**
 * The rows a drag may move, in the order they are rendered.
 *
 * A plan with no live version cannot hold a marketing projection, so its
 * priority cannot be written — and the arithmetic that makes room for a moved
 * row assigns a value to EVERY position it is given. Handing it a row nobody
 * can write means one of the computed values is silently dropped and the
 * resulting order is not the one that was dragged: with `[A=10, B=0, X=0]` and
 * X unwritable, dragging A to the end wrote B=11 and A=0 while X kept its 0,
 * and the list re-sorted to `B, A, X`.
 *
 * So the whole gesture — handle registration, the geometry it is measured
 * from, the keyboard step and the emitted positions — counts only these rows.
 * The page maps them back the same way.
 */
const draggableRows = computed(() => props.adminRows.filter((row) => row.liveVersion));

/** A row's position among the draggable ones, or `null` if it is not one. */
function dragIndexOf(row: MarketingRow): number | null {
    const index = draggableRows.value.indexOf(row);
    return index === -1 ? null : index;
}

const handles: (HTMLElement | null)[] = [];

/**
 * Keeps the handle elements addressable by draggable index.
 *
 * The drop position is measured from them, because the rows themselves are
 * `display: contents` and report an empty rectangle.
 */
function registerHandle(index: number, el: Element | ComponentPublicInstance | null): void {
    handles[index] = el instanceof HTMLElement ? el : null;
}

const reorder = useRowReorder(
    () => draggableRows.value.length,
    (index) => handles[index] ?? null,
    (from, to) => emit('reorder', from, to),
);

/** Which edge of a row the drop line is drawn on, if any. */
function dropEdge(row: MarketingRow): 'above' | 'below' | null {
    const index = dragIndexOf(row);
    const from = reorder.draggingIndex.value;
    const to = reorder.targetIndex.value;
    if (index === null || from === null || to === null || from === to || index !== to) return null;
    return to < from ? 'above' : 'below';
}

/** The keyboard half of the same gesture. */
function moveBy(index: number, direction: -1 | 1): void {
    const to = index + direction;
    if (to < 0 || to >= draggableRows.value.length) return;
    emit('reorder', index, to);
}

/** Hint below the trial toggle — shows the auto CTA text for the set trial days. */
function trialCtaHint(row: MarketingRow): string {
    const cta = formatMessage(msg.value.cta.trial, { days: row.m.trialDays });
    return formatMessage(msg.value.admin.ctaAutoHint, { cta });
}
</script>
