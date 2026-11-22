<template>
    <div class="sp-public-bundles">
        <button
            v-for="row in bundleRows"
            :key="row.bundle.bundleVersionId"
            type="button"
            class="sp-public-bundle"
            :class="{
                'sp-public-bundle--on': row.selected,
                'sp-public-bundle--off': row.disabled,
            }"
            :aria-pressed="row.selected"
            :aria-disabled="row.disabled"
            :disabled="row.disabled"
            @click="onToggle(row)"
        >
            <div class="sp-public-bundle__head">
                <div>
                    <div class="sp-public-bundle__name">{{ row.bundle.label }}</div>
                    <p v-if="row.bundle.description" class="sp-public-bundle__desc">
                        {{ row.bundle.description }}
                    </p>
                </div>
                <span v-if="row.offeredWithEveryPlan" class="sp-public-bundle__tag">
                    {{ i18n.allPlans }}
                </span>
            </div>

            <div
                v-if="row.state === 'covered'"
                class="sp-public-bundle__state sp-public-bundle__state--covered"
            >
                {{ i18n.alreadyBooked }}
            </div>
            <div
                v-else-if="row.state === 'missing-requires'"
                class="sp-public-bundle__state sp-public-bundle__state--blocked"
            >
                {{ i18n.missingRequires }}: {{ row.missingRequires.map(featureLabel).join(', ') }}
            </div>
            <div
                v-else-if="row.state === 'not-priced-for-cycle'"
                class="sp-public-bundle__state sp-public-bundle__state--blocked"
            >
                {{ i18n.notSoldInCycle }}
            </div>
            <div
                v-else-if="row.price.kind === 'depends-on-plan'"
                class="sp-public-bundle__state sp-public-bundle__state--note"
            >
                {{ i18n.dependsOnPlan }}
            </div>

            <div v-if="row.bundle.features.length > 0" class="sp-public-bundle__features">
                <span v-for="featureKey in row.bundle.features" :key="featureKey">
                    {{ featureLabel(featureKey) }}
                    <WithdrawnFeatureMark :feature-key="featureKey" />
                </span>
            </div>

            <div v-if="Object.keys(row.bundle.quotas).length > 0" class="sp-public-bundle__quotas">
                <span v-for="[key, value] in Object.entries(row.bundle.quotas)" :key="key">
                    {{ quotaLabel(key) }} +{{ value === -1 ? '∞' : value }}
                </span>
            </div>

            <div v-if="row.shownNet !== null" class="sp-public-bundle__foot">
                <strong>{{ formatCurrency(row.shownNet) }}</strong>
                <span class="sp-public-bundle__cycle">
                    /{{ cycle === 'YEARLY' ? i18n.perYear : i18n.perMonth }}
                </span>
            </div>
        </button>
        <div v-if="bundles.length === 0" class="sp-public-bundles__empty">
            {{ i18n.empty }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
    resolveBundleAvailability,
    missingRequiresFor,
    coverageExcludingSelf,
    type BundleAvailabilityState,
    type PublicMarketingBundle,
} from '@saasicat/core';
import {
    addOnPriceBeside,
    isOfferedWithEveryPlan,
    type AddOnPriceBeside,
    type BillingCycleStr,
} from '@saasicat/ui-vue';
import WithdrawnFeatureMark from '../WithdrawnFeatureMark.vue';

interface I18n {
    perMonth: string;
    perYear: string;
    empty: string;
    allPlans: string;
    /** A bundle with a price in the other cycle only. */
    notSoldInCycle: string;
    alreadyBooked: string;
    missingRequires: string;
    /** Beside a bundle's own price while no plan is chosen: what it costs depends on the plan. */
    dependsOnPlan: string;
}

const props = defineProps<{
    bundles: PublicMarketingBundle[];
    selected: Set<string>;
    cycle: BillingCycleStr;
    /** The chosen plan's key; `null` while none is chosen. */
    planKey: string | null;
    /** The keys of every plan on offer, to tell an add-on offered with all of them. */
    planKeys: string[];
    /** Features of the selected plan — basis for requires/redundancy coverage (#35). */
    planFeatures: string[];
    formatCurrency: (value: number) => string;
    featureLabel: (key: string) => string;
    quotaLabel: (key: string) => string;
    i18n: I18n;
}>();

const emit = defineEmits<{
    toggle: [bundleVersionId: string];
}>();

interface BundleRow {
    bundle: PublicMarketingBundle;
    state: BundleAvailabilityState | 'not-priced-for-cycle';
    price: AddOnPriceBeside;
    /** The figure on the card: the plan's price, or the bundle's own while no plan is chosen. */
    shownNet: number | null;
    offeredWithEveryPlan: boolean;
    missingRequires: string[];
    selected: boolean;
    /** Only unselected, non-bookable bundles are locked. */
    disabled: boolean;
}

