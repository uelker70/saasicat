// useSubscriptionDraft — Vue-Composable für den reaktiven Konfigurations-State
// des Onboarding-Konfigurators (und des Plan-Change-Wizards).
//
// State: Plan + Cycle + ausgewählte Catalog-Bundles + Promo-Code-Status.
// Output: abgeleitete Preise pro Cycle, Aufstellung pro Block (Plan / Bundles),
//         aktive-Feature-Set, API-Payload für
//         `POST /billing/onboarding/initial-subscription`.
//
// Bewusst HTTP-frei — der Konsument bindet `previewPromo()` und
// `submit()` extern ein und reicht das Ergebnis via `setPromoState` ein.
// So bleibt das Composable testbar ohne Network-Mocks.

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

// Mockup wendet bei Jahres-Zahlung 10x den Monatspreis an (= 2 Monate gratis).
// Wenn der Catalog bereits einen `yearlyNet` liefert, wird der genommen;
// fehlt er, fällt das Composable auf `monthly * 10` zurück.
export const DEFAULT_YEARLY_FACTOR = 10;

export type PromoStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'restricted';

export interface PromoState {
    status: PromoStatus;
    /** Backend-Antwort (nur gesetzt, wenn status === 'valid' oder 'restricted'). */
    preview: PromoPreviewResponse | null;
    /** Anzeige-Text für die UI (Bestätigung oder Fehlermeldung). */
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
    /** Override für `yearlyNet`-Fallback, falls Catalog kein yearlyNet liefert. */
    yearlyFactor?: number;
}

export interface PriceLineItem {
    /** Stable key für UI-`v-for`. */
    key: string;
    label: string;
    /** Roher Catalog-Wert in der gewählten Cycle-Einheit. */
    net: number;
    /** Optional: Zusatztext. */
    sublabel?: string;
}

export interface DraftPricing {
    cycle: BillingCycleStr;
    /** Plan-Basis ohne Bundles. */
    planNet: number;
    /** Summe aller gewählten Catalog-Bundles. */
    bundlesNet: number;
    /** Plan + Bundles. */
    subtotalNet: number;
    /** Aus Promo-Preview abgeleiteter Rabatt (auf subtotalNet, nicht plan-only). */
    discountNet: number;
    /** subtotalNet - discountNet. */
    totalNet: number;
    /** Ersparnis pro Jahr ggü. monatlicher Zahlung. */
    yearSavings: number;
    /** Strukturierte Aufstellung für die Sticky-Sidebar. */
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
    /** Plan-included ∪ Features der gewählten Catalog-Bundles. */
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

    // Gewählte Bundles, deren Features durch Plan ∪ die übrigen gewählten
    // Bundles vollständig gedeckt sind, würden doppelt verkauft. Sie fließen
    // weder in Preis noch in Payload — reaktiv, damit das Abwählen des
    // deckenden Bundles das redundante Bundle wieder berechnet. Geteilte,
    // iterative Redundanz-Ableitung (`selectChargeableBundles`): behält bei
    // gegenseitiger/zyklischer Deckung deterministisch genau ein Bundle statt
    // alle Beteiligten zu verwerfen. Anzeige-Reihenfolge folgt dem Katalog —
    // der Helper bestimmt nur WELCHE Bundles bleiben, nicht ihre Sortierung.
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

        // Eigenständig buchbare Catalog-Bundles aus dem Public-Marketing-Catalog.
        // Redundante (vollständig gedeckte) Bundles sind hier ausgeschlossen.
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

        // Discount aus Promo-Preview ableiten (PERCENT-Logik wird frontend-seitig
        // gespiegelt; ABSOLUTE wird absolut abgezogen). Backend re-berechnet beim
        // Redeem die finale Wahrheit — die Sidebar zeigt nur den Vorschau-Wert.
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

        // yearSavings: 12 × monthly — yearly. Nur sinnvoll, wenn Catalog
        // beide Preise kennt; sonst 0.
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
        // Bundle-Auswahl auf die mit dem neuen Plan kompatiblen reduzieren.
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
        // Promo-Restriktionen können sich ändern — Caller ruft ggf. preview neu.
    }

    function toggleSubscriptionBundle(bundleVersionId: string): void {
        const next = new Set(selectedBundleVersionIds.value);
        if (next.has(bundleVersionId)) next.delete(bundleVersionId);
        else next.add(bundleVersionId);
        selectedBundleVersionIds.value = next;
    }

    function setPromoCode(code: string): void {
        promoCode.value = code.toUpperCase();
        // Status zurücksetzen — der Caller validiert via preview() neu.
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
        // Nur tatsächlich berechnete Bundles senden — redundante (vollständig
        // gedeckte) würden sonst doppelt gebucht.
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
