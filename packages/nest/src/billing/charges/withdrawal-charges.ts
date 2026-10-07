// What a feature withdrawal changes in a subscriber's account. Pure, beside
// `charge-derivation.ts`, which hands it everything the account holds and
// everything due in the same derivation.
//
// One rule for the reduction: for every period of a line the withdrawal
// reduces, the account holds exactly the reduction for the days of that
// period without the feature — and what it holds is moved to that figure by
// one entry whenever what is known changes. Charged together with its period,
// the reduction is part of that charge. A period charged before the
// withdrawal takes effect is credited from its date (`credit`). Where the days
// shrink — the feature came back, or the line ended at once, or the period was
// replaced by one in a longer rhythm — what was reduced for the days after is
// taken back (`reductionTakenBack`). A reduction never takes a period below
// nothing: it is held to what the period costs after its other discounts.
//
// One rule for ending at once: the unused rest of the period charged is
// credited, net of the discounts it carried, for the plan and every add-on when
// the subscription ends, and for the booking alone when only it does.

import type {
    BillingCycle,
    ContractLineItemRecord,
    NewSubscriberCharge,
    SubscriptionContractRecord,
} from '@saasicat/core';
import { prorate, toCents } from '@saasicat/core';

import { bundleFirstPeriodStart } from '../bundle-period.js';
import {
    withdrawalReductionOf,
    type WithdrawalReductionMark,
} from '../feature-withdrawal-lines.js';
import type { ChargeDerivationInput, ChargePeriod } from './charge-derivation.js';
import {
    addOnHoldOf,
    chargeOf,
    isWholePlanPeriod,
    lineById,
    sameInstant,
    type AccountEntry,
} from './charge-entries.js';

const DAY_MS = 86_400_000;
const CENTS = 100;

/** An entry as the account holds it or is about to: written, or due in this derivation. */
type Entry = AccountEntry;

/** A whole period of one line, and the charge that priced it. */
interface LinePeriod extends ChargePeriod {
    readonly charge: Entry;
    /** Whether the charge is due in this derivation rather than already written. */
    readonly due: boolean;
    /** The days of the whole cycle the period is a share of, which a reduction is a share of too. */
    readonly cycleDays: number;
}

/** A reduction line, read from the earliest contract that records it. */
interface ReductionLine {
    readonly contract: SubscriptionContractRecord;
    readonly line: ContractLineItemRecord;
    readonly mark: WithdrawalReductionMark;
}

/**
 * The entries a withdrawal gives rise to and the account does not hold yet:
 * the reductions and their corrections, and the unused rest of what ended at
 * once.
 */
export function deriveWithdrawalCharges(
    input: ChargeDerivationInput,
    due: readonly NewSubscriberCharge[],
): NewSubscriberCharge[] {
    const entries: Entry[] = [...input.written, ...due];
    const dueSet = new Set<Entry>(due);
    const charges: NewSubscriberCharge[] = [];
    const slices = reductionSlices(input, entries, dueSet);
    // The moments a reduction of a period stops: where another reduction of
    // the same period grows after it was credited — the days the first gave
    // back are the second's again — the growth is booked at the moment that
    // freed them, rather than beside its own first credit.
    const endsOf = new Map<string, Date[]>();
    for (const slice of slices) {
        if (slice.to < slice.period.end) {
            endsOf.set(slice.periodKey, [...(endsOf.get(slice.periodKey) ?? []), slice.to]);
        }
    }
    // What the reductions derived so far take off each period.
    const reducedSoFar = new Map<string, number>();
    for (const slice of slices) {
        const { reduction, period, days, periodKey } = slice;
        const netCents = netOfOthers(period, entries, input);
        const targetCents = -Math.min(
            cents(prorate(reduction.mark.amountNet, days, period.cycleDays)),
            // No more than the days without the feature cost …
            cents(prorate(netCents / CENTS, days, Math.max(1, periodDays(period)))),
            // … and, with the other withdrawals of the line, no more than the period.
            Math.max(0, netCents - (reducedSoFar.get(periodKey) ?? 0)),
        );
        reducedSoFar.set(periodKey, (reducedSoFar.get(periodKey) ?? 0) - targetCents);
        const writtenCents = writtenFor(slice, entries).reduce(
            (sum, entry) => sum + cents(entry.amountNet),
            0,
        );
        const difference = targetCents - writtenCents;
        if (difference === 0) continue;
        const entry = reductionEntry(
            input,
            slice,
            difference,
            entries,
            endsOf.get(periodKey) ?? [],
        );
        if (entry) charges.push(entry);
    }
    charges.push(...unusedRestCredits(input, [...entries, ...charges], dueSet));
    return charges;
}

