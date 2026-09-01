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
 * Two conventions meet here, and the column they meet in holds one of them. An
 * offer prices its lines as `net * (1 + vatRate)` — see
 * `checkout-offer.service.ts` and `discount-line-items.ts` — so an offer states
 * the rate as a **fraction**, while `config/saas.yaml` and every path that
 * reads it state the same rate in **per cent**. Recording either as it stands
 * would put both units in `ContractLineItem.taxRate`, on a column whose whole
 * purpose is to be the authoritative record of the rate. A tenant registering
 * through checkout would store `0.19` beside a tax that is 19 % of net; the
 * same installation's next plan change would store `19` for the same tax.
 *
 * Which unit a given breakdown carries is read off its own totals rather than
 * assumed. The per-cent reading has to be proved — the fraction is what this
 * platform's own arithmetic produces, so it is what an unrecognised breakdown
 * is taken to be, and a breakdown that was priced elsewhere at least keeps a
 * rate that explains its own gross.
 */
export function vatPercentFromOfferRate(rate: number, net: number, gross: number): number {
    const asPercent = round2(net * (1 + rate / 100)) === round2(gross);
    const asFraction = round2(net * (1 + rate)) === round2(gross);
    return asPercent && !asFraction ? rate : round2(rate * 100);
}
