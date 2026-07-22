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
} from '@saasicat/types';

// For yearly payment, the mockup applies 10x the monthly price (= 2 months free).
// If the catalog already provides a `yearlyNet`, that one is used;
// if it is missing, the composable falls back to `monthly * 10`.
export const DEFAULT_YEARLY_FACTOR = 10;

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
        | Ref<PublicMarketingBundle[] | null>
        | ComputedRef<PublicMarketingBundle[] | null>;
    initialPlan?: string | null;
    initialCycle?: BillingCycleStr;
    initialBundleVersionIds?: ReadonlyArray<string>;
    /** Override for the `yearlyNet` fallback if the catalog provides no yearlyNet. */
    yearlyFactor?: number;
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
    /** Plan base without bundles. */
    planNet: number;
    /** Sum of all selected catalog bundles. */
    bundlesNet: number;
    /** Plan + Bundles. */
    subtotalNet: number;
    /** Discount derived from the promo preview (on subtotalNet, not plan-only). */
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

function priceForCycle(
    monthlyNet: number,
    yearlyNet: number | null | undefined,
    cycle: BillingCycleStr,
    yearlyFactor: number,
): number {
    if (cycle === 'YEARLY') {
        return yearlyNet != null ? yearlyNet : monthlyNet * yearlyFactor;
    }
    return monthlyNet;
}

export function useSubscriptionDraft(options: UseSubscriptionDraftOptions): SubscriptionDraft {
    const yearlyFactor = options.yearlyFactor ?? DEFAULT_YEARLY_FACTOR;

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

    const selectedBundles = computed<PublicMarketingBundle[]>(() =>
        subscriptionBundlesRef.value.filter((b) =>
            selectedBundleVersionIds.value.has(b.bundleVersionId),
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

        // Plan
        const planNet = planObj
            ? priceForCycle(planObj.monthlyNet ?? 0, planObj.yearlyNet, cyc, yearlyFactor)
            : 0;

        // Independently bookable catalog bundles from the public marketing catalog.
        // Redundant (fully covered) bundles are excluded here.
        const bundleItems: PriceLineItem[] = [];
        let bundlesNet = 0;
        for (const b of chargeableBundles.value) {
            const net = priceForCycle(b.monthlyNet ?? 0, b.yearlyNet, cyc, yearlyFactor);
            bundlesNet += net;
            bundleItems.push({
                key: `subscription-bundle:${b.bundleVersionId}`,
                label: b.label,
                net,
            });
        }

        const subtotalNet = planNet + bundlesNet;

        // Derive discount from the promo preview (PERCENT logic is mirrored on the
        // frontend; ABSOLUTE is deducted absolutely). The backend recomputes the
        // final truth at redeem time — the sidebar shows only the preview value.
        let discountNet = 0;
        const preview = promoState.value.preview;
        if (preview && preview.valid && promoState.value.status === 'valid') {
            const valid = preview as PromoPreviewValidResponse;
            const value = Number(valid.discount.value);
            if (Number.isFinite(value) && value > 0) {
                if (valid.discount.valueType === 'PERCENT') {
                    discountNet = (subtotalNet * value) / 100;
                } else {
                    discountNet = Math.min(value, subtotalNet);
                }
            }
        }

        const totalNet = Math.max(0, subtotalNet - discountNet);

        // yearSavings: 12 × monthly — yearly. Only meaningful when the catalog
        // knows both prices; otherwise 0.
        let yearSavings = 0;
        if (planObj) {
            const monthlyTotal =
                priceForCycle(planObj.monthlyNet ?? 0, planObj.yearlyNet, 'MONTHLY', yearlyFactor) *
                12;
            const yearlyTotal = priceForCycle(
                planObj.monthlyNet ?? 0,
                planObj.yearlyNet,
                'YEARLY',
                yearlyFactor,
            );
            yearSavings = Math.max(0, monthlyTotal - yearlyTotal);
        }

        return {
            cycle: cyc,
            planNet,
            bundlesNet,
            subtotalNet,
            discountNet,
            totalNet,
            yearSavings,
            breakdown: {
                plan: planObj
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

    function setPlan(planId: string): void {
        if (plan.value === planId) return;
        plan.value = planId;
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
        cycle.value = c;
        // Promo restrictions may change — the caller re-runs preview if needed.
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
        if (promoState.value.status !== 'idle') {
            promoState.value = { status: 'idle', preview: null, message: '' };
        }
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
            throw new Error('useSubscriptionDraft: plan ist nicht gesetzt');
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