/** One reduction over one period of its line: from when to when the feature is missing. */
interface ReductionSlice {
    readonly reduction: ReductionLine;
    readonly period: LinePeriod;
    readonly from: Date;
    readonly to: Date;
    readonly days: number;
    readonly periodKey: string;
}

/** Each reduction over each period of the line it reduces, in the order they are capped. */
function reductionSlices(
    input: ChargeDerivationInput,
    entries: readonly Entry[],
    dueSet: ReadonlySet<Entry>,
): ReductionSlice[] {
    const withdrawals = new Map((input.withdrawals ?? []).map((one) => [one.id, one]));
    const slices: ReductionSlice[] = [];
    for (const reduction of reductionLines(input.contracts)) {
        const withdrawal = withdrawals.get(reduction.mark.withdrawalId);
        if (!withdrawal) continue;
        const periods =
            reduction.mark.subscriptionBundleId === null
                ? planPeriods(input, entries, dueSet)
                : bookingPeriods(input, entries, dueSet, reduction.mark.subscriptionBundleId);
        const endedAt = endedAtOnceOf(input, reduction.mark.subscriptionBundleId);
        for (const period of periods) {
            const priced = lineById(input.contracts, period.charge.contractLineItemId);
            if (!priced || !reduces(reduction, priced, withdrawal.featureKey, input)) continue;
            const until = earliestOf(
                withdrawal.liftedFrom,
                endedAt,
                replacedAt(period, periods, reduction),
            );
            const from = laterOf(period.start, withdrawal.effectiveFrom);
            const to = until && until < period.end ? until : period.end;
            const days = to > from ? remainingDays(from, period) - remainingDays(to, period) : 0;
            const periodKey = `${reduction.mark.subscriptionBundleId ?? 'plan'}@${period.start.getTime()}`;
            slices.push({ reduction, period, from, to, days, periodKey });
        }
    }
    return slices;
}

/** The entries that already move this reduction in this period. */
function writtenFor(slice: ReductionSlice, entries: readonly Entry[]): Entry[] {
    return entries.filter(
        (entry) =>
            entry.source === 'discount' &&
            entry.sourceRef === slice.reduction.line.sourceKey &&
            entry.periodStart >= slice.period.start &&
            entry.periodStart < slice.period.end,
    );
}

/**
 * The entry that moves a period's reduction by `difference` cents, or null
 * where it is not due yet: charged with the period where the period is charged
 * now, credited from the withdrawal's date where the period was charged
 * before, taken back from the moment the days without the feature end. A
 * credit that grows after its first is booked from the latest moment another
 * reduction of the period stopped by now: the account keeps one entry per
 * moment, and the first credit already holds the withdrawal's date.
 */
function reductionEntry(
    input: ChargeDerivationInput,
    slice: ReductionSlice,
    difference: number,
    entries: readonly Entry[],
    endsInPeriod: readonly Date[],
): NewSubscriberCharge | null {
    const { reduction, period, from, to } = slice;
    const charge = (origin: NewSubscriberCharge['origin'], start: Date) =>
        chargeOf(input, reduction.contract, reduction.line, {
            origin,
            source: 'discount',
            sourceRef: reduction.line.sourceKey,
            period: { start, end: period.end },
            amountNet: difference / CENTS,
            bookedAt: start,
        });
    if (difference < 0) {
        if (period.due) return charge(period.charge.origin, period.start);
        if (from > input.now) return null;
        const creditedAt = (at: Date) =>
            writtenFor(slice, entries).some(
                (entry) => entry.origin === 'credit' && sameInstant(entry.periodStart, at),
            );
        if (!creditedAt(from)) return charge('credit', from);
        const freed = endsInPeriod
            .filter((end) => end > from && end <= input.now && !creditedAt(end))
            .sort((a, b) => b.getTime() - a.getTime())[0];
        return charge('credit', freed ?? from);
    }
    return to <= input.now ? charge('reductionTakenBack', to) : null;
}

/**
 * Credits the unused rest of each period that a line ending at once cuts
 * short: the plan and every booking where the subscription ended, the booking
 * alone where only it did. Net of every discount the period carried but a
 * withdrawal's reduction, which takes back its own days.
 */
