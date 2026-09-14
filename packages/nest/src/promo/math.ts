// Pure math helpers for gross/net calculation. Must be bit-identical to the
// consumer implementations so that backend, tenant frontend and admin UI
// produce consistent results.

export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Whether a tax rate is one SaaSiCat accepts. Every tax rate in SaaSiCat is a
 * percentage — 19 means 19 % — wherever it is stated: the settings, the
 * catalogue, an offer, a contract, a contract line.
 *
 * A percentage lies from 0 to 100, and none lies strictly between 0 and 1:
 * that is the shape of a fraction such as 0.19, and a fraction is refused
 * rather than taken for a fraction of a per cent.
 */
export function isTaxRatePercent(rate: number): boolean {
    return Number.isFinite(rate) && rate >= 0 && rate <= 100 && !(rate > 0 && rate < 1);
}

/** Gross = net * (1 + vatRate/100), with `vatRate` a percentage. */
export function grossFromNet(net: number, vatRate: number): number {
    return round2(net * (1 + vatRate / 100));
}

/** Net = gross * 100 / (100 + vatRate), with `vatRate` a percentage. */
export function netFromGross(gross: number, vatRate: number): number {
    return round2((gross * 100) / (100 + vatRate));
}

/** VAT included in the gross amount: gross * vatRate / (100 + vatRate). */
export function computeIncludedVat(grossAmount: number, vatRate: number): number {
    return round2((grossAmount * vatRate) / (100 + vatRate));
}
