// useSubscriptionDraft — Vue composable for the reactive configuration state
// of the onboarding configurator (and the plan-change wizard).
//
// State: Plan + Cycle + selected catalog bundles + promo-code status.
// Output: derived prices per cycle, breakdown per block (Plan / Bundles),
//         active feature set, API payload for
//         `POST /billing/onboarding/initial-subscription`.
//
// Intentionally HTTP-free — the consumer wires in `previewPromo()` and
// `submit()` externally and feeds the result in via `setPromoState`.
// This keeps the composable testable without network mocks.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { CatalogPlan } from './use-tenant-billing-catalog.js';
import type { BillingCycleStr } from './use-tenant-billing.js';
import {
    selectChargeableBundles,
    type OnboardingSelectionRequest,
    type PromoPreviewResponse,
    type PromoPreviewValidResponse,
    type PublicMarketingBundle,
} from '@saasicat/core';

export type PromoStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'restricted';

export interface PromoState {
    status: PromoStatus;
    /** Backend response (only set when status === 'valid' or 'restricted'). */
    preview: PromoPreviewResponse | null;
    /** Display text for the UI (confirmation or error message). */
    message: string;
}

export interface UseSubscriptionDraftOptions {
    plans: Ref<CatalogPlan[] | null> | ComputedRef<CatalogPlan[] | null>;
    subscriptionBundles?:
        Ref<PublicMarketingBundle[] | null> | ComputedRef<PublicMarketingBundle[] | null>;
    initialPlan?: string | null;
    initialCycle?: BillingCycleStr;
    initialBundleVersionIds?: ReadonlyArray<string>;
}

export interface PriceLineItem {
    /** Stable key for UI `v-for`. */
    key: string;
    label: string;
    /** Raw catalog value in the selected cycle unit. */
    net: number;
    /** Optional: additional text. */
    sublabel?: string;
}

export interface DraftPricing {
    cycle: BillingCycleStr;
    /**
     * Whether the selected plan carries a price for the cycle. A plan without
     * one is not sold in it — a plan without a yearly price is a monthly plan —
     * so `planNet` is 0 and there is nothing to submit.
     */
    planPriced: boolean;
    /** Plan base without bundles. */
    planNet: number;
    /** Sum of all selected catalog bundles. */
    bundlesNet: number;
    /** Plan + Bundles. */
    subtotalNet: number;
    /**
     * The promo preview's discount in net. A code discounts the plan price, not
     * the bundles, so it never exceeds `planNet`.
     */
    discountNet: number;
    /** subtotalNet - discountNet. */
    totalNet: number;
    /** Savings per year vs. monthly payment. */
    yearSavings: number;
    /** Structured breakdown for the sticky sidebar. */
    breakdown: {
        plan: PriceLineItem | null;
        bundles: PriceLineItem[];
    };
}

export interface SubscriptionDraft {
    // ─── State (writable) ─────────────────────────────────────────────
    plan: Ref<string | null>;
    cycle: Ref<BillingCycleStr>;
    selectedBundleVersionIds: Ref<Set<string>>;
    promoCode: Ref<string>;
    promoState: Ref<PromoState>;

    // ─── Derived ─────────────────────────────────────────────────────
    selectedPlan: ComputedRef<CatalogPlan | null>;
    /** Plan-included ∪ features of the selected catalog bundles. */
    activeFeatures: ComputedRef<Set<string>>;
    pricing: ComputedRef<DraftPricing>;
    isDirty: ComputedRef<boolean>;

    // ─── Mutators ────────────────────────────────────────────────────
    setPlan(planId: string): void;
    setCycle(c: BillingCycleStr): void;
    toggleSubscriptionBundle(bundleVersionId: string): void;
    setPromoCode(code: string): void;
    setPromoState(state: PromoState): void;
    clearPromo(): void;

    // ─── Serialization ───────────────────────────────────────────────
    toApiPayload(): OnboardingSelectionRequest;
}

function unwrap<T>(source: Ref<T> | ComputedRef<T> | T): T {
    if (source && typeof source === 'object' && 'value' in source) {
        return (source as Ref<T>).value;
    }
    return source as T;
}

