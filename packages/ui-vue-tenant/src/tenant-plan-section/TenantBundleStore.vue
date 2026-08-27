<template>
    <TenantCardSection>
        <div class="sp-plan-section__usage-title">{{ i18n.bundlesStoreTitle }}</div>

        <!-- Booked bundles -->
        <div v-if="bookedRows.length > 0" class="sp-bundle-store__booked">
            <div class="sp-bundle-store__subtitle">{{ i18n.bundlesBookedTitle }}</div>
            <ul class="sp-plan-section__item-list">
                <li v-for="row in bookedRows" :key="row.id" class="sp-plan-section__item">
                    <div>
                        <span class="sp-plan-section__item-label">{{ row.label }}</span>
                        <span v-if="row.canceledAt" class="sp-plan-section__item-canceled">
                            {{ i18n.bundleCanceledAt }}
                            {{ formatDate(row.canceledEffectiveAt ?? row.canceledAt) }}
                        </span>
                        <span v-else-if="row.minimumTermEndsAt" class="sp-plan-section__item-price">
                            {{ i18n.bundleMinimumTermUntil }}
                            {{ formatDate(row.minimumTermEndsAt) }}
                        </span>
                    </div>
                    <div class="sp-bundle-store__booked-actions">
                        <span class="sp-plan-section__item-price">
                            {{ formatCurrency(row.priceNet) }} {{ unitFor(row.billingCycle) }}
                        </span>
                        <TenantButton
                            v-if="!row.canceledAt"
                            variant="quiet"
                            tone="danger"
                            :loading="cancelingId === row.id"
                            @click="emit('cancel', row.id)"
                        >
                            {{ i18n.bundleCancelAction }}
                        </TenantButton>
                        <TenantButton
                            v-else
                            variant="quiet"
                            tone="accent"
                            :loading="reactivatingId === row.id"
                            @click="emit('reactivate', row.id)"
                        >
                            {{ i18n.bundleReactivateAction }}
                        </TenantButton>
                    </div>
                </li>
            </ul>
        </div>

        <!-- Available bundles -->
        <div class="sp-bundle-store__available">
            <div class="sp-bundle-store__subtitle">{{ i18n.bundlesAvailableTitle }}</div>

            <!-- Only where there is something to choose. A monthly plan sells
                 monthly add-ons and nothing else, so a control with one option
                 would be a question with one answer. -->
            <div v-if="offersCycleChoice" class="sp-bundle-store__cycle">
                <span class="sp-bundle-store__cycle-legend">{{ i18n.bundleCycleLegend }}</span>
                <PlanCycleToggle
                    :model-value="selectedCycle"
                    :i18n="cycleI18n"
                    @update:model-value="chooseCycle"
                />
            </div>
            <div v-if="availableRows.length === 0" class="sp-bundle-store__empty">
                {{ i18n.bundlesAvailableEmpty }}
            </div>
            <div v-else class="sp-bundle-store__grid">
                <TenantCard
                    v-for="row in availableRows"
                    :key="row.bundle.bundleVersionId"
                    class="sp-bundle-store__card"
                    :class="{ 'sp-bundle-store__card--disabled': row.state !== 'bookable' }"
                >
                    <div class="sp-bundle-store__card-head">
                        <span class="sp-bundle-store__card-name">{{ row.bundle.label }}</span>
                        <span v-if="row.priceNet !== null" class="sp-bundle-store__card-price">
                            {{ formatCurrency(row.priceNet) }}
                            <small>{{ unitFor(selectedCycle) }}</small>
                        </span>
                    </div>

                    <span
                        v-if="row.state === 'booked'"
                        class="sp-badge sp-badge--positive sp-bundle-store__card-badge"
                    >
                        {{ i18n.bundleAlreadyBooked }}
                    </span>
                    <span
                        v-else-if="row.state === 'incompatible'"
                        class="sp-badge sp-badge--neutral sp-bundle-store__card-badge"
                    >
                        {{ i18n.bundleIncompatible }}
                    </span>
                    <span
                        v-else-if="row.state === 'not-priced-for-cycle'"
                        class="sp-badge sp-badge--neutral sp-bundle-store__card-badge"
                    >
                        {{ i18n.bundleNotPricedForCycle }}
                    </span>
                    <span
                        v-else-if="row.state === 'missing-requires'"
                        class="sp-badge sp-badge--neutral sp-bundle-store__card-badge"
                    >
                        {{ i18n.bundleMissingRequires }}:
                        {{ missingRequiresOf(row.bundle).map(featureLabel).join(', ') }}
                    </span>

                    <p v-if="row.bundle.description" class="sp-bundle-store__card-desc">
                        {{ row.bundle.description }}
                    </p>
                    <div v-if="row.bundle.features.length > 0" class="sp-bundle-store__card-feats">
                        <div class="sp-bundle-store__card-feats-label">
                            {{ i18n.bundleIncludesLabel }}:
                        </div>
                        <ul>
                            <li v-for="f in row.bundle.features" :key="f">{{ featureLabel(f) }}</li>
                        </ul>
                    </div>
                    <TenantButton
                        v-if="row.state === 'bookable'"
                        variant="solid"
                        tone="accent"
                        class="sp-bundle-store__card-action"
                        :loading="buyingId === row.bundle.bundleVersionId"
                        :disabled="buyingId !== null"
                        @click="emit('buy', row.bundle.bundleVersionId, selectedCycle)"
                    >
                        {{
                            buyingId === row.bundle.bundleVersionId
                                ? i18n.bundleBookInProgress
                                : i18n.bundleBookAction
                        }}
                    </TenantButton>
                </TenantCard>
            </div>
        </div>

        <div v-if="error" class="sp-plan-section__error">{{ error }}</div>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCard from '../ui/TenantCard.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';
