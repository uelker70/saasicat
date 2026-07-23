<template>
    <q-card-section>
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
                            {{ formatCurrency(row.monthlyNet) }} {{ i18n.bundlesPerMonth }}
                        </span>
                        <q-btn
                            v-if="!row.canceledAt"
                            flat
                            dense
                            color="negative"
                            :label="i18n.bundleCancelAction"
                            :loading="cancelingId === row.id"
                            :disable="cancelingId === row.id"
                            @click="emit('cancel', row.id)"
                        />
                        <q-btn
                            v-if="row.canceledAt"
                            flat
                            dense
                            color="primary"
                            :label="i18n.bundleReactivateAction"
                            :loading="reactivatingId === row.id"
                            :disable="reactivatingId === row.id"
                            @click="emit('reactivate', row.id)"
                        />
                    </div>
                </li>
            </ul>
        </div>

        <!-- Available bundles -->
        <div class="sp-bundle-store__available">
            <div class="sp-bundle-store__subtitle">{{ i18n.bundlesAvailableTitle }}</div>
            <div v-if="availableRows.length === 0" class="sp-bundle-store__empty">
                {{ i18n.bundlesAvailableEmpty }}
            </div>
            <div v-else class="sp-bundle-store__grid">
                <q-card
                    v-for="row in availableRows"
                    :key="row.bundle.bundleVersionId"
                    flat
                    bordered
                    class="sp-bundle-store__card"
                    :class="{ 'sp-bundle-store__card--disabled': row.state !== 'bookable' }"
                >
                    <div class="sp-bundle-store__card-head">
                        <span class="sp-bundle-store__card-name">{{ row.bundle.label }}</span>
                        <span class="sp-bundle-store__card-price">
                            {{ formatCurrency(row.bundle.monthlyNet ?? 0) }}
                            <small>{{ i18n.bundlesPerMonth }}</small>
                        </span>
                    </div>

                    <q-badge
                        v-if="row.state === 'booked'"
                        color="positive"
                        :label="i18n.bundleAlreadyBooked"
                        class="sp-bundle-store__card-badge"
                    />
                    <q-badge
                        v-else-if="row.state === 'incompatible'"
                        color="grey-5"
                        text-color="grey-9"
                        :label="i18n.bundleIncompatible"
                        class="sp-bundle-store__card-badge"
                    />
                    <q-badge
                        v-else-if="row.state === 'missing-requires'"
                        color="grey-5"
                        text-color="grey-9"
                        :label="`${i18n.bundleMissingRequires}: ${missingRequiresOf(row.bundle)
                            .map(featureLabel)
                            .join(', ')}`"
                        class="sp-bundle-store__card-badge"
                    />

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
                    <q-btn
                        v-if="row.state === 'bookable'"
                        color="primary"
                        unelevated
                        class="sp-bundle-store__card-action"
                        :label="
                            buyingId === row.bundle.bundleVersionId
                                ? i18n.bundleBookInProgress
                                : i18n.bundleBookAction
                        "
                        :loading="buyingId === row.bundle.bundleVersionId"
                        :disable="buyingId !== null"
                        @click="emit('buy', row.bundle.bundleVersionId)"
                    />
                </q-card>
            </div>
        </div>

        <div v-if="error" class="sp-plan-section__error">{{ error }}</div>
    </q-card-section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { missingRequiresFor } from '@saasicat/types';
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import type { CatalogBundle } from '../../vue/use-tenant-billing-catalog.js';
import type { SubscriptionBundleShape } from '../../vue/use-tenant-billing.js';

// TenantBundleStore — bundle sales on "Paket & Verbrauch" (#15):
// lists booked (cancelable) and available (bookable) catalog bundles.
// Source: `/billing/subscription-bundles` (booked) + `/billing/bundles`
// (catalog). Price/label of booked bundles are joined against the
// catalog via `bundleVersionId`.

const props = defineProps<{
    /** Booked SubscriptionBundles (incl. canceled). */
    booked: SubscriptionBundleShape[];
    /** Full bundle catalog (unfiltered — also used for joining booked bundles). */
    available: CatalogBundle[];
    /** Features of the current plan — for the compatibility check (#22). */
    planFeatures: string[];
    i18n: TenantPlanSectionI18n;
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
    buy: [bundleVersionId: string];
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
    monthlyNet: number;
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
            monthlyNet: b.monthlyNet != null ? Number(b.monthlyNet) : (cat?.monthlyNet ?? 0),
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

type BundleState = 'bookable' | 'booked' | 'incompatible' | 'missing-requires';

interface AvailableRow {
    bundle: CatalogBundle;
    state: BundleState;
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
function resolveState(b: CatalogBundle): BundleState {
    if (activeBookedVersionIds.value.has(b.bundleVersionId)) return 'booked';
    if (b.features.some((f) => planFeatureSet.value.has(f))) return 'incompatible';
    if (missingRequiresOf(b).length > 0) return 'missing-requires';
    return 'bookable';
}

const availableRows = computed<AvailableRow[]>(() =>
    props.available.map((b) => ({ bundle: b, state: resolveState(b) })),
);
</script>

<style scoped>
.sp-bundle-store__subtitle {
    font-size: 13px;
    font-weight: 600;
    color: var(--sp-text-strong, rgba(0, 0, 0, 0.7));
    margin: 4px 0 8px;
}
.sp-bundle-store__available {
    margin-top: 16px;
}
.sp-bundle-store__booked-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sp-bundle-store__empty {
    color: var(--sp-text-muted, rgba(0, 0, 0, 0.55));
    font-size: 13px;
}
.sp-bundle-store__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
}
.sp-bundle-store__card {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    gap: 8px;
}
.sp-bundle-store__card-name {
    font-weight: 600;
    font-size: 15px;
}
.sp-bundle-store__card-price {
    font-weight: 600;
    white-space: nowrap;
}
.sp-bundle-store__card-price small {
    font-weight: 400;
    color: var(--sp-text-muted, rgba(0, 0, 0, 0.55));
}
.sp-bundle-store__card-desc {
    margin: 0;
    font-size: 13px;
    color: var(--sp-text-secondary, rgba(0, 0, 0, 0.6));
}
.sp-bundle-store__card-feats {
    font-size: 12px;
    color: var(--sp-text-muted, rgba(0, 0, 0, 0.55));
}
.sp-bundle-store__card-feats-label {
    font-weight: 500;
    margin-bottom: 2px;
}
.sp-bundle-store__card-feats ul {
    list-style: disc;
    padding-left: 18px;
    margin: 0;
}
.sp-bundle-store__card-action {
    margin-top: auto;
}
</style>
