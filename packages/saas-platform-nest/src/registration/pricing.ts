// Pure-function pricing engine for the configurator.
//
// Deliberately free of DI / NestJS — callable directly from the service and
// testable independently. Single source of truth for the computation in
// Step 3 (live build summary) and Step 4 (checkout sidebar): the backend
// sends the breakdown to the client; the frontend only displays it.

import type {
    ConfiguratorCatalog,
    ConfiguratorPriceBreakdown,
    RegistrationConfigSelection,
} from '@saasicat/types';

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface PromoEvaluation {
    /** Discount in EUR on the subtotal (gross or net depending on catalog convention; here on net). */
    discountAmount: number;
    /** Percentage for UI display. */
    percent: number;
    label: string;
}

/**
 * Validates the selection against the catalog and returns the complete price
 * breakdown. On invalid inputs (e.g. unknown model) it throws an `Error` — the
 * service translates that into a BadRequestException.
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

/** Pull a model from the catalog; throws if unknown. */
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
