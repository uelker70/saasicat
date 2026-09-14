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
