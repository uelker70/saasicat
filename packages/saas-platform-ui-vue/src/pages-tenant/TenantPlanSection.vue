<template>
    <div class="sp-plan-section">
        <!-- Spinner NUR beim Initial-Load (#19): bei Refresh-Reloads (z. B. nach
             Plan-Wechsel) bleibt der Inhalt inkl. PlanChangeWizard gemountet,
             sonst würde der Wizard mitten im Submit ge-unmountet und nicht
             schließen. -->
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
            <!-- Pending-Plan-Version-Banner -->
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

            <!-- Aktuelle Plan-Karte + Aktionen -->
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

                <!-- Verbrauch -->
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

                    <!-- Leistungsumfang (#18): alle Features enthalten + gesperrt -->
                    <TenantFeatureMatrix
                        :feature-registry="featureRegistry"
                        :active-features="activeFeatures"
                        :feature-label="featureLabelResolved"
                        :i18n="effectiveI18n"
                    />
                </template>

                <q-separator v-if="showBundleStore && hasBundleStore" />

                <!-- Bundle-Store (#15): gebuchte + verfügbare Bundles -->
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

            <!-- Bundle-Add/-Cancel-Vorschau (#37/#61): Proration, Redundanz,
                 requires-Blocker, Mindestlaufzeit — Mutation erst nach Confirm. -->
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

            <!-- Reaktivieren-Bestätigung (analog zur Kündigung): bewusste Aktion -->
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

            <!-- P11.4: Eingefrorener CheckoutOffer-Snapshot (read-only) — nur,
                 wenn die Subscription aus einem Webseiten-Angebot stammt (#20).
                 Ohne Snapshot war der „nicht über Webseiten-Angebot"-Leertext
                 nur verwirrend; das aktuell Gebuchte steht ohnehin oben. -->
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
} from '../use-tenant-billing.js';
import {
    useTenantBillingCatalog,
    type CatalogBundle,
    type CatalogPlan,
} from '../use-tenant-billing-catalog.js';
import type { HttpClient } from '../types.js';

// TenantPlanSection — Hauptkomponente für die Tenant-Plan-/Bundle-Self-Service-
// UI. Konsument (App) bettet sie in seine Settings-Seite ein und reicht
// HTTP-Adapter + Format-Hooks + i18n-Override durch.

interface Props {
    /** App-spezifischer HTTP-Adapter (axios mit Auth-Header etc.). */
    http?: HttpClient;
    /** App-Auth-Token-Getter, falls Adapter nicht selbst injiziert. */
    getAuthToken?: () => string | null;
    /** API-Prefix vor `/billing/*`. Default `/api/billing`. */
    apiPrefix?: string;

    /** EUR/CHF/USD-Formatter. */
    formatCurrency: (n: number) => string;
    /** ISO-Date-String → lokalisiertes Datum. */
    formatDate: (iso: string | Date) => string;
    /** Frei wählbares Format für Quota-Karten im Wizard. */
    formatQuotaLabel?: (key: string, value: number) => string;
    /**
     * Reiner Wert pro Quota-Key (z. B. "200" oder "10 GB") — getrennt vom
     * Label, damit der Wizard's `<PlanGrid>` Wert + Label separat rendern
     * kann. Optional; ohne Override greift der Wizard-Default
     * (`value.toLocaleString('de-DE')` + `GB` bei storage-Keys, ∞ bei -1).
     */
    formatQuotaValue?: (key: string, value: number) => string;

    /** Lokalisiertes Label für einen QuotaKey (z. B. 'users' → 'Benutzer'). */
    quotaLabel?: (key: string) => string;
    /** Lokalisiertes Label für einen FeatureKey. */
    featureLabel?: (key: string) => string;
    /** Default: Storage-Quotas (Float), alle anderen Integer. */
    isFractionalQuota?: (key: string) => boolean;

    /** i18n-Overrides — fehlende Keys fallen auf DEFAULT_I18N_DE zurück. */
    i18n?: Partial<TenantPlanSectionI18n>;

    /**
     * #15 — Catalog-Bundle-Store (gebuchte + verfügbare Bundles) auf dieser
     * Seite anzeigen. Default `false` (opt-in), damit ein Konsument mit
     * eigener Bundle-Seite keine doppelte Bundle-UI bekommt. AutohausPro
     * und vereinsfux setzen `true` (#16-Adoption).
     */
    showBundleStore?: boolean;
    /**
     * #18 — Vollständige Leistungsumfang-Matrix (alle Features enthalten +
     * gesperrt) anzeigen. Default `false` (additiv, opt-in pro Konsument).
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

// Bundle-Store-State (#15)
const buyingBundleId = ref<string | null>(null);
const cancelingBundleId = ref<string | null>(null);
const reactivatingBundleId = ref<string | null>(null);
const reactivateConfirmId = ref<string | null>(null);
const bundleError = ref<string | null>(null);

// Bundle-Preview-Dialog-State (#37/#61)
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
    if (catalog.plans.value && catalog.plans.value.length > 0) {
        // Quota-Keys existieren nur in den Plänen selbst (Code deklariert
        // sie via @DefinesQuota) — die Keys des ersten Plans geben die
        // Anzeige-Reihenfolge vor.
        return Object.keys(catalog.plans.value[0].quotas);
    }
    if (usage.value) return Object.keys(usage.value.limits.quotas);
    return [];
});

const bookablePlans = computed<CatalogPlan[]>(() => catalog.plans.value ?? []);

// Bundle-Store (#15): verfügbare Catalog-Bundles + gebuchte Bundles.
const availableBundles = computed<CatalogBundle[]>(() => catalog.bundles.value ?? []);
// Ein gekündigtes Bundle bleibt bis zum Ende der bereits bezahlten Periode
// aktiv (canceledEffectiveAt liegt in der Zukunft) und wird weiter unter
// „Gebuchte Bundles" angezeigt — das Feature ist für die Periode bezahlt. Erst
// wenn die Kündigung wirksam ist (canceledEffectiveAt <= jetzt), ist das Bundle
// nicht mehr aktiv und verschwindet aus der Liste.
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

// Leistungsumfang-Matrix (#18): alle Features mit Registry-Übersetzung.
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

// Betrag, der tatsächlich pro Abrechnungszyklus fällig wird: Jahrespreis bei
// YEARLY, Monatspreis bei MONTHLY — KEIN /12-Umrechnen (sonst stünde bei einem
// Jahresvertrag ein monatlicher Betrag in der Karte).
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

// Nächster Abrechnungstag = Ende der laufenden Periode NUR bei aktiv
// verlängernder Subscription (status ACTIVE). Bei PAST_DUE ist die Periode
// bereits abgelaufen (kein künftiger Abrechnungstag), bei TRIAL (Trial-Ende
// wird separat gezeigt), CANCELED und PENDING_SALES gibt es keine reguläre
// Verlängerung → ausblenden, statt das Periodenende fälschlich als nächsten
// Abrechnungstag darzustellen.
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

// Helper-Hooks mit Defaults
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

// Bundle-Store-Aktionen (#15/#37): erst Preview-Dialog, Mutation nach Confirm.
async function onBuyBundle(bundleVersionId: string) {
    pendingBundleAction.value = { kind: 'add', bundleVersionId };
    await openBundlePreview(() => billing.previewAddBundle(bundleVersionId));
}

async function onCancelBundle(subscriptionBundleId: string) {
    pendingBundleAction.value = { kind: 'cancel', subscriptionBundleId };
    await openBundlePreview(() => billing.previewCancelBundle(subscriptionBundleId));
}

// Reaktivieren = „Kündigung rückgängig" (un-cancel). Kein Geldfluss/Proration,
// aber bewusste Aktion → Bestätigung (analog zur Kündigung) vor der Mutation.
function onReactivateBundle(subscriptionBundleId: string) {
    bundleError.value = null;
    reactivateConfirmId.value = subscriptionBundleId;
}

function closeReactivateConfirm() {
    if (reactivatingBundleId.value) return; // nicht schließen, während die Mutation läuft
    reactivateConfirmId.value = null;
}

async function confirmReactivateBundle() {
    const subscriptionBundleId = reactivateConfirmId.value;
    if (!subscriptionBundleId) return;
    reactivatingBundleId.value = subscriptionBundleId;
    bundleError.value = null;
    try {
        await billing.reactivateBundle(subscriptionBundleId);
        // Re-Freeze serverseitig → Features/Quotas neu laden, nicht nur die Liste.
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
        // Usage neu laden — nach Add/Cancel ändern sich Features/Quotas
        // (Re-Freeze serverseitig), nicht nur die Bundle-Liste.
        await billing.reload();
    } catch (err) {
        bundlePreviewError.value = err instanceof Error ? err.message : String(err);
    } finally {
        bundlePreviewSubmitting.value = false;
        buyingBundleId.value = null;
        cancelingBundleId.value = null;
    }
}

// Feature-Label mit Registry-Übersetzung (#18): Registry-Label hat Vorrang,
// danach der Konsumenten-Hook, zuletzt der rohe Key.
function featureLabelResolved(key: string): string {
    return catalog.featureRegistry.value?.[key]?.label ?? featureLabel(key);
}

// Mutation-Handler
async function onAcceptPending() {
    acceptingPending.value = true;
    try {
        await billing.acceptPendingPlanVersion();
    } finally {
        acceptingPending.value = false;
    }
}

function onWizardSubmitted() {
    // Nach erfolgreichem Plan-Wechsel reicht der Composable-`reload()` —
    // der Wizard schließt sich selbst (interne Reset-Logik).
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
