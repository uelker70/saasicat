<template>
    <div class="sp-plan-section">
        <!-- Spinner ONLY on the initial load (#19): on refresh reloads (e.g. after
             a plan change) the content stays mounted including the PlanChangeWizard,
             otherwise the wizard would be unmounted mid-submit and would not
             close. -->
        <div v-if="loading && !usage" class="sp-plan-section__loading">
            <span class="sp-spinner" aria-hidden="true"></span>
            <span>{{ effectiveI18n.loading }}</span>
        </div>

        <div v-else-if="error" class="sp-plan-section__error">
            {{ error.message }}
        </div>

        <div v-else-if="!usage" class="sp-plan-section__empty">
            {{ effectiveI18n.noSubscription }}
        </div>

        <template v-else>
            <!--
                What taking an offer did, and why it was refused, said here
                rather than in the card: a switch that went through, or an offer
                that is gone, takes the card away with it.
            -->
            <p v-if="versionSwitchNote" class="sp-plan-section__note" role="status">
                {{ versionSwitchNote }}
            </p>
            <p v-if="offerError" class="sp-plan-section__warn" role="alert">{{ offerError }}</p>
            <p v-if="offerReadError" class="sp-plan-section__warn" role="alert">
                {{ offerReadError }}
            </p>

            <!-- The version the tenant is on is being retired, and what follows. -->
            <VersionRetiredCard
                v-if="usage.retirement && !hasEnded"
                :retirement="usage.retirement"
                :plan-name="planNameOf(usage.retirement.replacement.planKey)"
                :switch-terms="usage.retirementSwitch"
                :busy="takingOffer"
                :billing-cycle="usage.billingCycle"
                :next-period-start="usage.currentPeriodEnd"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :quota-label="quotaLabelResolved"
                :feature-label="featureLabelResolved"
                :format-quota-value="quotaValueResolved"
                @switch="onSwitchToReplacement"
            />

            <!-- A newer version of the plan, offered beside it (#357). -->
            <VersionOfferCard
                v-if="versionOffer && !hasEnded"
                :offer="versionOffer"
                :busy="takingOffer"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :quota-label="quotaLabelResolved"
                :feature-label="featureLabelResolved"
                :format-quota-value="quotaValueResolved"
                @take="onTakeVersionOffer"
            />

            <!-- Current plan card + actions -->
            <TenantCard class="sp-plan-section__card">
                <TenantPlanCardHeader
                    :usage="usage"
                    :current-plan-name="currentPlanName"
                    :status-tone="statusTone"
                    :status-label="statusLabel"
                    :cycle-label="cycleLabel"
                    :current-price-eur="currentPriceEur"
                    :current-price-unit="currentPriceUnit"
                    :next-billing-date="nextBillingDate"
                    :format-currency="formatCurrency"
                    :format-date="formatDate"
                    @change-plan="showWizard = true"
                    @cancel-subscription="openCancelConfirm"
                />

                <hr class="sp-divider" />

                <!-- Usage -->
                <TenantUsageGrid
                    :usage="usage"
                    :catalog-quota-keys="catalogQuotaKeys"
                    :quota-label="quotaLabelResolved"
                    :is-fractional-quota="isFractionalQuotaResolved"
                    :usage-bar-formatter="usageBarFormatter"
                />

                <template v-if="showFeatureMatrix && hasFeatureOverview">
                    <hr class="sp-divider" />

                    <!-- Feature scope (#18): all features included + locked -->
                    <TenantFeatureMatrix
                        :feature-registry="featureRegistry"
                        :active-features="activeFeatures"
                        :feature-label="featureLabelResolved"
                    >
                        <template v-if="$slots['feature-icon']" #feature-icon="slotProps">
                            <slot name="feature-icon" v-bind="slotProps" />
                        </template>
                    </TenantFeatureMatrix>
                </template>

                <!-- What the subscriber pays with; shows itself only to whoever may see it. -->
                <TenantPaymentMethodCard
                    v-if="showPaymentMethod"
                    :http="http"
                    :api-prefix="apiPrefix"
                />

                <hr v-if="showBundleStore && hasBundleStore" class="sp-divider" />

                <!-- Bundle store (#15): booked + available bundles -->
                <TenantBundleStore
                    v-if="showBundleStore && hasBundleStore"
                    :booked="bookedBundles"
                    :available="availableBundles"
                    :plan-features="activeFeatures"
                    :plan-cycle="planCycle"
                    :format-currency="formatCurrency"
                    :format-date="formatDate"
                    :feature-label="featureLabelResolved"
                    :quota-label="quotaLabelResolved"
                    :format-quota-value="quotaValueResolved"
                    :buying-id="buyingBundleId"
                    :canceling-id="cancelingBundleId"
                    :reactivating-id="reactivatingBundleId"
                    :switching-id="switchingBundleId"
                    :offering-id="offeringBundleId"
                    :error="bundleError"
                    :note="bundleNote"
                    @buy="onBuyBundle"
                    @cancel="onCancelBundle"
                    @reactivate="onReactivateBundle"
                    @switch="onSwitchBundle"
                    @take-offer="onTakeBundleOffer"
                />
            </TenantCard>

            <!-- Bundle add/cancel preview (#37/#61): proration, redundancy,
                 requires blockers, minimum term — mutation only after confirm. -->
            <BundlePreviewDialog
                v-model="bundlePreviewOpen"
                :preview="bundlePreview"
                :loading="bundlePreviewLoading"
                :error="bundlePreviewError"
                :submitting="bundlePreviewSubmitting"
                :subscription-status="usage.status"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :feature-label="featureLabelResolved"
                @confirm="onConfirmBundlePreview"
            />

            <!-- Reactivate confirmation (analogous to cancellation): deliberate action -->
            <TenantDialog
                :model-value="reactivateConfirmId !== null"
                :title="effectiveI18n.bundleReactivateConfirmTitle"
                size="sm"
                @update:model-value="
                    (open: boolean) => {
                        if (!open) closeReactivateConfirm();
                    }
                "
            >
                {{ effectiveI18n.bundleReactivateConfirmBody }}

                <template #footer>
                    <TenantButton
                        :disabled="reactivatingBundleId !== null"
                        @click="closeReactivateConfirm"
                    >
                        {{ effectiveI18n.bundlePreviewClose }}
                    </TenantButton>
                    <TenantButton
                        variant="solid"
                        tone="accent"
                        :loading="reactivatingBundleId !== null"
                        @click="confirmReactivateBundle"
                    >
                        {{ effectiveI18n.bundleReactivateAction }}
                    </TenantButton>
                </template>
            </TenantDialog>

            <!--
                Cancellation confirmation. The date is stated BEFORE the click,
                not reported after it: with a notice period configured, a
                declaration four days late lands a whole period further out, and
                that is the sentence a customer disputes if they meet it in the
                receipt instead of in the question.
            -->
            <TenantDialog
                :model-value="showCancelConfirm"
                :title="effectiveI18n.cancelConfirmTitle"
                size="sm"
                @update:model-value="
                    (open: boolean) => {
                        if (!open) showCancelConfirm = false;
                    }
                "
            >
                <p v-if="cancelError" class="sp-plan-section__warn">{{ cancelError }}</p>
                <p v-if="cancellationPlan?.afterNoticeDeadline" class="sp-plan-section__warn">
                    {{
                        effectiveI18n.cancelConfirmLate
                            .replace(
                                '{deadline}',
                                formatDate(cancellationPlan.noticeDeadline ?? ''),
                            )
                            .replace('{date}', formatDate(cancellationPlan.effectiveAt))
                    }}
                </p>
                <p v-if="usage.retirement">
                    {{
                        effectiveI18n.cancelConfirmRetirement
                            .replace('{version}', String(usage.retirement.retired.version))
                            .replace(
                                '{date}',
                                formatDate(dayAsInstant(usage.retirement.lastDayToCancel)),
                            )
                    }}
                </p>
                <p v-if="cancellationPlan">
                    {{
                        effectiveI18n.cancelConfirmBody.replace(
                            '{date}',
                            formatDate(cancellationPlan.effectiveAt),
                        )
                    }}
                </p>

                <template #footer>
                    <TenantButton :disabled="canceling" @click="showCancelConfirm = false">
                        {{ effectiveI18n.bundlePreviewClose }}
                    </TenantButton>
                    <TenantButton
                        variant="solid"
                        tone="danger"
                        :loading="canceling"
                        @click="confirmCancelSubscription"
                    >
                        {{
                            cancellationPlan
                                ? effectiveI18n.cancelConfirmAction.replace(
                                      '{date}',
                                      formatDate(cancellationPlan.effectiveAt),
                                  )
                                : effectiveI18n.cancelSubscriptionButton
                        }}
                    </TenantButton>
                </template>
            </TenantDialog>

            <!-- P11.4: Frozen CheckoutOffer snapshot (read-only) — only
                 when the subscription originates from a website offer (#20).
                 Without a snapshot the "not via website offer" empty text
                 was just confusing; the current booking is shown above anyway. -->
            <PackageSnapshotPanel
                v-if="usage.packageSnapshot"
                :snapshot="usage.packageSnapshot"
                :checkout-offer-id="usage.checkoutOfferId"
                :format-date="formatDate"
                :format-currency="formatCurrency"
            />

            <!-- Wizard -->
            <PlanChangeWizard
                v-model="showWizard"
                :plans="bookablePlans"
                :current-plan-id="usage.plan"
                :current-plan-name="currentPlanName"
                :current-cycle="usage.billingCycle"
                :current-status="usage.status"
                :trial-ends-at="usage.trialEndsAt"
                :catalog-quota-keys="catalogQuotaKeys"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :format-quota-label="formatQuotaLabelResolved"
                :format-quota-value="formatQuotaValue"
                :quota-label="quotaLabelResolved"
                :feature-label="featureLabelResolved"
                :is-fractional-quota="isFractionalQuotaResolved"
                :preview-plan-change="previewPlanChange"
                :change-plan="changePlan"
                :i18n="wizardI18n"
                @submitted="onWizardSubmitted"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { provideTenantI18n } from './tenant-i18n.js';
import PackageSnapshotPanel from './PackageSnapshotPanel.vue';
import PlanChangeWizard from './PlanChangeWizard.vue';
import {
    defaultTenantPlanSectionI18n,
    planChangeWizardI18n,
    type TenantPlanSectionI18n,
} from './default-i18n.js';
import BundlePreviewDialog from './tenant-plan-section/BundlePreviewDialog.vue';
import TenantBundleStore from './tenant-plan-section/TenantBundleStore.vue';
import TenantPaymentMethodCard from './TenantPaymentMethodCard.vue';
import TenantFeatureMatrix from './tenant-plan-section/TenantFeatureMatrix.vue';
import TenantPlanCardHeader from './tenant-plan-section/TenantPlanCardHeader.vue';
import TenantUsageGrid from './tenant-plan-section/TenantUsageGrid.vue';
import type { BadgeTone } from './ui/badge-tone.js';
import TenantButton from './ui/TenantButton.vue';
import TenantCard from './ui/TenantCard.vue';
import TenantDialog from './ui/TenantDialog.vue';
import './ui/tenant-ui.css';
import { useSubscriptionHasEnded } from './use-subscription-ended.js';
import { latestAnswerWins } from './latest-answer-wins.js';
import {
    useTenantBilling,
    type BundlePreviewShape,
    type SubscriptionBundleShape,
} from '@saasicat/ui-vue';
import {
    useTenantBillingCatalog,
    type CatalogBundle,
    type CatalogPlan,
    type ResolvedBundlePrice,
} from '@saasicat/ui-vue';
import { useSuperAdminI18n } from '@saasicat/ui-vue';
import type { HttpClient } from '@saasicat/ui-vue';
import type { VersionOfferView } from '@saasicat/core';
import { refusalMessage, refusalOf } from './refusal-of.js';
import VersionOfferCard from './tenant-plan-section/VersionOfferCard.vue';
import VersionRetiredCard from './tenant-plan-section/VersionRetiredCard.vue';
import { dayAsInstant } from './tenant-plan-section/version-retirement-day.js';
import { defaultQuotaValue } from './plan/quota-value.js';

// TenantPlanSection — main component for the tenant plan/bundle self-service
// UI. The consumer (app) embeds it in its settings page and passes through
// HTTP adapter + format hooks + i18n override.

interface Props {
    /** App-specific HTTP adapter (axios with auth header etc.). */
    http?: HttpClient;
    /** API prefix before `/billing/*`. Default `/api/billing`. */
    apiPrefix?: string;

    /** EUR/CHF/USD formatter. */
    formatCurrency: (n: number) => string;
    /** ISO date string → localized date. */
    formatDate: (iso: string | Date) => string;
    /** Freely selectable format for quota cards in the wizard. */
    formatQuotaLabel?: (key: string, value: number) => string;
    /**
     * Plain value per quota key (e.g. "200" or "10 GB") — separate from the
     * label so the wizard's `<PlanGrid>` can render value + label separately.
     * Optional; without an override the wizard default applies
     * (`value.toLocaleString()` in the active UI locale + `GB` for storage
     * keys, ∞ for -1).
     */
    formatQuotaValue?: (key: string, value: number) => string;

    /** Localized label for a QuotaKey (e.g. 'maxUsers' → 'Max. users'). */
    quotaLabel?: (key: string) => string;
    /** Localized label for a FeatureKey. */
    featureLabel?: (key: string) => string;
    /** Default: storage quotas (float), all others integer. */
    isFractionalQuota?: (key: string) => boolean;

    /** i18n overrides — missing keys fall back to the active locale's map. */
    i18n?: Partial<TenantPlanSectionI18n>;

    /**
     * #15 — Show the catalog bundle store (booked + available bundles) on
     * this page. Default `false` (opt-in), so a consumer with its own
     * bundle page does not get a duplicate bundle UI. Existing consumers
     * set `true` (#16 adoption).
     */
    showBundleStore?: boolean;
    /**
     * #18 — Show the full feature-scope matrix (all features included +
     * locked). Default `false` (additive, opt-in per consumer).
     */
    showFeatureMatrix?: boolean;
    /**
     * Show the payment method at the foot of the plan card. Default `true`.
     * An application that mounts `TenantBillingSection` where it keeps billing
     * sets `false`, so the payment method is in one place and not in two.
     */
    showPaymentMethod?: boolean;
}

const props = withDefaults(defineProps<Props>(), { showPaymentMethod: true });

const { locale, intlLocale } = useSuperAdminI18n();

const billing = useTenantBilling({
    http: props.http,
    apiPrefix: props.apiPrefix,
});

const catalog = useTenantBillingCatalog({
    http: props.http,
    apiPrefix: props.apiPrefix,
});

const showWizard = ref(false);

// Bundle store state (#15)
const buyingBundleId = ref<string | null>(null);
const cancelingBundleId = ref<string | null>(null);
const reactivatingBundleId = ref<string | null>(null);
const switchingBundleId = ref<string | null>(null);
const offeringBundleId = ref<string | null>(null);
/** What the last add-on action did, where it says something. */
const bundleNote = ref<string | null>(null);
const reactivateConfirmId = ref<string | null>(null);

const showCancelConfirm = ref(false);
const canceling = ref(false);
const cancelError = ref<string | null>(null);
/** What cancelling right now would do — the server's projection, not ours. */
const cancellationPlan = computed(() => usage.value?.cancellation ?? null);

/**
 * Opens the dialog on a fresh projection.
 *
 * The one on the page came with the last `/usage`, which may be minutes old. A
 * notice deadline that passed in between moves the effective date by a whole
 * period, and the dialog would state the date it was told rather than the one
 * that would happen.
 */
async function openCancelConfirm(): Promise<void> {
    showCancelConfirm.value = true;
    await billing.reload();
}

async function confirmCancelSubscription(): Promise<void> {
    canceling.value = true;
    try {
        // The date the dialog showed travels with the request. If the server's
        // answer has since moved, it refuses rather than applying a date the
        // customer never saw, and the reload below brings the new one in.
        await billing.cancelSubscription(cancellationPlan.value?.effectiveAt);
        showCancelConfirm.value = false;
    } catch (err) {
        cancelError.value = err instanceof Error ? err.message : String(err);
        await billing.reload();
    } finally {
        canceling.value = false;
    }
}
const bundleError = ref<string | null>(null);

// Bundle preview dialog state (#37/#61)
type PendingBundleAction =
    | { kind: 'add'; bundleVersionId: string; billingCycle?: 'MONTHLY' | 'YEARLY' }
    | { kind: 'cancel'; subscriptionBundleId: string };
const bundlePreviewOpen = ref(false);
const bundlePreview = ref<BundlePreviewShape | null>(null);
const bundlePreviewLoading = ref(false);
const bundlePreviewError = ref<string | null>(null);
const bundlePreviewSubmitting = ref(false);
const pendingBundleAction = ref<PendingBundleAction | null>(null);

const usage = computed(() => billing.usage.value);
const loading = computed(() => billing.loading.value || catalog.loading.value);
const error = computed(() => billing.error.value ?? catalog.error.value);

const effectiveI18n = computed<TenantPlanSectionI18n>(() => ({
    ...defaultTenantPlanSectionI18n(locale.value),
    ...(props.i18n ?? {}),
}));

// One provider for the whole section. Six children read the catalog and used to
// receive it as a prop from here; the fourth pass-through of one object is the
// shape AP3's resource ports exist to remove.
provideTenantI18n(effectiveI18n);

const catalogQuotaKeys = computed(() => {
    // Ordered union over all plans + effective limits: higher tiers
    // can carry quotas that the entry plan lacks — those must not
    // disappear in PlanGrid/TenantUsageGrid.
    const keys: string[] = [];
    const push = (key: string) => {
        if (!keys.includes(key)) keys.push(key);
    };
    for (const plan of catalog.plans.value ?? []) {
        Object.keys(plan.quotas).forEach(push);
    }
    if (usage.value) Object.keys(usage.value.limits.quotas).forEach(push);
    return keys;
});

const bookablePlans = computed<CatalogPlan[]>(() => catalog.plans.value ?? []);

// Bundle store (#15): available catalog bundles + booked bundles.
/**
 * Prices resolved for this tenant's plan, by bundle version.
 *
 * The public catalogue has no tenant and therefore no plan, so it serves base
 * prices and reads a bundle priced only through a `BundlePricingOverride` as
 * having no price at all. Empty where the endpoint is absent, in which case the
 * catalogue's own figures stand — which is what every consumer had before.
 */
const resolvedBundlePrices = ref<Record<string, ResolvedBundlePrice>>({});

/**
 * A price is resolved against a plan, so an answer for a plan the tenant has
 * since left is not merely stale — it is about a different question.
 */
const commitBundlePrices = latestAnswerWins(
    async (ids: string[]) => {
        try {
            return { prices: await billing.loadBundlePrices(ids), failed: false };
        } catch (err) {
            // Cleared rather than kept: prices belong to a plan, and holding
            // the previous plan's figures would be wrong in a way nobody can
            // see. Cleared *and* announced, because the cards then show the
            // catalogue's own numbers, which are not necessarily the ones being
            // charged.
            return {
                prices: {},
                failed: true,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    },
    ({ prices, failed, message }) => {
        resolvedBundlePrices.value = prices;
        // Assigned either way: a retry that succeeded leaves the cards holding
        // fresh prices, and an error still on screen above them describes a
        // state that no longer exists.
        bundleError.value = failed ? (message ?? null) : null;
    },
);

const availableBundles = computed<CatalogBundle[]>(() =>
    (catalog.bundles.value ?? []).map((bundle) => {
        const resolved = resolvedBundlePrices.value[bundle.bundleVersionId];
        return resolved ? { ...bundle, ...resolved } : bundle;
    }),
);

// The plan is part of the question, not just the bundles: a price is resolved
// against it, so an in-place plan change that leaves the catalogue untouched
// still invalidates every figure here. Watching only the bundle ids left the
// previous plan's overrides on the cards — a bundle priced only on the new plan
// stayed disabled, and one priced only on the old plan stayed bookable at a
// number nobody would be charged.
watch(
    () =>
        `${usage.value?.plan ?? ''}|${(catalog.bundles.value ?? []).map((b) => b.bundleVersionId).join(',')}`,
    async (key) => {
        const [plan, ids] = key.split('|');
        if (!plan || !ids) {
            resolvedBundlePrices.value = {};
            return;
        }
        await commitBundlePrices(ids.split(','));
    },
    { immediate: true },
);
// A canceled bundle stays active until the end of the already-paid period
// (canceledEffectiveAt lies in the future) and is still shown under
// "Gebuchte Bundles" — the feature is paid for the period. Only once
// the cancellation takes effect (canceledEffectiveAt <= now) is the bundle
// no longer active and disappears from the list.
function isSubscriptionBundleActive(b: SubscriptionBundleShape): boolean {
    if (b.canceledAt === null) return true;
    return b.canceledEffectiveAt !== null && new Date(b.canceledEffectiveAt).getTime() > Date.now();
}

const bookedBundles = computed<SubscriptionBundleShape[]>(() =>
    billing.subscriptionBundles.value.filter(isSubscriptionBundleActive),
);
const hasBundleStore = computed(
    () => availableBundles.value.length > 0 || bookedBundles.value.length > 0,
);

// Feature-scope matrix (#18): all features with registry translation.
const featureRegistry = computed(() => catalog.featureRegistry.value);
/**
 * The rhythm the plan is billed in, as the bundle store's control needs it.
 *
 * Narrowed here rather than in the template: a union in a template type
 * assertion parses as a Vue filter, which `vue/no-deprecated-filter` rejects.
 * `MONTHLY` before the subscription has loaded is the safe reading — it offers
 * no choice rather than one the plan may not permit.
 */
const planCycle = computed<'MONTHLY' | 'YEARLY'>(() =>
    usage.value?.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
);

const activeFeatures = computed<string[]>(() => usage.value?.limits.features ?? []);
const hasFeatureOverview = computed(
    () => Object.keys(featureRegistry.value ?? {}).length > 0 || activeFeatures.value.length > 0,
);

/** A plan's display name from the catalogue, its key where the catalogue does not list it. */
function planNameOf(planKey: string): string {
    return catalog.plans.value?.find((p) => p.id === planKey)?.name ?? planKey;
}

const currentPlanName = computed(() => (usage.value ? planNameOf(usage.value.plan) : ''));

// The amount due per billing cycle, as the server reads it off the version the
// subscription is bound to. Not the catalogue's: that is the price a new
// customer pays, and after a new version it is not this subscriber's.
const currentPriceEur = computed(() => usage.value?.planPriceNet ?? null);

const currentPriceUnit = computed(() =>
    usage.value?.billingCycle === 'YEARLY'
        ? effectiveI18n.value.wizardPriceUnitYearly
        : effectiveI18n.value.wizardPriceUnitMonthly,
);

// Next billing date = end of the current period ONLY for an actively
// renewing subscription (status ACTIVE). For PAST_DUE the period has
// already expired (no future billing date); for TRIAL (trial end is shown
// separately), CANCELED and PENDING_SALES there is no regular renewal →
// hide it, instead of wrongly presenting the period end as the next
// billing date.
/** Shared by the badge, its tone and the billing date — one timer, one answer. */
const hasEnded = useSubscriptionHasEnded(() => usage.value);

const nextBillingDate = computed(() => {
    const u = usage.value;
    if (!u || !u.currentPeriodEnd) return null;
    if (u.status !== 'ACTIVE') return null;
    // A subscription that has ended is not billed again, and its period end is
    // in the past. The status column does not say so — nothing transitions it
    // when a cancellation lands — so the date does.
    if (hasEnded.value) return null;
    return u.currentPeriodEnd;
});

const cycleLabel = computed(() => {
    if (!usage.value) return '';
    return usage.value.billingCycle === 'YEARLY'
        ? effectiveI18n.value.cycleYearly
        : effectiveI18n.value.cycleMonthly;
});

const statusLabel = computed(() => {
    if (!usage.value) return '';
    if (hasEnded.value) return effectiveI18n.value.statusCanceled;
    switch (usage.value.status) {
        case 'TRIAL':
            return effectiveI18n.value.statusTrial;
        case 'PAST_DUE':
            return effectiveI18n.value.statusPastDue;
        case 'CANCELED':
            return effectiveI18n.value.statusCanceled;
        case 'PENDING_SALES':
            return effectiveI18n.value.statusPendingSales;
        default:
            return effectiveI18n.value.statusActive;
    }
});

// A badge tone, not a Quasar colour name. Two of the old five had no tone at
// all — `grey` and `amber` — and the two ambers meant different things: an
// overdue payment is the tenant's problem to solve, a contract sitting with
// sales is not. They keep separate tones for that reason, and the label says
// which is which regardless (rule 7: never colour alone).
const statusTone = computed<BadgeTone>(() => {
    if (!usage.value) return 'neutral';
    if (hasEnded.value) return 'negative';
    switch (usage.value.status) {
        case 'TRIAL':
            return 'info';
        case 'PAST_DUE':
            return 'warning';
        case 'CANCELED':
            return 'negative';
        case 'PENDING_SALES':
            return 'neutral';
        default:
            return 'positive';
    }
});

const wizardI18n = computed(() => planChangeWizardI18n(effectiveI18n.value));

// Helper hooks with defaults
function quotaLabelResolved(key: string): string {
    return props.quotaLabel?.(key) ?? key;
}

function featureLabelFromProps(key: string): string {
    return props.featureLabel?.(key) ?? key;
}

function isFractionalQuotaResolved(key: string): boolean {
    return props.isFractionalQuota?.(key) ?? key.toLowerCase().includes('storage');
}

function quotaValueResolved(key: string, value: number): string {
    return props.formatQuotaValue?.(key, value) ?? defaultQuotaValue(key, value, intlLocale.value);
}

function formatQuotaLabelResolved(key: string, value: number): string {
    if (props.formatQuotaLabel) return props.formatQuotaLabel(key, value);
    if (value === -1) return `${quotaLabelResolved(key)}: ∞`;
    return `${value} ${quotaLabelResolved(key)}`;
}

function usageBarFormatter(key: string): ((value: number) => string) | undefined {
    if (!props.formatQuotaValue) return undefined;
    const fn = props.formatQuotaValue;
    return (value) => fn(key, value);
}

// Bundle store actions (#15/#37): preview dialog first, mutation after confirm.
async function onBuyBundle(bundleVersionId: string, billingCycle?: 'MONTHLY' | 'YEARLY') {
    // The same rhythm reaches the preview and the confirmation, which is the
    // whole point of holding it on the pending action rather than passing it
    // twice: a preview that quotes one contract while the booking writes
    // another is the one thing a preview may never do.
    pendingBundleAction.value = { kind: 'add', bundleVersionId, billingCycle };
    await openBundlePreview(() => billing.previewAddBundle(bundleVersionId, { billingCycle }));
}

async function onCancelBundle(subscriptionBundleId: string) {
    pendingBundleAction.value = { kind: 'cancel', subscriptionBundleId };
    await openBundlePreview(() => billing.previewCancelBundle(subscriptionBundleId));
}

// Reactivate = "undo cancellation" (un-cancel). No money flow/proration,
// but a deliberate action → confirmation (analogous to cancellation) before
// the mutation.
function onReactivateBundle(subscriptionBundleId: string) {
    bundleError.value = null;
    bundleNote.value = null;
    reactivateConfirmId.value = subscriptionBundleId;
}

function closeReactivateConfirm() {
    if (reactivatingBundleId.value) return; // do not close while the mutation is running
    reactivateConfirmId.value = null;
}

async function confirmReactivateBundle() {
    const subscriptionBundleId = reactivateConfirmId.value;
    if (!subscriptionBundleId) return;
    reactivatingBundleId.value = subscriptionBundleId;
    bundleError.value = null;
    try {
        await billing.reactivateBundle(subscriptionBundleId);
        // Re-freeze server-side → reload features/quotas, not just the list.
        await billing.reload();
    } catch (err) {
        bundleError.value = refusalText(err);
    } finally {
        reactivatingBundleId.value = null;
        reactivateConfirmId.value = null;
    }
}

// The early switch to the replacement an add-on retirement names. The notice
// confirmed it with the tenant; this writes it, and says what happened.
async function onSwitchBundle(subscriptionBundleId: string, bundleVersionId: string) {
    const booking = bookedBundles.value.find((b) => b.id === subscriptionBundleId);
    const label = booking?.label ?? booking?.bundleVersionId ?? '';
    const version = String(booking?.retirement?.replacement.version ?? '');
    switchingBundleId.value = subscriptionBundleId;
    bundleError.value = null;
    bundleNote.value = null;
    try {
        await billing.switchBundleToReplacement(subscriptionBundleId, bundleVersionId);
        bundleNote.value = effectiveI18n.value.bundleRetiredSwitched
            .replace('{bundle}', label)
            .replace('{version}', version);
    } catch (err) {
        bundleError.value = refusalText(err);
        // The retirement as it now stands is read with the reload, so the
        // notice shows that rather than the one the switch was refused against.
        await billing.reload();
    } finally {
        switchingBundleId.value = null;
    }
}

// A newer version offered beside a booking, taken. The card confirmed what
// asks to be confirmed; this writes it, and says what happened — or, refused,
// why, with the offer as it now stands read with the reload.
async function onTakeBundleOffer(subscriptionBundleId: string, bundleVersionId: string) {
    const booking = bookedBundles.value.find((b) => b.id === subscriptionBundleId);
    const label = booking?.label ?? booking?.bundleVersionId ?? '';
    const version = String(booking?.offer?.offered.version ?? '');
    offeringBundleId.value = subscriptionBundleId;
    bundleError.value = null;
    bundleNote.value = null;
    try {
        const result = await billing.acceptBundleVersionOffer(
            subscriptionBundleId,
            bundleVersionId,
        );
        const words = effectiveI18n.value;
        const said = result.immediate
            ? words.bundleRetiredSwitched
            : words.bundleOfferSwitchScheduled.replace(
                  '{date}',
                  props.formatDate(result.takesEffectAt),
              );
        bundleNote.value = said.replace('{bundle}', label).replace('{version}', version);
    } catch (err) {
        bundleError.value = refusalText(err);
        await billing.reload();
    } finally {
        offeringBundleId.value = null;
    }
}

async function openBundlePreview(load: () => Promise<BundlePreviewShape>) {
    bundleError.value = null;
    bundleNote.value = null;
    bundlePreview.value = null;
    bundlePreviewError.value = null;
    bundlePreviewOpen.value = true;
    bundlePreviewLoading.value = true;
    try {
        bundlePreview.value = await load();
    } catch (err) {
        bundlePreviewError.value = err instanceof Error ? err.message : String(err);
    } finally {
        bundlePreviewLoading.value = false;
    }
}

async function onConfirmBundlePreview() {
    const action = pendingBundleAction.value;
    if (!action) return;
    bundlePreviewSubmitting.value = true;
    bundlePreviewError.value = null;
    if (action.kind === 'add') buyingBundleId.value = action.bundleVersionId;
    else cancelingBundleId.value = action.subscriptionBundleId;
    try {
        if (action.kind === 'add') {
            await billing.addBundle(action.bundleVersionId, {
                billingCycle: action.billingCycle,
            });
        } else {
            await billing.cancelBundle(action.subscriptionBundleId);
        }
        bundlePreviewOpen.value = false;
        pendingBundleAction.value = null;
        // Reload usage — after add/cancel the features/quotas change
        // (re-freeze server-side), not just the bundle list.
        await billing.reload();
    } catch (err) {
        bundlePreviewError.value = err instanceof Error ? err.message : String(err);
    } finally {
        bundlePreviewSubmitting.value = false;
        buyingBundleId.value = null;
        cancelingBundleId.value = null;
    }
}

// Feature label with registry translation (#18): the registry label takes
// precedence, then the consumer hook, and finally the raw key.
function featureLabelResolved(key: string): string {
    return catalog.featureRegistry.value?.[key]?.label ?? featureLabelFromProps(key);
}

// ── The version offer (#357) ─────────────────────────────────────────────

const versionOffer = ref<VersionOfferView | null>(null);
const takingOffer = ref(false);
/** Why taking the offer was refused. Stays until the next attempt. */
const offerError = ref<string | null>(null);
/**
 * Why the offer could not be read. Kept apart from a refused switch: a refusal
 * reloads the page, the reload reads the offer again, and a read that
 * succeeds must not clear the sentence saying why the click did nothing.
 */
const offerReadError = ref<string | null>(null);
const versionSwitchNote = ref<string | null>(null);

/** A refusal in the reader's language, from its code; the thrown text only where there is none. */
function refusalText(err: unknown): string {
    return refusalMessage(err, effectiveI18n.value.issueMessages);
}

/**
 * An offer is read against the subscription as it stands, so an answer for a
 * state the page has since left is about a different question.
 */
const commitVersionOffer = latestAnswerWins(
    async () => {
        try {
            return { offer: await billing.loadVersionOffer(), failure: null };
        } catch (err) {
            return { offer: null, failure: refusalText(err) };
        }
    },
    ({ offer, failure }) => {
        versionOffer.value = offer;
        offerReadError.value = failure;
    },
);

// Read again whenever what the offer is judged against moves: the plan, the
// version bound, the rhythm, or a change scheduled or taken back.
watch(
    () =>
        usage.value
            ? [
                  usage.value.plan,
                  usage.value.planVersion?.id ?? '',
                  usage.value.billingCycle,
                  usage.value.pendingPlan ?? '',
                  usage.value.canceledAt ?? '',
              ].join('|')
            : '',
    async (key) => {
        if (!key) {
            versionOffer.value = null;
            return;
        }
        await commitVersionOffer();
    },
    { immediate: true },
);

async function onTakeVersionOffer(planVersionId: string): Promise<void> {
    const taken = versionOffer.value;
    if (!taken) return;
    takingOffer.value = true;
    offerError.value = null;
    versionSwitchNote.value = null;
    try {
        const result = await billing.acceptVersionOffer(planVersionId);
        const version = String(taken.offered.version);
        versionSwitchNote.value = result.immediate
            ? effectiveI18n.value.versionOfferSwitchedNow.replace('{version}', version)
            : effectiveI18n.value.versionOfferSwitchScheduled
                  .replace('{version}', version)
                  .replace('{date}', props.formatDate(result.takesEffectAt));
    } catch (err) {
        // The offer as it now stands travels with this refusal, so the card
        // shows it at once rather than the one that was refused.
        const body = refusalOf(err);
        if (body?.code === 'VERSION_OFFER_CHANGED') {
            versionOffer.value = (body.offer as VersionOfferView | null | undefined) ?? null;
        }
        offerError.value = refusalText(err);
        // A refusal usually means the subscription moved under the page, and
        // an offer beside a plan card that still shows the old state would be
        // decided on a screen that never existed. Reloaded like a success is,
        // and the offer is then read against what came back.
        await billing.reload();
    } finally {
        takingOffer.value = false;
    }
}

async function onSwitchToReplacement(planVersionId: string): Promise<void> {
    const version = String(usage.value?.retirement?.replacement.version ?? '');
    takingOffer.value = true;
    offerError.value = null;
    versionSwitchNote.value = null;
    try {
        await billing.switchToReplacement(planVersionId);
        versionSwitchNote.value = effectiveI18n.value.versionRetiredSwitched.replace(
            '{version}',
            version,
        );
    } catch (err) {
        offerError.value = refusalText(err);
        // The retirement as it now stands is read with the reload, so the card
        // shows that rather than the one the switch was refused against.
        await billing.reload();
    } finally {
        takingOffer.value = false;
    }
}

function onWizardSubmitted() {
    // After a successful plan change the composable's `reload()` is enough —
    // the wizard closes itself (internal reset logic).
}

async function previewPlanChange(plan: string, cycle: 'MONTHLY' | 'YEARLY') {
    return billing.previewPlanChange(plan, cycle);
}
async function changePlan(plan: string, cycle: 'MONTHLY' | 'YEARLY', planVersionId: string | null) {
    return billing.changePlan(plan, cycle, planVersionId);
}
</script>

<style>
.sp-plan-section {
    --sp-text-secondary: var(--sa-color-fg-secondary);
    --sp-text-muted: var(--sa-color-fg-muted);
    --sp-text-disabled: var(--sa-color-fg-subtle);
    --sp-text-strong: var(--sa-color-fg-body);
    --sp-border: var(--sa-color-border);
    --sp-summary-bg: var(--sa-color-info-surface);

    display: flex;
    flex-direction: column;
    gap: var(--sa-space-5);
}
.sp-plan-section__loading,
.sp-plan-section__empty {
    display: flex;
    gap: var(--sa-space-4);
    align-items: center;
    padding: var(--sa-space-7);
    color: var(--sp-text-secondary);
}
.sp-plan-section__error {
    color: var(--sa-color-negative);
    background: var(--sa-color-negative-surface);
    padding: var(--sa-space-4) var(--sa-space-5);
    border-radius: var(--sa-radius-badge);
}
.sp-plan-section__card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--sa-space-5);
    flex-wrap: wrap;
}
.sp-plan-section__eyebrow {
    font-size: var(--sa-text-sm);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sp-text-muted);
    margin-bottom: var(--sa-space-2);
}
.sp-plan-section__plan-name {
    margin: 0 0 var(--sa-space-3);
    font-size: var(--sa-text-2xl);
    font-weight: 600;
}
.sp-plan-section__meta {
    display: flex;
    gap: var(--sa-space-4);
    align-items: center;
    flex-wrap: wrap;
}
.sp-plan-section__cycle {
    color: var(--sp-text-secondary);
}
.sp-plan-section__price {
    font-weight: 600;
}
.sp-plan-section__sub {
    margin: var(--sa-space-2) 0 0;
    color: var(--sp-text-muted);
    font-size: var(--sa-text-md);
}
.sp-plan-section__usage-title {
    font-weight: 600;
    margin-bottom: var(--sa-space-4);
}
.sp-plan-section__usage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--sa-space-5);
}
.sp-plan-section__item-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-plan-section__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid var(--sp-border);
    padding: var(--sa-space-3) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
}
.sp-plan-section__item-label {
    font-weight: 500;
    margin-right: var(--sa-space-4);
}
.sp-plan-section__item-price {
    color: var(--sp-text-secondary);
    font-size: var(--sa-text-md);
}
/* The cancellation strip and the late-notice warning.
   Muted rather than alarming: the subscription is running normally, and the
   only news is a date. The warning above it is the exception — a whole period
   further out is worth a second look. */
.sp-plan-section__canceled {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-secondary);
    font-size: var(--sa-text-sm);
}
.sp-plan-section__note {
    margin: 0;
    padding: var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive);
    font-size: var(--sa-text-sm);
}
.sp-plan-section__warn {
    margin: 0 0 var(--sa-space-3);
    padding: var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    font-size: var(--sa-text-sm);
}
.sp-plan-section__item-canceled {
    color: var(--sp-text-disabled);
    font-size: var(--sa-text-md);
}
</style>