import { missingRequiresFor } from '@saasicat/core';
import type { BillingCycleStr, CatalogBundle } from '@saasicat/ui-vue';
import PlanCycleToggle from '../plan/PlanCycleToggle.vue';
import type { SubscriptionBundleShape } from '@saasicat/ui-vue';

// TenantBundleStore — bundle sales on "Paket & Verbrauch" (#15):
// lists booked (cancelable) and available (bookable) catalog bundles.
// Source: `/billing/subscription-bundles` (booked) + `/billing/bundles`
// (catalog). Price/label of booked bundles are joined against the
// catalog via `bundleVersionId`.

const i18n = useTenantI18n();

const props = defineProps<{
    /** Booked SubscriptionBundles (incl. canceled). */
    booked: SubscriptionBundleShape[];
    /** Full bundle catalog (unfiltered — also used for joining booked bundles). */
    available: CatalogBundle[];
    /** Features of the current plan — for the compatibility check (#22). */
    planFeatures: string[];
    /**
     * The rhythm the plan itself is billed in.
     *
     * It decides two things: which rhythms an add-on may be sold in at all — a
     * bundle may never outlast the plan it hangs on, so a yearly add-on beside
     * a monthly plan is refused — and which one is preselected, so a tenant who
     * touches nothing gets what they got before this control existed.
     */
    planCycle: BillingCycleStr;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    featureLabel: (key: string) => string;
    /** bundleVersionId currently being booked (spinner). */
    buyingId: string | null;
    /** SubscriptionBundle id currently being canceled (spinner). */
    cancelingId: string | null;
    /** SubscriptionBundle id currently being reactivated (spinner). */
    reactivatingId: string | null;
    error: string | null;
}>();

const emit = defineEmits<{
    /** The second argument is the rhythm the tenant chose to be billed in. */
    buy: [bundleVersionId: string, billingCycle?: BillingCycleStr];
    cancel: [subscriptionBundleId: string];
    reactivate: [subscriptionBundleId: string];
}>();

const catalogByVersion = computed(
    () => new Map(props.available.map((b) => [b.bundleVersionId, b])),
);

