// The bookkeeping facts a contract line carries beyond its price, and the one
// place they are put on it.
//
// Currency and tax rate belong to the installation, not to the line: they are
// configured once in `config/saas.yaml` and every line concluded under that
// configuration carries the same pair. So a source that describes what is being
// sold does not state them — it would be restating a setting it does not own,
// and two sources restating it is how they come to disagree.
//
// What the line does own is its own net and gross, and the tax is the gap
// between them. Taking it from the rate a second time would round a second
// time, and a line whose tax does not close its own gap is a row that disagrees
// with itself.

import type { NewContractLineItemData } from '@saasicat/core';

import { round2 } from '../promo/math.js';

/**
 * A line as its source hands it over: priced, but not yet carrying the
 * currency and tax rate the installation applies.
 */
export type PricedContractLineItem = Omit<
    NewContractLineItemData,
    'currency' | 'taxRate' | 'taxAmount'
>;

/** The line with the installation's money facts recorded on it. */
export function recordLineItemMoney(
    line: PricedContractLineItem,
    currency: string,
    taxRate: number,
): NewContractLineItemData {
    return {
        ...line,
        currency,
        taxRate,
        taxAmount: round2(line.priceGross - line.priceNet),
    };
}

/**
 * The VAT rate a checkout offer states, as a percentage.
 *
 * A stored offer can carry the rate in either unit. The server prices an offer
 * in **per cent**, as `config/saas.yaml` names the rate, while an offer row
 * written by other code may carry a **fraction**. Recording either as it
 * stands would put both units in `ContractLineItem.taxRate`, on a column whose
 * whole purpose is to be the authoritative record of the rate.
 *
 * Which unit a given breakdown carries is read off its own totals where they
 * tell the two apart. Where they cannot — a total of zero explains any rate —
 * the size decides: a VAT rate stated as a fraction is below one, and one
 * stated in per cent is not.
 */
export function vatPercentFromOfferRate(rate: number, net: number, gross: number): number {
    const asPercent = round2(net * (1 + rate / 100)) === round2(gross);
    const asFraction = round2(net * (1 + rate)) === round2(gross);
    if (asPercent !== asFraction) return asPercent ? rate : round2(rate * 100);
    return rate >= 1 ? rate : round2(rate * 100);
}