function unusedRestCredits(
    input: ChargeDerivationInput,
    entries: readonly Entry[],
    dueSet: ReadonlySet<Entry>,
): NewSubscriberCharge[] {
    const credits: NewSubscriberCharge[] = [];
    const subscriptionEnd = endedAtOnceOf(input, null);
    const lines: Array<{ periods: LinePeriod[]; at: Date | null }> = [
        { periods: planPeriods(input, entries, dueSet), at: subscriptionEnd },
        ...input.bookings.map((booking) => ({
            periods: bookingPeriods(input, entries, dueSet, booking.id),
            at: endedAtOnceOf(input, booking.id),
        })),
    ];
    for (const { periods, at } of lines) {
        if (!at) continue;
        // The latest period holding the moment: a change into a longer rhythm
        // started one of its own inside the period it replaced.
        const period = periods.filter((one) => one.start < at && at < one.end).at(-1);
        if (!period) continue;
        const rest = othersOf(period, entries, input).reduce(
            (sum, entry) =>
                sum +
                cents(
                    prorate(
                        entry.amountNet,
                        remainingDays(at, { ...period, start: entry.periodStart }),
                        Math.max(1, remainingDays(entry.periodStart, period)),
                    ),
                ),
            0,
        );
        // Never more than the period still costs once its reductions — those
        // written and those this derivation takes back — are counted: the rest
        // and the reduction are each rounded to the cent, and the two halves of
        // one cent must not credit a cent nobody paid.
        const stillCosts =
            netOfOthers(period, entries, input) +
            withdrawalReductionsIn(period, entries, input).reduce(
                (sum, entry) => sum + cents(entry.amountNet),
                0,
            );
        const credit = Math.min(rest, stillCosts);
        if (credit <= 0) continue;
        const line = lineById(input.contracts, period.charge.contractLineItemId);
        const contract = input.contracts.find((one) => one.id === period.charge.contractId);
        if (!line || !contract) continue;
        credits.push(
            chargeOf(input, contract, line, {
                origin: 'credit',
                source: period.charge.source,
                sourceRef: period.charge.sourceRef,
                period: { start: at, end: period.end },
                amountNet: -credit / CENTS,
                bookedAt: at,
            }),
        );
    }
    return credits;
}

