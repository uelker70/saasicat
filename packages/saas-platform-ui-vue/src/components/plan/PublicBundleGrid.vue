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
                <span
                    v-if="row.bundle.compatiblePlanKeys.length === 0"
                    class="sp-public-bundle__tag"
                >
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

            <div v-if="row.bundle.features.length > 0" class="sp-public-bundle__features">
                <span v-for="featureKey in row.bundle.features" :key="featureKey">
                    {{ featureLabel(featureKey) }}
                </span>
            </div>

            <div v-if="Object.keys(row.bundle.quotas).length > 0" class="sp-public-bundle__quotas">
                <span v-for="[key, value] in Object.entries(row.bundle.quotas)" :key="key">
                    {{ quotaLabel(key) }} +{{ value === -1 ? '∞' : value }}
                </span>
            </div>

            <div class="sp-public-bundle__foot">
                <strong>{{ priceLabel(row.bundle) }}</strong>
                <span v-if="row.bundle.monthlyNet !== null" class="sp-public-bundle__cycle">
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
} from '@saasicat/types';
import type { BillingCycleStr } from '../../use-tenant-billing.js';

interface I18n {
    perMonth: string;
    perYear: string;
    empty: string;
    allPlans: string;
    priceOnRequest: string;
    alreadyBooked: string;
    missingRequires: string;
}

const props = defineProps<{
    bundles: PublicMarketingBundle[];
    selected: Set<string>;
    cycle: BillingCycleStr;
    /** Features des gewählten Plans — Basis der requires-/Redundanz-Deckung (#35). */
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
    state: BundleAvailabilityState;
    missingRequires: string[];
    selected: boolean;
    /** Nur nicht-gewählte, nicht-buchbare Bundles sind gesperrt. */
    disabled: boolean;
}

// Deckung pro Bundle = Plan-Features ∪ Features der übrigen *gewählten* Bundles.
// Geteilt mit dem Subscription-Draft, damit Ausgrauung und Preis-Exklusion
// dieselbe Redundanz sehen.
const selectedBundleShapes = computed(() =>
    props.bundles.filter((b) => props.selected.has(b.bundleVersionId)),
);

// Ein bereits gewähltes Bundle bleibt abwählbar, auch wenn es durch eine
// spätere Auswahl `covered` wurde — sonst steckt es fest. Gesperrt wird nur
// das *Anwählen* eines nicht-buchbaren Bundles (missing-requires oder ein
// noch nicht gewähltes covered-Bundle).
const bundleRows = computed<BundleRow[]>(() =>
    props.bundles.map((bundle) => {
        const covered = coverageExcludingSelf(
            bundle.bundleVersionId,
            props.planFeatures,
            selectedBundleShapes.value,
        );
        const state = resolveBundleAvailability(bundle, covered);
        const selected = props.selected.has(bundle.bundleVersionId);
        return {
            bundle,
            state,
            missingRequires: missingRequiresFor(bundle, covered),
            selected,
            disabled: !selected && state !== 'bookable',
        };
    }),
);

function onToggle(row: BundleRow): void {
    if (row.disabled) return;
    emit('toggle', row.bundle.bundleVersionId);
}

function priceFor(bundle: PublicMarketingBundle): number | null {
    if (bundle.monthlyNet === null) return null;
    if (props.cycle === 'YEARLY') {
        return bundle.yearlyNet ?? bundle.monthlyNet * 10;
    }
    return bundle.monthlyNet;
}

function priceLabel(bundle: PublicMarketingBundle): string {
    const price = priceFor(bundle);
    return price === null ? props.i18n.priceOnRequest : props.formatCurrency(price);
}
</script>

<style scoped>
.sp-public-bundles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 10px;
}
.sp-public-bundle {
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    background: #fff;
    border: 1.5px solid rgba(0, 0, 0, 0.1);
    border-radius: 14px;
    padding: 14px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: all 160ms;
}
.sp-public-bundle:hover {
    transform: translateY(-2px);
    border-color: rgba(15, 118, 110, 0.3);
}
.sp-public-bundle--on {
    border-color: var(--q-primary, #0f766e);
    background: linear-gradient(180deg, rgba(15, 118, 110, 0.06), #fff 80%);
}
.sp-public-bundle--off {
    cursor: not-allowed;
    opacity: 0.55;
}
.sp-public-bundle--off:hover {
    transform: none;
    border-color: rgba(0, 0, 0, 0.1);
}
.sp-public-bundle__head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
}
.sp-public-bundle__name {
    font-size: 14px;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.85);
}
.sp-public-bundle__desc {
    margin: 4px 0 0;
    color: rgba(0, 0, 0, 0.55);
    font-size: 12px;
    line-height: 1.4;
}
.sp-public-bundle__tag {
    align-self: flex-start;
    white-space: nowrap;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: #166534;
    background: rgba(22, 163, 74, 0.16);
    padding: 3px 7px;
    border-radius: 999px;
    font-weight: 700;
    text-transform: uppercase;
}
.sp-public-bundle__state {
    align-self: flex-start;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    line-height: 1.3;
}
.sp-public-bundle__state--covered {
    color: #166534;
    background: rgba(22, 163, 74, 0.16);
}
.sp-public-bundle__state--blocked {
    color: rgba(0, 0, 0, 0.6);
    background: rgba(0, 0, 0, 0.08);
}
.sp-public-bundle__features,
.sp-public-bundle__quotas {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.55);
    line-height: 1.4;
}
.sp-public-bundle__features span::before,
.sp-public-bundle__quotas span::before {
    content: '+ ';
    color: var(--q-primary, #0f766e);
    font-weight: 700;
}
.sp-public-bundle__foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-top: 8px;
    margin-top: auto;
    border-top: 1px dashed rgba(0, 0, 0, 0.08);
}
.sp-public-bundle__foot strong {
    font-size: 16px;
    font-weight: 800;
    color: rgba(0, 0, 0, 0.85);
}
.sp-public-bundle__cycle {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 9.5px;
    color: rgba(0, 0, 0, 0.55);
    letter-spacing: 0.06em;
}
.sp-public-bundles__empty {
    grid-column: 1 / -1;
    color: rgba(0, 0, 0, 0.5);
    font-style: italic;
    font-size: 13px;
    padding: 20px;
    text-align: center;
}
</style>
