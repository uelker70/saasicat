// Pure-Function-Pricing-Engine fuer den Konfigurator.
//
// Bewusst frei von DI / NestJS — direkt aus dem Service aufrufbar und
// unabhaengig testbar. Single Source of Truth fuer die Berechnung in
// Step 3 (Live-Build-Summary) und Step 4 (Checkout-Sidebar): das Backend
// schickt den Breakdown an den Client; das Frontend zeigt ihn nur an.

import type {
    ConfiguratorCatalog,
    ConfiguratorPriceBreakdown,
    RegistrationConfigSelection,
} from '@saasicat/types';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface PromoEvaluation {
    /** Rabatt in EUR auf den Subtotal (Brutto oder Netto je nach Catalog-Konvention; hier auf Netto). */
    discountAmount: number;
    /** Prozent fuer UI-Anzeige. */
    percent: number;
    label: string;
}

/**
 * Validiert die Auswahl gegen den Catalog und liefert den vollstaendigen
 * Preis-Breakdown. Bei ungueltigen Inputs (z. B. unbekanntes Modell) wirft
 * ein `Error` — der Service uebersetzt das in eine BadRequestException.
 */
export function computeBreakdown(
    catalog: ConfiguratorCatalog,
    selection: RegistrationConfigSelection,
    promo?: PromoEvaluation,
): ConfiguratorPriceBreakdown {
    const model = catalog.models.find((m) => m.id === selection.modelId);
    if (!model) {
        throw new Error(`Unknown model: ${selection.modelId}`);
    }

    const modelMonthlyNet = round2(model.monthlyNet);
    const effectiveQuotas: Record<string, number> = { ...model.quotaBase };

    const subtotalMonthlyNet = modelMonthlyNet;

    const factor = selection.billingCycle === 'YEARLY' ? catalog.cycleDiscount : 1;
    const subtotalNet = round2(subtotalMonthlyNet * factor);

    const discountAmount = promo ? Math.min(round2(promo.discountAmount), subtotalNet) : 0;
    const totalNet = Math.max(0, round2(subtotalNet - discountAmount));
    const totalGross = round2(totalNet * (1 + catalog.vatRate / 100));

    const yearlySavings =
        selection.billingCycle === 'YEARLY'
            ? round2(subtotalMonthlyNet * 12 - subtotalMonthlyNet * catalog.cycleDiscount)
            : 0;

    return {
        cycle: selection.billingCycle,
        effectiveQuotas,
        modelMonthlyNet,
        subtotalMonthlyNet,
        subtotalNet,
        discountAmount,
        totalNet,
        vatRate: catalog.vatRate,
        totalGross,
        yearlySavings,
        appliedPromo: promo ? { code: '', label: promo.label, percent: promo.percent } : undefined,
    };
}

/** Modell aus dem Catalog ziehen; wirft bei Unbekannt. */
export function resolveModel(
    catalog: ConfiguratorCatalog,
    modelId: string,
): { planId: string; monthlyNet: number; yearlyNet: number } {
    const model = catalog.models.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return {
        planId: model.planId,
        monthlyNet: model.monthlyNet,
        yearlyNet: model.yearlyNet,
    };
}