interface BookedRow {
    id: string;
    bundleVersionId: string;
    label: string;
    /** List price in the rhythm this booking is billed in. */
    priceNet: number;
    billingCycle: string | null;
    minimumTermEndsAt: string | null;
    canceledAt: string | null;
    canceledEffectiveAt: string | null;
}

const bookedRows = computed<BookedRow[]>(() =>
    props.booked.map((b) => {
        const cat = catalogByVersion.value.get(b.bundleVersionId);
        return {
            id: b.id,
            bundleVersionId: b.bundleVersionId,
            // Server label takes precedence; catalog join only as fallback; UUID as last resort.
            label: b.label ?? cat?.label ?? b.bundleVersionId,
            // The server resolves the price for the rhythm the booking is in,
            // including the plan's override. The catalogue join is the fallback
            // and has to pick the same rhythm — and for a booking from before
            // the column existed, that rhythm is the plan's.
            priceNet:
                b.priceNet != null
                    ? b.priceNet
                    : (((b.billingCycle ?? props.planCycle) === 'YEARLY'
                          ? cat?.yearlyNet
                          : cat?.monthlyNet) ?? 0),
            billingCycle: b.billingCycle ?? null,
            minimumTermEndsAt: b.minimumTermEndsAt,
            canceledAt: b.canceledAt,
            canceledEffectiveAt: b.canceledEffectiveAt,
        };
    }),
);

const activeBookedVersionIds = computed(
    () => new Set(props.booked.filter((b) => !b.canceledAt).map((b) => b.bundleVersionId)),
);

const planFeatureSet = computed(() => new Set(props.planFeatures));

type BundleState =
    'bookable' | 'booked' | 'incompatible' | 'missing-requires' | 'not-priced-for-cycle';

interface AvailableRow {
    bundle: CatalogBundle;
    state: BundleState;
    /** List price in the selected rhythm; null when none is maintained. */
    priceNet: number | null;
}

/**
 * A bundle's term may not outlast the plan's, so a yearly add-on beside a
 * monthly plan is refused — by `bundleCycleFitsPlan` on the server, and here so
 * the tenant is not offered something that would be rejected.
 */
const cyclesFor = (planCycle: BillingCycleStr): BillingCycleStr[] =>
    planCycle === 'YEARLY' ? ['MONTHLY', 'YEARLY'] : ['MONTHLY'];

const selectedCycle = ref<BillingCycleStr>(props.planCycle);
/**
 * Whether the tenant has said anything about the rhythm.
 *
 * Without it there is no telling "monthly, because the plan was monthly" from
 * "monthly, because I chose it" — and the two want opposite things when the
 * plan turns yearly: the first should follow, the second should stay. The
 * distinction is not derivable from the selection, so it needs its own word.
 */
const cycleChosen = ref(false);

function chooseCycle(cycle: BillingCycleStr): void {
    cycleChosen.value = true;
    selectedCycle.value = cycle;
}

// The plan's rhythm can change under the section (a plan change lands, the
// usage reloads). An untouched control follows it, so "do nothing and get the
// plan's rhythm" keeps holding after an upgrade; a chosen one is left alone
// unless the new plan no longer offers it.
watch(
    () => props.planCycle,
    (cycle) => {
        if (!cycleChosen.value || !cyclesFor(cycle).includes(selectedCycle.value)) {
            selectedCycle.value = cycle;
        }
    },
);

const offersCycleChoice = computed(() => cyclesFor(props.planCycle).length > 1);

const cycleI18n = computed(() => ({
    ariaLabel: i18n.value.bundleCycleLegend,
    monthly: i18n.value.cycleMonthly,
    yearly: i18n.value.cycleYearly,
}));

/**
 * The unit for a rhythm, with the plan's as the fallback.
 *
 * A booking made before the rhythm was recorded took the plan's, because that
 * was the only thing it could take — so on a yearly plan such a row is yearly,
 * and reading it as monthly misstates what the tenant pays.
 */
const unitFor = (cycle: string | null | undefined): string =>
    (cycle ?? props.planCycle) === 'YEARLY'
        ? i18n.value.bundlesPerYear
        : i18n.value.bundlesPerMonth;