/**
 * The price the catalogue carries for the cycle, or `null` when it carries none.
 *
 * Never derived from the other cycle: a yearly price is what the operator set
 * for a year, and the offer and the contract charge that figure or refuse.
 */
function priceForCycle(
    item: { monthlyNet: number | null; yearlyNet: number | null },
    cycle: BillingCycleStr,
): number | null {
    return cycle === 'YEARLY' ? item.yearlyNet : item.monthlyNet;
}

export function useSubscriptionDraft(options: UseSubscriptionDraftOptions): SubscriptionDraft {
    const plansRef = computed<CatalogPlan[]>(() => unwrap(options.plans) ?? []);
    const subscriptionBundlesRef = computed<PublicMarketingBundle[]>(
        () => unwrap(options.subscriptionBundles ?? null) ?? [],
    );

    const plan = ref<string | null>(options.initialPlan ?? null);
    const cycle = ref<BillingCycleStr>(options.initialCycle ?? 'MONTHLY');
    const selectedBundleVersionIds = ref<Set<string>>(
        new Set(options.initialBundleVersionIds ?? []),
    );
    const promoCode = ref('');
    const promoState = ref<PromoState>({ status: 'idle', preview: null, message: '' });

    const selectedPlan = computed(() => {
        if (!plan.value) return null;
        return plansRef.value.find((p) => p.id === plan.value) ?? null;
    });

    // A selected bundle without a price for the cycle is not sold in it, so it
    // is neither charged nor sent, and covers nothing. It stays selected, so
    // switching back to the cycle it is priced for books it again.
    const selectedBundles = computed<PublicMarketingBundle[]>(() =>
        subscriptionBundlesRef.value.filter(
            (b) =>
                selectedBundleVersionIds.value.has(b.bundleVersionId) &&
                priceForCycle(b, cycle.value) !== null,
        ),
    );

    // Selected bundles whose features are fully covered by Plan ∪ the other
    // selected bundles would be sold twice. They flow into neither price nor
    // payload — reactive, so that deselecting the covering bundle recomputes
    // the redundant bundle again. Shared, iterative redundancy derivation
    // (`selectChargeableBundles`): under mutual/cyclic coverage it deterministically
    // keeps exactly one bundle instead of discarding all involved. Display
    // order follows the catalog — the helper only determines WHICH bundles
    // remain, not their sort order.
    const chargeableBundles = computed<PublicMarketingBundle[]>(() => {
        const planFeatures = selectedPlan.value?.features ?? [];
        const selected = selectedBundles.value;
        const keptIds = new Set(
            selectChargeableBundles(planFeatures, selected).map((b) => b.bundleVersionId),
        );
        return selected.filter((b) => keptIds.has(b.bundleVersionId));
    });

    const activeFeatures = computed<Set<string>>(() => {
        const result = new Set<string>();
        const planObj = selectedPlan.value;
        if (planObj) {
            for (const f of planObj.features) result.add(f);
        }
        for (const bundle of selectedBundles.value) {
            for (const f of bundle.features) result.add(f);
        }
        return result;
    });

    const pricing = computed<DraftPricing>(() => {
        const cyc = cycle.value;
        const planObj = selectedPlan.value;

        const planPrice = planObj ? priceForCycle(planObj, cyc) : null;
        const planNet = planPrice ?? 0;

        // Independently bookable catalog bundles from the public marketing catalog.
        // Redundant (fully covered) bundles are excluded here.
        const bundleItems: PriceLineItem[] = [];
        let bundlesNet = 0;
        for (const b of chargeableBundles.value) {
            const net = priceForCycle(b, cyc) ?? 0;
            bundlesNet += net;
            bundleItems.push({
                key: `subscription-bundle:${b.bundleVersionId}`,
                label: b.label,
                net,
            });
        }

        const subtotalNet = planNet + bundlesNet;

        // The discount is the one the server previewed. The promo module reckons
        // it on the plan price in gross, and only the server knows the VAT rate
        // that turns it into the net figure this summary adds up. A preview
        // answers for one plan and cycle, which is why changing either sets the
        // promo state back to idle for the caller to ask again.
        let discountNet = 0;
        const preview = promoState.value.preview;
        if (preview && preview.valid && promoState.value.status === 'valid') {
            const amount = Number((preview as PromoPreviewValidResponse).price.discountNet);
            if (Number.isFinite(amount) && amount > 0) {
                discountNet = Math.min(amount, planNet);
            }
        }

        const totalNet = Math.max(0, subtotalNet - discountNet);

        // yearSavings: 12 × monthly − yearly. Only meaningful when the catalog
        // knows both prices; otherwise 0.
        let yearSavings = 0;
        if (planObj && planObj.monthlyNet !== null && planObj.yearlyNet !== null) {
            yearSavings = Math.max(0, planObj.monthlyNet * 12 - planObj.yearlyNet);
        }

        return {
            cycle: cyc,
            planPriced: planPrice !== null,
            planNet,
            bundlesNet,
            subtotalNet,
            discountNet,
            totalNet,
            yearSavings,
            breakdown: {
                // A plan not sold in the cycle has no line: 0.00 beside its name
                // would read as a price.
                plan:
                    planObj && planPrice !== null
                        ? {
                              key: `plan:${planObj.id}`,
                              label: planObj.name,
                              net: planNet,
                              sublabel: `${planObj.features.length} Basis-Module`,
                          }
                        : null,
                bundles: bundleItems,
            },
        };
    });

    const isDirty = computed(() => {
        return selectedBundleVersionIds.value.size > 0 || promoState.value.status === 'valid';
    });

    // A promo preview answers for the plan and cycle it was asked about.
    function forgetPromoPreview(): void {
        if (promoState.value.status !== 'idle') {
            promoState.value = { status: 'idle', preview: null, message: '' };
        }
    }

    function setPlan(planId: string): void {
        if (plan.value === planId) return;
        plan.value = planId;
        forgetPromoPreview();
        // Reduce the bundle selection to those compatible with the new plan.
        const compatibleBundleVersions = new Set<string>();
        for (const bundle of subscriptionBundlesRef.value) {
            if (
                bundle.compatiblePlanKeys.length === 0 ||
                bundle.compatiblePlanKeys.includes(planId)
            ) {
                compatibleBundleVersions.add(bundle.bundleVersionId);
            }
        }
        selectedBundleVersionIds.value = new Set(
            [...selectedBundleVersionIds.value].filter((id) => compatibleBundleVersions.has(id)),
        );
    }

    function setCycle(c: BillingCycleStr): void {
        if (cycle.value === c) return;
        cycle.value = c;
        forgetPromoPreview();
    }

    function toggleSubscriptionBundle(bundleVersionId: string): void {
        const next = new Set(selectedBundleVersionIds.value);
        if (next.has(bundleVersionId)) next.delete(bundleVersionId);
        else next.add(bundleVersionId);
        selectedBundleVersionIds.value = next;
    }

    function setPromoCode(code: string): void {
        promoCode.value = code.toUpperCase();
        // Reset status — the caller re-validates via preview().
        forgetPromoPreview();
    }

    function setPromoState(state: PromoState): void {
        promoState.value = state;
    }

    function clearPromo(): void {
        promoCode.value = '';
        promoState.value = { status: 'idle', preview: null, message: '' };
    }

    function toApiPayload(): OnboardingSelectionRequest {
        if (!plan.value) {
            throw new Error('useSubscriptionDraft: plan is not set');
        }
        const payload: OnboardingSelectionRequest = {
            plan: plan.value,
            billingCycle: cycle.value,
        };
        if (promoState.value.status === 'valid' && promoCode.value) {
            payload.promoCode = promoCode.value;
        }
        // Send only actually charged bundles — redundant (fully covered) ones
        // would otherwise be booked twice.
        const chargeableIds = chargeableBundles.value.map((b) => b.bundleVersionId);
        if (chargeableIds.length > 0) {
            payload.bundleVersionIds = chargeableIds;
        }
        return payload;
    }

    return {
        plan,
        cycle,
        selectedBundleVersionIds,
        promoCode,
        promoState,
        selectedPlan,
        activeFeatures,
        pricing,
        isDirty,
        setPlan,
        setCycle,
        toggleSubscriptionBundle,
        setPromoCode,
        setPromoState,
        clearPromo,
        toApiPayload,
    };
}
