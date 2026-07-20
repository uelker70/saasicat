// Plan-Helper — Pure Functions über einen geladenen PlanCatalog.
//
// Konsumenten injizieren den Catalog via PLAN_CATALOG_TOKEN und delegieren
// an diese Funktionen. Das ersetzt die statischen Top-Level-Funktionen
// (`getPlan`, `getPlanPriceNet`, `getPlanPriceGross`, `getMarketedPlans`),
// die noch über eine statische TS-Const arbeiten.

import type {
    BillingCycle,
    FeatureKey,
    PlanCatalog,
    PlanDef,
    PlanId,
    QuotaKey,
} from '@saasicat/types';
import { round2 } from '../promo/math.js';

/**
 * Findet einen Plan im Catalog. `undefined` wenn nicht vorhanden.
 */
export function findPlan(catalog: PlanCatalog, planId: PlanId): PlanDef | undefined {
    return (catalog.plans ?? []).find((p) => p.id === planId);
}

/**
 * Wie `findPlan`, wirft aber einen typed Error wenn der Plan nicht existiert.
 * Für Code-Pfade, in denen das Fehlen ein Bug ist (Plan-Wechsel-Validierung,
 * Subscription-Snapshot beim Anlegen).
 */
export function getPlanOrThrow(catalog: PlanCatalog, planId: PlanId): PlanDef {
    const plan = findPlan(catalog, planId);
    if (!plan) {
        throw new Error(`Plan "${planId}" nicht im Catalog (${catalog.projectKey}) gefunden`);
    }
    return plan;
}

/**
 * Liefert alle vermarkteten Pläne (`marketed: true` oder undefined). Reihenfolge
 * wie im Catalog. ENTERPRISE und andere `marketed: false`-Pläne sind NICHT
 * enthalten — diese sind nur via `ahp paket apply` / Sondervertrag aktivierbar
 * und gehören nicht in Self-Service-Onboarding-Listen.
 */
export function getMarketedPlans(catalog: PlanCatalog): PlanDef[] {
    return (catalog.plans ?? []).filter((p) => p.marketed !== false);
}

/**
 * Netto-Listenpreis aus dem Catalog. `null` wenn:
 *   - der Plan nicht existiert
 *   - der Plan `marketed: false` ist (z. B. ENTERPRISE — Sondervertrag,
 *     kein Listenpreis)
 *   - der Plan keinen Preis für den Cycle hat (`monthlyNet`/`yearlyNet === null`)
 */
export function getPlanPriceNet(
    catalog: PlanCatalog,
    planId: PlanId,
    cycle: BillingCycle,
): number | null {
    const plan = findPlan(catalog, planId);
    if (!plan) return null;
    if (plan.marketed === false) return null;
    const net = cycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet;
    return net ?? null;
}

/**
 * Brutto-Listenpreis aus dem Catalog (Netto * (1 + vatRate/100)).
 * `null` mit gleichen Regeln wie `getPlanPriceNet`. `vatRate` ist optional;
 * Default: `catalog.vatRate`.
 */
export function getPlanPriceGross(
    catalog: PlanCatalog,
    planId: PlanId,
    cycle: BillingCycle,
    vatRate?: number,
): number | null {
    const net = getPlanPriceNet(catalog, planId, cycle);
    if (net === null) return null;
    const rate = vatRate ?? catalog.vatRate;
    return round2(net * (1 + rate / 100));
}

/**
 * Prüft, ob ein Plan ein Feature direkt enthält (ohne Bundles / Subscription
 * zu betrachten). Für Marketing-Listen, Plan-Vergleichs-Tabellen.
 *
 * Achtung: das ist NICHT der Entitlement-Check für einen konkreten Tenant.
 * Der echte Entitlement-Check (`EntitlementService.computeLimits`) berücksichtigt
 * Bundle-Buchungen und custom-Limits — diese Helper-Funktion ist nur die
 * statische Plan-Definition.
 */
export function isFeatureInPlan(
    catalog: PlanCatalog,
    planId: PlanId,
    featureKey: FeatureKey,
): boolean {
    const plan = findPlan(catalog, planId);
    if (!plan) return false;
    return plan.features.includes(featureKey);
}

/**
 * Aggregierte Plan-Quota für einen Key. Liefert `undefined`, wenn der
 * Plan oder der Key nicht existiert.
 *
 * `-1` ist Catalog-Konvention für „unbegrenzt"; Konsumenten müssen das
 * selbst auf `Number.POSITIVE_INFINITY` mappen, wenn sie damit rechnen.
 */
export function getPlanQuota(
    catalog: PlanCatalog,
    planId: PlanId,
    quotaKey: QuotaKey,
): number | undefined {
    const plan = findPlan(catalog, planId);
    return plan?.quotas[quotaKey];
}

/**
 * Liste aller Feature-Keys, die im Catalog deklariert sind und nicht
 * `plannedOnly: true` sind. Für UI-Listen, die buchbare Features zeigen.
 */
export function getActiveFeatureKeys(catalog: PlanCatalog): FeatureKey[] {
    return (catalog.features ?? []).filter((f) => !f.plannedOnly).map((f) => f.key);
}

/**
 * Prüft, ob ein Feature `plannedOnly: true` ist. Wenn das Feature nicht im
 * Catalog deklariert ist, liefert die Funktion `false` (konservativ:
 * unbekannte Keys werden nicht als „planned" markiert).
 */
export function isFeaturePlannedOnly(catalog: PlanCatalog, featureKey: FeatureKey): boolean {
    const def = (catalog.features ?? []).find((f) => f.key === featureKey);
    return def?.plannedOnly === true;
}