/** Each reduction line, with the earliest contract that records it. */
function reductionLines(contracts: readonly SubscriptionContractRecord[]): ReductionLine[] {
    const found = new Map<string, ReductionLine>();
    for (const contract of [...contracts].sort(
        (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
    )) {
        for (const line of contract.lineItems) {
            const mark = withdrawalReductionOf(line);
            if (!mark || found.has(line.sourceKey)) continue;
            found.set(line.sourceKey, { contract, line, mark });
        }
    }
    return [...found.values()];
}

/**
 * Whether the line that priced a period is the one the reduction reduces: the
 * plan it names in the rhythm it was agreed in, or the booking's in that
 * rhythm — on whichever version of them, as long as that version grants the
 * feature.
 */
function reduces(
    reduction: ReductionLine,
    priced: ContractLineItemRecord,
    featureKey: string,
    input: ChargeDerivationInput,
): boolean {
    if (priced.billingCycle !== reduction.line.billingCycle) return false;
    if (reduction.mark.subscriptionBundleId === null) {
        if (priced.kind !== 'plan' || priced.sourceKey !== reduction.mark.key) return false;
    } else if (priced.kind !== 'bundle') {
        return false;
    }
    return (input.lineGrants ?? grantsByItsSnapshot)(priced, featureKey);
}

function grantsByItsSnapshot(line: ContractLineItemRecord, featureKey: string): boolean {
    return line.featuresSnapshot.includes(featureKey);
}

/** The whole plan periods the account holds or is about to, the earliest first. */
function planPeriods(
    input: ChargeDerivationInput,
    entries: readonly Entry[],
    dueSet: ReadonlySet<Entry>,
): LinePeriod[] {
    return entries
        .filter((entry) => isWholePlanPeriod(entry, entries, input.subscription.id))
        .map((entry) => ({
            start: entry.periodStart,
            end: entry.periodEnd,
            charge: entry,
            due: dueSet.has(entry),
            cycleDays: daysBetween(entry.periodStart, entry.periodEnd),
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * The whole periods of one booking the account holds or is about to: its
 * first, short one priced as a share of the whole cycle it ends, and each
 * renewal.
 */
function bookingPeriods(
    input: ChargeDerivationInput,
    entries: readonly Entry[],
    dueSet: ReadonlySet<Entry>,
    subscriptionBundleId: string,
): LinePeriod[] {
    const booking = input.bookings.find((one) => one.id === subscriptionBundleId);
    if (!booking) return [];
    const cycle: BillingCycle = booking.billingCycle ?? input.subscription.billingCycle;
    return entries
        .filter(
            (entry) =>
                entry.source === 'bundle' &&
                entry.sourceRef === subscriptionBundleId &&
                (entry.origin === 'bundleBooking' || entry.origin === 'renewal'),
        )
        .map((entry) => ({
            start: entry.periodStart,
            end: entry.periodEnd,
            charge: entry,
            due: dueSet.has(entry),
            cycleDays: daysBetween(
                bundleFirstPeriodStart(entry.periodEnd, cycle, input.subscription.anchorDay),
                entry.periodEnd,
            ),
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * The moment a plan period stopped being the subscription's own: a change into
 * a longer rhythm starts a period of its own inside it, and credits what is
 * left of this one at its price — so this one's reduction ends there too.
 */
function replacedAt(
    period: LinePeriod,
    periods: readonly LinePeriod[],
    reduction: ReductionLine,
): Date | null {
    if (reduction.mark.subscriptionBundleId !== null) return null;
    const replacing = periods.find(
        (other) => other.start > period.start && other.start < period.end,
    );
    return replacing?.start ?? null;
}

/**
 * When the subscription (null) or a booking ended at once, where the account
 * is told so and the end is the one recorded. A booking ends at once with its
 * subscription as well.
 */
function endedAtOnceOf(
    input: ChargeDerivationInput,
    subscriptionBundleId: string | null,
): Date | null {
    const ended = input.endedAtOnce ?? [];
    const subscriptionEnd =
        ended.find(
            (one) =>
                one.subscriptionBundleId === null &&
                input.subscription.endsAt?.getTime() === one.at.getTime(),
        )?.at ?? null;
    if (subscriptionBundleId === null) return subscriptionEnd;
    const booking = input.bookings.find((one) => one.id === subscriptionBundleId);
    const bookingEnd =
        ended.find(
            (one) =>
                one.subscriptionBundleId === subscriptionBundleId &&
                booking?.canceledEffectiveAt?.getTime() === one.at.getTime(),
        )?.at ?? null;
    return earliestOf(subscriptionEnd, bookingEnd);
}

/**
 * The entries of a period other than a withdrawal's: its charge, what a change
 * inside it added up to its end, and the discounts it carried — a held add-on
 * price on its booking, every other discount on the plan.
 */
function othersOf(
    period: LinePeriod,
    entries: readonly Entry[],
    input: ChargeDerivationInput,
): Entry[] {
    const { source, sourceRef } = period.charge;
    return entries.filter((entry) => {
        if (entry.periodStart < period.start || entry.periodStart >= period.end) return false;
        if (entry.source === source && entry.sourceRef === sourceRef) {
            // The period's own charge, and what a change inside it added up to
            // its end; never a period of its own, nor a credit.
            return (
                entry === period.charge ||
                ((entry.origin === 'planChange' || entry.origin === 'bundleChange') &&
                    entry.periodStart > period.start &&
                    entry.periodEnd.getTime() === period.end.getTime())
            );
        }
        if (entry.source !== 'discount' || entry.periodEnd.getTime() !== period.end.getTime()) {
            return false;
        }
        const line = lineById(input.contracts, entry.contractLineItemId);
        if (!line || withdrawalReductionOf(line)) return false;
        const hold = addOnHoldOf(line);
        return source === 'bundle' ? hold?.subscriptionBundleId === sourceRef : !hold;
    });
}

/** The reductions of withdrawals in a period of its line: written, or derived in this run. */
function withdrawalReductionsIn(
    period: LinePeriod,
    entries: readonly Entry[],
    input: ChargeDerivationInput,
): Entry[] {
    const { source, sourceRef } = period.charge;
    return entries.filter((entry) => {
        if (entry.source !== 'discount') return false;
        if (entry.periodStart < period.start || entry.periodStart >= period.end) return false;
        const line = lineById(input.contracts, entry.contractLineItemId);
        const reduction = line ? withdrawalReductionOf(line) : null;
        if (!reduction) return false;
        return source === 'bundle'
            ? reduction.subscriptionBundleId === sourceRef
            : reduction.subscriptionBundleId === null;
    });
}

/** What a period costs after its other discounts, in cents. */
function netOfOthers(
    period: LinePeriod,
    entries: readonly Entry[],
    input: ChargeDerivationInput,
): number {
    return othersOf(period, entries, input).reduce((sum, entry) => sum + cents(entry.amountNet), 0);
}

/** Whole days from `at` to the period's end, as the platform's proration counts them. */
function remainingDays(at: Date, period: ChargePeriod): number {
    return Math.max(
        0,
        Math.min(periodDays(period), Math.round((period.end.getTime() - at.getTime()) / DAY_MS)),
    );
}

function periodDays(period: ChargePeriod): number {
    return daysBetween(period.start, period.end);
}

function daysBetween(from: Date, to: Date): number {
    return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

function cents(amount: number): number {
    return toCents(amount);
}

function laterOf(a: Date, b: Date): Date {
    return b > a ? b : a;
}

function earliestOf(...dates: Array<Date | null>): Date | null {
    return dates.reduce<Date | null>(
        (earliest, date) =>
            date !== null && (earliest === null || date < earliest) ? date : earliest,
        null,
    );
}
