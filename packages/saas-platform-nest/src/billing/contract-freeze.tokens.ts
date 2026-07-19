// DI-Tokens + Ports für den Contract-Freeze (#18).
//
// Beim Paketwechsel wird der vereinbarte Dienst als `SubscriptionContract` mit
// `entitlementSnapshot` eingefroren — der `EntitlementService` liest den aktiven
// Contract ZUERST, sodass spätere AdminUI-Katalog-Änderungen den laufenden Plan
// nicht mehr berühren. Der Freeze-Service (`SubscriptionContractFreezeService`)
// ist generisch; konsumentenspezifisch sind nur `projectKey` (Config) und der
// Bundle-/Plan-Versions-Datenzugriff (`ContractFreezeSourcePort`).

import type { BillingCycle, NewContractLineItemData } from '@saasicat/types';

/**
 * Optionaler Hook-Token: der Plattform-`changePlan`-Pfad + die
 * `PendingPlanMaterializationService` rufen den Freeze nach der Plan-Mutation
 * (analog `TrialProjectionPort`). Ohne Port wird nicht eingefroren — die
 * Entitlements bleiben dann katalog-/versions-gepinnt wie bisher.
 */
export const CONTRACT_FREEZE_PORT_TOKEN = Symbol.for('saas-platform/ContractFreezePort');

/** Adapter-Token: konsumentenspezifischer Bundle-/Versions-Datenzugriff. */
export const CONTRACT_FREEZE_SOURCE_PORT_TOKEN = Symbol.for(
    'saas-platform/ContractFreezeSourcePort',
);

/** Config-Token: `projectKey` des Konsumenten für den Contract. */
export const CONTRACT_FREEZE_PROJECT_KEY_TOKEN = Symbol.for(
    'saas-platform/ContractFreezeProjectKey',
);

export interface ContractFreezePort {
    /**
     * Friert den vereinbarten Dienst zum `effectiveFrom` als neuen aktiven
     * `SubscriptionContract` ein (supersedet den vorherigen). Non-fatal beim
     * Aufrufer — der Plan-Wechsel ist bereits persistiert.
     */
    freezeOnPlanChange(
        tenantId: string,
        newPlan: string,
        billingCycle: BillingCycle,
        effectiveFrom: Date,
    ): Promise<void>;
}

/** Eingefrorene Bundle-Line-Items + ihre Version-Ids (Trace). */
export interface ContractFreezeBundleSnapshot {
    lineItems: NewContractLineItemData[];
    bundleVersionIds: string[];
}

/**
 * Konsumentenspezifischer Datenzugriff für den Freeze: live PlanVersion-Id
 * (Trace) + gebuchte Bundles als Contract-Line-Items. Die generische Freeze-
 * Logik (Plan-Line-Item aus dem Catalog, Snapshot, Contract-Assembly) liegt im
 * Plattform-`SubscriptionContractFreezeService`.
 */
export interface ContractFreezeSourcePort {
    /** Live (published, non-superseded) PlanVersion-Id des Ziel-Plans, oder null. */
    findLivePlanVersionId(planId: string): Promise<string | null>;

    /**
     * Aktive (nicht gekündigte) Bundle-Buchungen des Tenants als Line-Items.
     * `vatRate` wird durchgereicht, damit der Brutto-Preis konsistent zur
     * Catalog-VAT berechnet wird. Apps ohne Bundle-Schema liefern leere Listen.
     */
    loadBookedBundles(
        tenantId: string,
        cycle: 'monthly' | 'yearly',
        vatRate: number,
    ): Promise<ContractFreezeBundleSnapshot>;
}
