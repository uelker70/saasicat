// The money a contract's lines carry beyond their net price, and the one place
// it is put on them.
//
// Currency and tax rate belong to the installation, not to the line: they are
// configured once in `config/saas.yaml` and every line concluded under that
// configuration carries the same pair. So a source that describes what is being
// sold does not state them — it would be restating a setting it does not own,
// and two sources restating it is how they come to disagree.
//
// The gross is not the source's either. Tax is computed once on the net of the
// charges that are billed together — every line of one rhythm — because that is
// the figure a charge is written with. Each line then carries its share of it:
// the lines take the running total of their rhythm in order, each the gross of
// the net so far minus the gross of the net before it. A line is so at most a
// cent from its own conversion, and the lines add up to the totals exactly —
// net, gross and tax. Converting every line on its own instead leaves the lines
// a cent short of, or over, the total: 10.02 + 10.02 net at 19 % is
// 11.92 + 11.92 = 23.84 as lines against 23.85 as a total.
//
// The tax a line records is the gap between its own net and gross. Taking it
// from the rate a second time would round a second time, and a line whose tax
// does not close its own gap is a row that disagrees with itself.

import type { NewContractLineItemData } from '@saasicat/core';

import { grossFromNet } from '../promo/math.js';

type Cycle = 'monthly' | 'yearly';

const MONTHS_PER_YEAR = 12;

/**
 * A line as its source hands it over: priced in net, but not yet carrying the
 * gross, the currency and the tax rate the installation applies.
 */
export type PricedContractLineItem = Omit<
    NewContractLineItemData,
    'priceGross' | 'currency' | 'taxRate' | 'taxAmount'
>;

/** The installation's money facts, as a contract's lines are recorded with them. */
export interface ContractLineMoney {
    /** ISO 4217. */
    currency: string;
    /** A percentage: 19 means 19 %. */
    taxRate: number;
}

/** What a contract's lines add up to over one period of the contract. */
export interface ContractLineTotals {
    /** Every line that is not a discount. */
    subtotalNet: number;
    /** What the discount lines take off, as a positive amount. */
    discountNet: number;
    totalNet: number;
    totalGross: number;
}

/**
 * The lines of one contract with the installation's money recorded on them:
 * each line's gross as its share of the tax its rhythm owes, the currency, the
 * rate, and the tax as the gap between net and gross.
 *
 * The order of the lines is the order the shares are taken in, so the same
 * lines in the same order always come out the same.
 */
export function recordContractLinesMoney(
    lines: readonly PricedContractLineItem[],
    money: ContractLineMoney,
): NewContractLineItemData[] {
    const shares = grossSharesOf(lines, money.taxRate);
    return lines.map((line, index) => {
        const priceGross = shares[index] as number;
        return {
            ...line,
            priceGross,
            currency: money.currency,
            taxRate: money.taxRate,
            taxAmount: fromCents(toCents(priceGross) - toCents(line.priceNet)),
        };
    });
}

/**
 * Each line's gross, as its share of the tax computed once on the net of its
 * rhythm. The lines of one rhythm add up to the gross of their net total, to
 * the cent.
 */
export function grossSharesOf(
    lines: readonly { priceNet: number; billingCycle: Cycle }[],
    taxRate: number,
): number[] {
    const netSoFar = new Map<Cycle, number>();
    return lines.map((line) => {
        const before = netSoFar.get(line.billingCycle) ?? 0;
        const after = before + toCents(line.priceNet);
        netSoFar.set(line.billingCycle, after);
        return fromCents(grossCents(after, taxRate) - grossCents(before, taxRate));
    });
}

/**
 * What the lines add up to over one period of a contract in `contractCycle`.
 *
 * Each line counts as often as it falls due in that period: a monthly add-on in
 * a yearly contract twelve times. Summed in cents, so a total is exact rather
 * than the float nearest to it.
 */
export function contractTotalsOf(
    lines: readonly Pick<
        NewContractLineItemData,
        'kind' | 'priceNet' | 'priceGross' | 'billingCycle'
    >[],
    contractCycle: Cycle,
): ContractLineTotals {
    let subtotalNet = 0;
    let discountNet = 0;
    let totalGross = 0;
    for (const line of lines) {
        const times = timesDueInOnePeriod(contractCycle, line.billingCycle);
        const net = times * toCents(line.priceNet);
        if (line.kind === 'discount') discountNet -= net;
        else subtotalNet += net;
        totalGross += times * toCents(line.priceGross);
    }
    return {
        subtotalNet: fromCents(subtotalNet),
        discountNet: fromCents(discountNet),
        totalNet: fromCents(subtotalNet - discountNet),
        totalGross: fromCents(totalGross),
    };
}

/**
 * How often a line falls due in one period of its contract.
 *
 * A monthly line in a yearly contract falls due twelve times. The other
 * direction cannot occur — a bundle may not outlast the plan it hangs on, which
 * is what `bundleCycleFitsPlan` refuses — and if it ever did, dividing would
 * invent a price nobody is charged, so it counts once and the line's own
 * `billingCycle` says what it really is.
 */
function timesDueInOnePeriod(contractCycle: Cycle, lineCycle: Cycle): number {
    return contractCycle === 'yearly' && lineCycle === 'monthly' ? MONTHS_PER_YEAR : 1;
}

/** Through `grossFromNet`, so a rhythm's total is the one every other place computes. */
function grossCents(netCents: number, taxRate: number): number {
    return toCents(grossFromNet(fromCents(netCents), taxRate));
}

function toCents(amount: number): number {
    return Math.round(amount * 100);
}

/** Never `-0`: a total of nothing is stored and compared as 0. */
function fromCents(cents: number): number {
    return cents === 0 ? 0 : cents / 100;
}