// Coverage per bundle = plan features ∪ features of the other *selected* bundles.
// Shared with the subscription draft, so that graying-out and price exclusion
// see the same redundancy.
const selectedBundleShapes = computed(() =>
    props.bundles.filter((b) => props.selected.has(b.bundleVersionId)),
);

// An already-selected bundle stays deselectable, even when it became
// `covered` through a later selection — otherwise it gets stuck. Only
// *selecting* a non-bookable bundle is locked (missing-requires or a
// not-yet-selected covered bundle).
const bundleRows = computed<BundleRow[]>(() =>
    props.bundles.map((bundle) => {
        const covered = coverageExcludingSelf(
            bundle.bundleVersionId,
            props.planFeatures,
            selectedBundleShapes.value,
        );
        const availability = resolveBundleAvailability(bundle, covered);
        const price = addOnPriceBeside(bundle, props.planKey, props.cycle);
        // Last, so a covered bundle or one missing a prerequisite keeps the
        // reason that actually explains it.
        const state =
            availability === 'bookable' && price.kind === 'not-in-cycle'
                ? 'not-priced-for-cycle'
                : availability;
        const selected = props.selected.has(bundle.bundleVersionId);
        return {
            bundle,
            state,
            price,
            shownNet: shownNetOf(price),
            offeredWithEveryPlan:
                props.planKeys.length > 0 && isOfferedWithEveryPlan(bundle, props.planKeys),
            missingRequires: missingRequiresFor(bundle, covered),
            selected,
            disabled: !selected && (state !== 'bookable' || price.kind === 'not-with-plan'),
        };
    }),
);

function onToggle(row: BundleRow): void {
    if (row.disabled) return;
    emit('toggle', row.bundle.bundleVersionId);
}

function shownNetOf(price: AddOnPriceBeside): number | null {
    if (price.kind === 'priced') return price.net;
    if (price.kind === 'depends-on-plan') return price.baseNet;
    return null;
}
</script>

<style scoped>
.sp-public-bundles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: var(--sa-space-3);
}
.sp-public-bundle {
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    background: var(--sa-color-bg-surface);
    border: 1.5px solid var(--sa-color-border);
    border-radius: var(--sa-radius-section);
    padding: var(--sa-space-4) var(--sa-space-5) var(--sa-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
    transition: all 160ms;
}
.sp-public-bundle:hover {
    transform: translateY(-2px);
    border-color: var(--sa-color-accent-border);
}
.sp-public-bundle--on {
    border-color: var(--sa-color-accent);
    background: linear-gradient(
        180deg,
        var(--sa-color-accent-surface-soft),
        var(--sa-color-bg-surface) 80%
    );
}
.sp-public-bundle--off {
    cursor: not-allowed;
    opacity: 0.55;
}
.sp-public-bundle--off:hover {
    transform: none;
    border-color: var(--sa-color-border);
}
.sp-public-bundle__head {
    display: flex;
    justify-content: space-between;
    gap: var(--sa-space-3);
}
.sp-public-bundle__name {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sp-public-bundle__desc {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
    line-height: 1.4;
}
.sp-public-bundle__tag {
    align-self: flex-start;
    white-space: nowrap;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: var(--sa-text-2xs);
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-positive-fg);
    background: var(--sa-color-positive-surface-strong);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-weight: 700;
    text-transform: uppercase;
}
.sp-public-bundle__state {
    align-self: flex-start;
    font-size: var(--sa-text-xs);
    font-weight: 700;
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    line-height: 1.3;
}
.sp-public-bundle__state--covered {
    color: var(--sa-color-positive-fg);
    background: var(--sa-color-positive-surface-strong);
}
.sp-public-bundle__state--blocked,
.sp-public-bundle__state--note {
    color: var(--sa-color-fg-secondary);
    background: var(--sa-color-bg-sunken);
}
.sp-public-bundle__features,
.sp-public-bundle__quotas {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-1);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    line-height: 1.4;
}
.sp-public-bundle__features span::before,
.sp-public-bundle__quotas span::before {
    content: '+ ';
    color: var(--sa-color-accent);
    font-weight: 700;
}
.sp-public-bundle__foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-top: var(--sa-space-3);
    margin-top: auto;
    border-top: 1px dashed var(--sa-color-border);
}
.sp-public-bundle__foot strong {
    font-size: var(--sa-text-lg);
    font-weight: 800;
    color: var(--sa-color-fg-heading);
}
.sp-public-bundle__cycle {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: var(--sa-text-2xs);
    color: var(--sa-color-fg-muted);
    letter-spacing: var(--sa-tracking-wider);
}
.sp-public-bundles__empty {
    grid-column: 1 / -1;
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
    padding: var(--sa-space-6);
    text-align: center;
}
</style>
