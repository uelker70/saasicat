// The VAT category EN 16931 names for each treatment an adapter decides, and
// what the XML has to say beside it.

import type { TaxTreatment, TaxTreatmentKind } from '@saasicat/core';

/** UNTDID 5305, as EN 16931 uses it. */
export type VatCategory = 'S' | 'E' | 'AE' | 'O';

const CATEGORY: Readonly<Record<TaxTreatmentKind, VatCategory>> = {
    standard: 'S',
    reduced: 'S',
    exempt: 'E',
    'small-business': 'E',
    'reverse-charge': 'AE',
    'not-taxable': 'O',
};

/**
 * The sentence the XML gives as the reason no tax is charged, where the
 * treatment's own note gives none. EN 16931 requires one for every category
 * that charges no tax (BR-E-10, BR-AE-10, BR-O-10).
 */
const FALLBACK_REASON: Readonly<Partial<Record<VatCategory, string>>> = {
    E: 'Exempt from VAT',
    AE: 'Reverse charge',
    O: 'Not subject to VAT',
};

export interface VatCategoryOf {
    category: VatCategory;
    /** Why no tax is charged; `null` for a category that charges it. */
    exemptionReason: string | null;
    /**
     * Whether the invoice names VAT identification numbers. Not for a supply
     * outside the scope of VAT, where EN 16931 forbids them (BR-O-02).
     */
    namesVatIds: boolean;
    /** Whether the rate is stated. Not outside the scope of VAT (BR-O-05). */
    statesRate: boolean;
}

export function vatCategoryOf(treatment: TaxTreatment): VatCategoryOf {
    const category = CATEGORY[treatment.kind];
    const charges = category === 'S';
    return {
        category,
        exemptionReason: charges ? null : (treatment.note ?? FALLBACK_REASON[category] ?? null),
        namesVatIds: category !== 'O',
        statesRate: category !== 'O',
    };
}
