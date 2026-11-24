// The terms a subscription can carry beside its plan — a pilot, the
// operator's own limits, the operator's own price — and which of them a
// stored row carries. One rule for every adapter that ends them.

/** A term a subscription carries beside its plan, named by the field that holds it. */
export type SubscriptionSpecialTerm = 'isPilot' | 'customLimits' | 'customMonthlyNet';

/** The fields of a stored subscription that hold its special terms. */
export interface SpecialTermFields {
    readonly isPilot: boolean | null;
    readonly customLimits: unknown;
    readonly customMonthlyNet: unknown;
}

/** The special terms `row` carries, always in the order of `SubscriptionSpecialTerm`. */
export function specialTermsOf(row: SpecialTermFields): SubscriptionSpecialTerm[] {
    const carried: SubscriptionSpecialTerm[] = [];
    if (row.isPilot === true) carried.push('isPilot');
    if (row.customLimits != null) carried.push('customLimits');
    if (row.customMonthlyNet != null) carried.push('customMonthlyNet');
    return carried;
}
