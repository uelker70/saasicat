<template>
    <div class="sp-plan-section">
        <!-- Spinner ONLY on the initial load (#19): on refresh reloads (e.g. after
             a plan change) the content stays mounted including the PlanChangeWizard,
             otherwise the wizard would be unmounted mid-submit and would not
             close. -->
        <div v-if="loading && !usage" class="sp-plan-section__loading">
            <q-spinner size="32px" />
            <span>{{ effectiveI18n.loading }}</span>
        </div>

        <div v-else-if="error" class="sp-plan-section__error">
            {{ error.message }}
        </div>

        <div v-else-if="!usage" class="sp-plan-section__empty">
            {{ effectiveI18n.noSubscription }}
        </div>

        <template v-else>
            <!-- Pending plan version banner -->
            <PendingVersionBanner
                v-if="usage.pendingPlanVersion"
                :pending="usage.pendingPlanVersion"
                :effective-at="usage.pendingPlanVersionEffectiveAt"
                :accepted="usage.pendingPlanVersionAccepted"
                :accepted-at="usage.pendingPlanVersionAcceptedAt"
                :busy="acceptingPending"
                :format-date="formatDate"
                :i18n="{
                    title: effectiveI18n.pendingVersionTitle,
                    chipNonRegressive: effectiveI18n.pendingVersionChipNonRegressive,
                    chipRegressive: effectiveI18n.pendingVersionChipRegressive,
                    effectiveAt: effectiveI18n.pendingVersionEffectiveAt,
                    acceptAction: effectiveI18n.pendingVersionAcceptAction,
                    acceptInProgress: effectiveI18n.pendingVersionAcceptInProgress,
                    acceptedAt: effectiveI18n.pendingVersionAcceptedAt,
                }"
                class="q-mb-md"
                @accept="onAcceptPending"
            />

            <!-- Current plan card + actions -->
            <q-card flat bordered class="sp-plan-section__card">
                <TenantPlanCardHeader
                    :usage="usage"
                    :i18n="effectiveI18n"
                    :current-plan-name="currentPlanName"
                    :status-color="statusColor"
                    :status-label="statusLabel"
                    :cycle-label="cycleLabel"
                    :current-price-eur="currentPriceEur"
                    :current-price-unit="currentPriceUnit"
                    :next-billing-date="nextBillingDate"
                    :format-currency="formatCurrency"
                    :format-date="formatDate"
                    @change-plan="showWizard = true"
                />

                <q-separator />

                <!-- Usage -->
                <TenantUsageGrid
                    :usage="usage"
                    :i18n="effectiveI18n"
                    :catalog-quota-keys="catalogQuotaKeys"
                    :quota-label="quotaLabel"
                    :is-fractional-quota="isFractionalQuota"
                    :usage-bar-formatter="usageBarFormatter"
                />

                <template v-if="showFeatureMatrix && hasFeatureOverview">
                    <q-separator />

                    <!-- Feature scope (#18): all features included + locked -->
                    <TenantFeatureMatrix
                        :feature-registry="featureRegistry"
                        :active-features="activeFeatures"
                        :feature-label="featureLabelResolved"
                        :i18n="effectiveI18n"
                    />
                </template>

                <q-separator v-if="showBundleStore && hasBundleStore" />

                <!-- Bundle store (#15): booked + available bundles -->
                <TenantBundleStore
                    v-if="showBundleStore && hasBundleStore"
                    :booked="bookedBundles"
                    :available="availableBundles"
                    :plan-features="activeFeatures"
                    :i18n="effectiveI18n"
                    :format-currency="formatCurrency"
                    :format-date="formatDate"
                    :feature-label="featureLabelResolved"
                    :buying-id="buyingBundleId"
                    :canceling-id="cancelingBundleId"
                    :reactivating-id="reactivatingBundleId"
                    :error="bundleError"
                    @buy="onBuyBundle"
                    @cancel="onCancelBundle"
                    @reactivate="onReactivateBundle"
                />
            </q-card>

            <!-- Bundle add/cancel preview (#37/#61): proration, redundancy,
                 requires blockers, minimum term — mutation only after confirm. -->
            <BundlePreviewDialog
                v-model="bundlePreviewOpen"
                :preview="bundlePreview"
                :loading="bundlePreviewLoading"
                :error="bundlePreviewError"
                :submitting="bundlePreviewSubmitting"
                :subscription-status="usage.status"
                :i18n="effectiveI18n"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :feature-label="featureLabelResolved"
                @confirm="onConfirmBundlePreview"
            />

            <!-- Reactivate confirmation (analogous to cancellation): deliberate action -->
            <q-dialog
                :model-value="reactivateConfirmId !== null"
                @update:model-value="(v) => { if (!v) closeReactivateConfirm(); }"
            >
                <q-card style="min-width: 360px; max-width: 480px">
                    <q-card-section>
                        <div class="text-h6">{{ effectiveI18n.bundleReactivateConfirmTitle }}</div>
                    </q-card-section>
                    <q-card-section class="q-pt-none">
                        {{ effectiveI18n.bundleReactivateConfirmBody }}
                    </q-card-section>
                    <q-card-actions align="right">
                        <q-btn
                            flat
                            :label="effectiveI18n.bundlePreviewClose"
                            :disable="reactivatingBundleId !== null"
                            @click="closeReactivateConfirm"
                        />
                        <q-btn
                            color="primary"
                            unelevated
                            :label="effectiveI18n.bundleReactivateAction"
                            :loading="reactivatingBundleId !== null"
                            :disable="reactivatingBundleId !== null"
                            @click="confirmReactivateBundle"
                        />
                    </q-card-actions>
                </q-card>
            </q-dialog>

            <!-- P11.4: Frozen CheckoutOffer snapshot (read-only) — only
                 when the subscription originates from a website offer (#20).
                 Without a snapshot the "not via website offer" empty text
                 was just confusing; the current booking is shown above anyway. -->
            <PackageSnapshotPanel
                v-if="usage.packageSnapshot"
                :snapshot="usage.packageSnapshot"
                :checkout-offer-id="usage.checkoutOfferId"
                :i18n="effectiveI18n"
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
                :format-quota-label="formatQuotaLabel"
                :format-quota-value="formatQuotaValue"
                :quota-label="quotaLabel"
                :feature-label="featureLabelResolved"
                :is-fractional-quota="isFractionalQuota"
                :preview-plan-change="previewPlanChange"
                :change-plan="changePlan"
                :i18n="wizardI18n"
                @submitted="onWizardSubmitted"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import PackageSnapshotPanel from './PackageSnapshotPanel.vue';
import PendingVersionBanner from './PendingVersionBanner.vue';
import PlanChangeWizard from './PlanChangeWizard.vue';
import { DEFAULT_I18N_DE, type TenantPlanSectionI18n } from './default-i18n.js';
import BundlePreviewDialog from './tenant-plan-section/BundlePreviewDialog.vue';
import TenantBundleStore from './tenant-plan-section/TenantBundleStore.vue';
import TenantFeatureMatrix from './tenant-plan-section/TenantFeatureMatrix.vue';
import TenantPlanCardHeader from './tenant-plan-section/TenantPlanCardHeader.vue';
import TenantUsageGrid from './tenant-plan-section/TenantUsageGrid.vue';
import {
    useTenantBilling,
    type BundlePreviewShape,
    type SubscriptionBundleShape,
} from '../vue/use-tenant-billing.js';
import {
    useTenantBillingCatalog,
    type CatalogBundle,
    type CatalogPlan,
} from '../vue/use-tenant-billing-catalog.js';
import type { HttpClient } from '../client/types.js';

// TenantPlanSection — main component for the tenant plan/bundle self-service
// UI. The consumer (app) embeds it in its settings page and passes through
// HTTP adapter + format hooks + i18n override.

interface Props {
    /** App-specific HTTP adapter (axios with auth header etc.). */
    http?: HttpClient;
    /** App auth-token getter, in case the adapter does not inject it itself. */
    getAuthToken?: () => string | null;
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
     * (`value.toLocaleString('de-DE')` + `GB` for storage keys, ∞ for -1).
     */
    formatQuotaValue?: (key: string, value: number) => string;

    /** Localized label for a QuotaKey (e.g. 'users' → 'Benutzer'). */
    quotaLabel?: (key: string) => string;
    /** Localized label for a FeatureKey. */
    featureLabel?: (key: string) => string;
    /** Default: storage quotas (float), all others integer. */
    isFractionalQuota?: (key: string) => boolean;

    /** i18n overrides — missing keys fall back to DEFAULT_I18N_DE. */
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
}

const props = defineProps<Props>();

const billing = useTenantBilling({
    http: props.http,
    getAuthToken: props.getAuthToken,
    apiPrefix: props.apiPrefix,
});

const catalog = useTenantBillingCatalog({
    http: props.http,
    apiPrefix: props.apiPrefix,
});

const showWizard = ref(false);
const acceptingPending = ref(false);

// Bundle store state (#15)
const buyingBundleId = ref<string | null>(null);
const cancelingBundleId = ref<string | null>(null);
const reactivatingBundleId = ref<string | null>(null);
const reactivateConfirmId = ref<string | null>(null);
const bundleError = ref<string | null>(null);

// Bundle preview dialog state (#37/#61)
type PendingBundleAction =
    | { kind: 'add'; bundleVersionId: string }
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
    ...DEFAULT_I18N_DE,
    ...(props.i18n ?? {}),
}));

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
const availableBundles = computed<CatalogBundle[]>(() => catalog.bundles.value ?? []);
// A canceled bundle stays active until the end of the already-paid period
// (canceledEffectiveAt lies in the future) and is still shown under
// "Gebuchte Bundles" — the feature is paid for the period. Only once
// the cancellation takes effect (canceledEffectiveAt <= now) is the bundle
// no longer active and disappears from the list.
function isSubscriptionBundleActive(b: SubscriptionBundleShape): boolean {
    if (b.canceledAt === null) return true;
    return (
        b.canceledEffectiveAt !== null &&
        new Date(b.canceledEffectiveAt).getTime() > Date.now()
    );
}

const bookedBundles = computed<SubscriptionBundleShape[]>(() =>
    billing.subscriptionBundles.value.filter(isSubscriptionBundleActive),
);
const hasBundleStore = computed(
    () => availableBundles.value.length > 0 || bookedBundles.value.length > 0,
);

// Feature-scope matrix (#18): all features with registry translation.
const featureRegistry = computed(() => catalog.featureRegistry.value);
const activeFeatures = computed<string[]>(() => usage.value?.limits.features ?? []);
const hasFeatureOverview = computed(
    () =>
        Object.keys(featureRegistry.value ?? {}).length > 0 || activeFeatures.value.length > 0,
);

const currentPlanName = computed(() => {
    if (!usage.value) return '';
    const plan = catalog.plans.value?.find((p) => p.id === usage.value!.plan);
    return plan?.name ?? usage.value.plan;
});

// Amount actually due per billing cycle: yearly price for YEARLY, monthly
// price for MONTHLY — NO /12 conversion (otherwise a yearly contract would
// show a monthly amount in the card).
const currentPriceEur = computed(() => {
    if (!usage.value) return null;
    const plan = catalog.plans.value?.find((p) => p.id === usage.value!.plan);
    if (!plan) return null;
    return usage.value.billingCycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet;
});

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
const nextBillingDate = computed(() => {
    const u = usage.value;
    if (!u || !u.currentPeriodEnd) return null;
    if (u.status !== 'ACTIVE') return null;
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

const statusColor = computed(() => {
    if (!usage.value) return 'grey';
    switch (usage.value.status) {
        case 'TRIAL':
            return 'info';
        case 'PAST_DUE':
            return 'warning';
        case 'CANCELED':
            return 'negative';
        case 'PENDING_SALES':
            return 'amber';
        default:
            return 'positive';
    }
});

const wizardI18n = computed(() => ({
    title: effectiveI18n.value.wizardTitle,
    close: effectiveI18n.value.wizardClose,
    currentLabel: effectiveI18n.value.wizardCurrent,
    cycleMonthly: effectiveI18n.value.cycleMonthly,
    cycleYearly: effectiveI18n.value.cycleYearly,
    badgeCurrent: effectiveI18n.value.wizardBadgeCurrent,
    badgePopular: effectiveI18n.value.wizardBadgePopular,
    priceUnitMonthly: effectiveI18n.value.wizardPriceUnitMonthly,
    priceOnRequest: effectiveI18n.value.wizardPriceOnRequest,
    stepChoose: effectiveI18n.value.wizardStepChoose,
    stepChooseIntro: effectiveI18n.value.wizardStepChooseIntro,
    stepPreview: effectiveI18n.value.wizardStepPreview,
    stepConfirm: effectiveI18n.value.wizardStepConfirm,
    next: effectiveI18n.value.wizardNext,
    back: effectiveI18n.value.wizardBack,
    previewLoading: effectiveI18n.value.wizardPreviewLoading,
    effectiveAtLabel: effectiveI18n.value.wizardEffectiveAtLabel,
    effectiveImmediate: effectiveI18n.value.wizardEffectiveImmediate,
    prorationTitle: effectiveI18n.value.wizardProrationTitle,
    prorationLine: effectiveI18n.value.wizardProrationLine,
    prorationDays: effectiveI18n.value.wizardProrationDays,
    limitsTitle: effectiveI18n.value.wizardLimitsTitle,
    limitsUsed: effectiveI18n.value.wizardLimitsUsed,
    limitsCurrent: effectiveI18n.value.wizardLimitsCurrent,
    limitsTarget: effectiveI18n.value.wizardLimitsTarget,
    featuresGained: effectiveI18n.value.wizardFeaturesGained,
    featuresLost: effectiveI18n.value.wizardFeaturesLost,
    blockersTitle: effectiveI18n.value.wizardBlockersTitle,
    confirmImmediate: effectiveI18n.value.wizardConfirmImmediate,
    confirmScheduled: effectiveI18n.value.wizardConfirmScheduled,
    confirmAction: effectiveI18n.value.wizardConfirmAction,
    confirmInProgress: effectiveI18n.value.wizardConfirmInProgress,
    confirmPriceTitle: effectiveI18n.value.wizardConfirmPriceTitle,
    confirmProratedNow: effectiveI18n.value.wizardConfirmProratedNow,
    confirmRecurringNext: effectiveI18n.value.wizardConfirmRecurringNext,
    confirmRecurringFrom: effectiveI18n.value.wizardConfirmRecurringFrom,
    perCycleMonthly: effectiveI18n.value.wizardConfirmPerCycleMonthly,
    perCycleYearly: effectiveI18n.value.wizardConfirmPerCycleYearly,
    confirmTrialNote: effectiveI18n.value.wizardConfirmTrialNote,
    confirmRecurringTrialEnd: effectiveI18n.value.wizardConfirmRecurringTrialEnd,
    changeTypeUpgrade: effectiveI18n.value.wizardChangeTypeUpgrade,
    changeTypeDowngrade: effectiveI18n.value.wizardChangeTypeDowngrade,
    changeTypeCycle: effectiveI18n.value.wizardChangeTypeCycle,
    changeTypeNoop: effectiveI18n.value.wizardChangeTypeNoop,
}));

// Helper hooks with defaults
function quotaLabel(key: string): string {
    return props.quotaLabel?.(key) ?? key;
}

function featureLabel(key: string): string {
    return props.featureLabel?.(key) ?? key;
}

function isFractionalQuota(key: string): boolean {
    return props.isFractionalQuota?.(key) ?? key.toLowerCase().includes('storage');
}

function formatDate(input: string | Date): string {
    return props.formatDate(input);
}

function formatCurrency(n: number): string {
    return props.formatCurrency(n);
}

function formatQuotaLabel(key: string, value: number): string {
    if (props.formatQuotaLabel) return props.formatQuotaLabel(key, value);
    if (value === -1) return `${quotaLabel(key)}: ∞`;
    return `${value} ${quotaLabel(key)}`;
}

function usageBarFormatter(key: string): ((value: number) => string) | undefined {
    if (!props.formatQuotaValue) return undefined;
    const fn = props.formatQuotaValue;
    return (value) => fn(key, value);
}

// Bundle store actions (#15/#37): preview dialog first, mutation after confirm.
async function onBuyBundle(bundleVersionId: string) {
    pendingBundleAction.value = { kind: 'add', bundleVersionId };
    await openBundlePreview(() => billing.previewAddBundle(bundleVersionId));
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
        bundleError.value = err instanceof Error ? err.message : String(err);
    } finally {
        reactivatingBundleId.value = null;
        reactivateConfirmId.value = null;
    }
}

async function openBundlePreview(load: () => Promise<BundlePreviewShape>) {
    bundleError.value = null;
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
            await billing.addBundle(action.bundleVersionId);
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
    return catalog.featureRegistry.value?.[key]?.label ?? featureLabel(key);
}

// Mutation handlers
async function onAcceptPending() {
    acceptingPending.value = true;
    try {
        await billing.acceptPendingPlanVersion();
    } finally {
        acceptingPending.value = false;
    }
}

function onWizardSubmitted() {
    // After a successful plan change the composable's `reload()` is enough —
    // the wizard closes itself (internal reset logic).
}

async function previewPlanChange(plan: string, cycle: 'MONTHLY' | 'YEARLY') {
    return billing.previewPlanChange(plan, cycle);
}
async function changePlan(plan: string, cycle: 'MONTHLY' | 'YEARLY', immediate: boolean) {
    return billing.changePlan(plan, cycle, immediate);
}
</script>

<style>
.sp-plan-section {
    --sp-text-secondary: rgba(0, 0, 0, 0.6);
    --sp-text-muted: rgba(0, 0, 0, 0.55);
    --sp-text-disabled: rgba(0, 0, 0, 0.5);
    --sp-text-strong: rgba(0, 0, 0, 0.7);
    --sp-border: rgba(0, 0, 0, 0.08);
    --sp-summary-bg: rgba(25, 118, 210, 0.06);

    display: flex;
    flex-direction: column;
    gap: 16px;
}
body.body--dark .sp-plan-section {
    --sp-text-secondary: rgba(255, 255, 255, 0.72);
    --sp-text-muted: rgba(255, 255, 255, 0.62);
    --sp-text-disabled: rgba(255, 255, 255, 0.5);
    --sp-text-strong: rgba(255, 255, 255, 0.85);
    --sp-border: rgba(255, 255, 255, 0.16);
    --sp-summary-bg: rgba(25, 118, 210, 0.18);
}
.sp-plan-section__loading,
.sp-plan-section__empty {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 24px;
    color: var(--sp-text-secondary);
}
.sp-plan-section__error {
    color: var(--q-negative, #c10015);
    background: rgba(193, 0, 21, 0.08);
    padding: 12px 16px;
    border-radius: 4px;
}
.sp-plan-section__card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
}
.sp-plan-section__eyebrow {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--sp-text-muted);
    margin-bottom: 4px;
}
.sp-plan-section__plan-name {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
}
.sp-plan-section__meta {
    display: flex;
    gap: 12px;
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
    margin: 6px 0 0;
    color: var(--sp-text-muted);
    font-size: 13px;
}
.sp-plan-section__usage-title {
    font-weight: 600;
    margin-bottom: 12px;
}
.sp-plan-section__usage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
}
.sp-plan-section__item-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sp-plan-section__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid var(--sp-border);
    padding: 10px 14px;
    border-radius: 4px;
}
.sp-plan-section__item-label {
    font-weight: 500;
    margin-right: 12px;
}
.sp-plan-section__item-price {
    color: var(--sp-text-secondary);
    font-size: 13px;
}
.sp-plan-section__item-canceled {
    color: var(--sp-text-disabled);
    font-size: 13px;
}
</style>