/**
 * What the bundle costs in a rhythm, or null when no price is maintained for
 * that combination.
 *
 * Null is not free: `resolveBundlePriceNet` on the server answers the same way
 * and the booking is refused with `BUNDLE_NOT_PRICED_FOR_THIS_PLAN`. Offering
 * the card anyway would put a button in front of a tenant that cannot work.
 */
function priceFor(bundle: CatalogBundle, cycle: BillingCycleStr): number | null {
    return cycle === 'YEARLY' ? bundle.yearlyNet : bundle.monthlyNet;
}

// requires coverage (#35): plan features ∪ features of the actively booked
// bundles. On an active booking `planFeatures` usually already contains the
// bundle features (EntitlementSnapshot); the catalog join is the fallback
// for freshly booked bundles before the usage reload.
const coveredFeatureSet = computed(() => {
    const covered = new Set(props.planFeatures);
    for (const versionId of activeBookedVersionIds.value) {
        for (const f of catalogByVersion.value.get(versionId)?.features ?? []) {
            covered.add(f);
        }
    }
    return covered;
});

function missingRequiresOf(b: CatalogBundle): string[] {
    return missingRequiresFor(b, coveredFeatureSet.value);
}

// #22: All catalog bundles are shown (no longer hidden), but marked:
// already booked (not bookable again), incompatible, or missing requires
// prerequisites (#35 — grayed out instead of bookable).
// Incompatible = intersection of the bundle features with the plan features ≠ ∅
// (the bundle would sell already-included features twice). Quotas don't
// count — they act additively.
function resolveState(b: CatalogBundle, priceNet: number | null): BundleState {
    if (activeBookedVersionIds.value.has(b.bundleVersionId)) return 'booked';
    if (b.features.some((f) => planFeatureSet.value.has(f))) return 'incompatible';
    if (missingRequiresOf(b).length > 0) return 'missing-requires';
    // Last, so a bundle that is already booked or incompatible keeps the
    // reason that actually explains it.
    if (priceNet === null) return 'not-priced-for-cycle';
    return 'bookable';
}

const availableRows = computed<AvailableRow[]>(() =>
    props.available.map((b) => {
        const priceNet = priceFor(b, selectedCycle.value);
        return { bundle: b, state: resolveState(b, priceNet), priceNet };
    }),
);
</script>

<style scoped>
.sp-bundle-store__subtitle {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sp-text-strong, var(--sa-color-fg-body));
    margin: var(--sa-space-2) 0 var(--sa-space-3);
}
.sp-bundle-store__available {
    margin-top: var(--sa-space-5);
}
.sp-bundle-store__cycle {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sa-space-3);
    margin-bottom: var(--sa-space-4);
}
.sp-bundle-store__cycle-legend {
    font-size: var(--sa-text-sm);
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
}
.sp-bundle-store__booked-actions {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sp-bundle-store__empty {
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
    font-size: var(--sa-text-md);
}
.sp-bundle-store__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--sa-space-5);
}
.sp-bundle-store__card {
    padding: var(--sa-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-bundle-store__card--disabled {
    opacity: 0.6;
}
.sp-bundle-store__card-badge {
    align-self: flex-start;
}
.sp-bundle-store__card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sa-space-3);
}
.sp-bundle-store__card-name {
    font-weight: 600;
    font-size: var(--sa-text-lg);
}
.sp-bundle-store__card-price {
    font-weight: 600;
    white-space: nowrap;
}
.sp-bundle-store__card-price small {
    font-weight: 400;
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
}
.sp-bundle-store__card-desc {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sp-text-secondary, var(--sa-color-fg-secondary));
}
.sp-bundle-store__card-feats {
    font-size: var(--sa-text-sm);
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
}
.sp-bundle-store__card-feats-label {
    font-weight: 500;
    margin-bottom: var(--sa-space-1);
}
.sp-bundle-store__card-feats ul {
    list-style: disc;
    padding-left: var(--sa-space-5);
    margin: 0;
}
.sp-bundle-store__card-action {
    margin-top: auto;
}
</style>
