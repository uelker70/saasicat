// Pure math helpers for gross/net calculation. Must be bit-identical to the
// consumer implementations so that backend, tenant frontend and admin UI
// produce consistent results.

export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Gross = net * (1 + vatRate/100). */
export function grossFromNet(net: number, vatRate: number): number {
    return round2(net * (1 + vatRate / 100));
}

/** VAT included in the gross amount: gross * (vatRate / (100 + vatRate)). */
export function computeIncludedVat(grossAmount: number, vatRate: number): number {
    return round2((grossAmount * vatRate) / (100 + vatRate));
}
