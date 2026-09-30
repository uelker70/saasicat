// Tax rates, and the gross/net conversions the platform prices with. The
// arithmetic is `@saasicat/core`'s: an amount is computed from the decimal it
// was written as and rounded once, to the cent, half away from zero
// (`SC-PRIC-061`) — here and in every consumer that imports these.
export { computeIncludedVat, grossFromNet, netFromGross } from '@saasicat/core';

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
