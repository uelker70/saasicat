// Which charges a subscription's records give rise to. Pure: the service reads
// the subscription, its contracts, its bookings and what the journal already
// holds, and this works out what is due and not yet written.
//
// Every charge is derived from records that exist anyway — the contract in
// force prices each line, the billing windows say which periods there are, the
// bookings say which add-ons run — so a charge that was missed, or whose write
// failed, is found again by the next derivation. Nothing here remembers.

import type {
    BillingCycle,
    ContractLineItemRecord,
    NewSubscriberCharge,
    SubscriberChargeOrigin,
    SubscriberChargeRecord,
    SubscriptionBundleRecord,
    SubscriptionContractRecord,
} from '@saasicat/core';

import { advanceOneCycle, retreatOneCycle } from '../billing-period.js';
import { bundleFirstPeriodStart } from '../bundle-period.js';
import { computeProration } from '../proration.js';

/** A billing period, start inclusive, end exclusive. */
export interface ChargePeriod {
    start: Date;
    end: Date;
}

/** The subscription as the derivation needs it. */
export interface ChargedSubscription {
    id: string;
    tenantId: string;
    status: string;
    billingCycle: BillingCycle;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    /** The day of the month the plan is billed on, where it is known. */
    anchorDay: number | null;
    /** When a declared cancellation takes effect; no period starting then or later is charged. */
    endsAt: Date | null;
}

export interface ChargeDerivationInput {
    now: Date;
    subscriberId: string;
    subscription: ChargedSubscription;
    /** Every contract of the tenant, whatever its status. */
    contracts: readonly SubscriptionContractRecord[];
    /** Every booking of the subscription, ended ones included. */
    bookings: readonly SubscriptionBundleRecord[];
    /** What the journal already holds for the subscription. */
    written: readonly SubscriberChargeRecord[];
}

/** Charges written for a whole period rather than a part of one. */
const PERIOD_ORIGINS: readonly SubscriberChargeOrigin[] = [
    'activation',
    'renewal',
    'bundleBooking',
];

/** How many cycles a derivation walks at most, so a corrupt date cannot hang it. */
const MAX_CYCLES = 600;

const CENTS = 100;

/**
 * The charges due for a subscription and not yet in its journal: the plan's
 * periods, each add-on's periods, and the discount a concluded offer carried
 * for as long as it applies.
 */
export function deriveDueCharges(input: ChargeDerivationInput): NewSubscriberCharge[] {
    const planCharges = derivePlanCharges(input);
    return [
        ...planCharges,
        ...deriveDiscountCharges(input, planCharges),
        ...deriveBundleCharges(input),
    ];
}

// ── The plan ─────────────────────────────────────────────────────────────

function derivePlanCharges(input: ChargeDerivationInput): NewSubscriberCharge[] {
    const { subscription } = input;
    if (subscription.status === 'TRIAL') return [];
    const window = windowOf(subscription.currentPeriodStart, subscription.currentPeriodEnd);
    if (!window) return [];

    const firstContract = earliest(input.contracts);
    const charges: NewSubscriberCharge[] = [];
    for (const period of periodsToCharge({
        window,
        lastEnd: lastPeriodEnd(input.written, 'plan', subscription.id),
        cycle: subscription.billingCycle,
        anchorDay: subscription.anchorDay,
        now: input.now,
        endsAt: subscription.endsAt,
    })) {
        const priced = lineFor(
            input.contracts,
            period,
            (item) =>
                item.kind === 'plan' && item.billingCycle === rhythmOf(subscription.billingCycle),
        );
        if (!priced) continue;
        const { contract, line } = priced;
        const opensFirstContract =
            firstContract !== null &&
            period.start <= firstContract.effectiveFrom &&
            firstContract.effectiveFrom < period.end;
        charges.push(
            chargeOf(input, contract, line, {
                origin: opensFirstContract ? 'activation' : 'renewal',
                source: 'plan',
                sourceRef: subscription.id,
                period,
                amountNet: line.priceNet,
                bookedAt: period.start,
            }),
        );
    }
    return charges;
}

// ── The add-ons ──────────────────────────────────────────────────────────

function deriveBundleCharges(input: ChargeDerivationInput): NewSubscriberCharge[] {
    const { subscription } = input;
    const charges: NewSubscriberCharge[] = [];
    for (const booking of input.bookings) {
        const window = windowOf(booking.currentPeriodStart, booking.currentPeriodEnd);
        if (!window) continue;
        const cycle = booking.billingCycle ?? subscription.billingCycle;
        const endsAt = earlierOf(booking.canceledEffectiveAt, subscription.endsAt);
        for (const period of periodsToCharge({
            window,
            lastEnd: lastPeriodEnd(input.written, 'bundle', booking.id),
            cycle,
            anchorDay: subscription.anchorDay,
            now: input.now,
            endsAt,
        })) {
            const priced = lineFor(
                input.contracts,
                period,
                (item) =>
                    item.kind === 'bundle' && item.sourceVersionId === booking.bundleVersionId,
            );
            if (!priced) continue;
            const { contract, line } = priced;
            // The booking's first period is short, and charged for exactly
            // that stretch of a whole cycle — the same arithmetic the preview
            // quoted (`SC-BUN-003`, `SC-PRIC-002`).
            const isFirst = period.start.getTime() === booking.startedAt.getTime();
            charges.push(
                chargeOf(input, contract, line, {
                    origin: isFirst ? 'bundleBooking' : 'renewal',
                    source: 'bundle',
                    sourceRef: booking.id,
                    period,
                    amountNet: isFirst
                        ? computeProration({
                              periodStart: bundleFirstPeriodStart(
                                  period.end,
                                  cycle,
                                  subscription.anchorDay,
                              ),
                              periodEnd: period.end,
                              now: period.start,
                              currentPriceNet: 0,
                              targetPriceNet: line.priceNet,
                          }).prorataDeltaNet
                        : line.priceNet,
                    bookedAt: period.start,
                }),
            );
        }
    }
    return charges;
}

// ── The discount ─────────────────────────────────────────────────────────

/**
 * What the concluded offer took off, charged beside each plan period it
 * applies to.
 *
 * Read from the contract the offer was concluded as, not from the one in
 * force: a contract written again later carries no discount line, and the
 * discount runs for the duration it was concluded with (`SC-PROMO-015`).
 * Which periods that is follows from the snapshot on the line: a promo code
 * for its duration — once, a number of months, or a number of billing cycles —
 * an `intro` or `freeMonths` promotion for its months, and a `percent` or
 * `amount` promotion, which states no duration, for the first period only.
 */
function deriveDiscountCharges(
    input: ChargeDerivationInput,
    planCharges: readonly NewSubscriberCharge[],
): NewSubscriberCharge[] {
    const concluded =
        [...input.contracts]
            .filter((contract) => contract.originalOfferId !== null)
            .sort(byEffectiveFrom)[0] ?? null;
    if (!concluded) return [];
    const discounts = concluded.lineItems.filter((item) => item.kind === 'discount');
    if (discounts.length === 0) return [];

    const { subscription } = input;
    const first = firstPeriodStart(subscription, concluded.effectiveFrom);
    if (!first) return [];

    const charges: NewSubscriberCharge[] = [];
    for (const planCharge of planCharges) {
        const index = cyclesBetween(first, planCharge.periodStart, subscription);
        if (index === null) continue;
        for (const line of discounts) {
            const amount = discountFor(
                line,
                index,
                first,
                planCharge.periodStart,
                subscription.anchorDay,
            );
            if (amount === 0) continue;
            charges.push(
                chargeOf(input, concluded, line, {
                    origin: planCharge.origin,
                    source: 'discount',
                    sourceRef: line.sourceKey,
                    period: { start: planCharge.periodStart, end: planCharge.periodEnd },
                    amountNet: -amount,
                    bookedAt: planCharge.bookedAt,
                }),
            );
        }
    }
    return charges;
}

/** What a discount line takes off in the period `index` cycles after `first`, as a positive amount. */
function discountFor(
    line: ContractLineItemRecord,
    index: number,
    first: Date,
    periodStart: Date,
    anchorDay: number | null,
): number {
    const snapshots = discountSnapshotsOf(line);
    if (!snapshots) {
        // A discount line with nothing saying how long it runs: once.
        return index === 0 ? -line.priceNet : 0;
    }
    const withinMonths = (months: number) => periodStart < monthsAfter(first, months, anchorDay);
    let cents = 0;
    for (const promotion of snapshots.promotions) {
        const months = promotionMonths(promotion.value);
        const applies =
            promotion.type === 'intro' || promotion.type === 'freeMonths'
                ? months !== null && withinMonths(months)
                : index === 0;
        if (applies) cents += toCents(promotion.resolvedAmountNet);
    }
    const code = snapshots.promoCode;
    if (code) {
        const applies =
            code.durationType === 'MONTHS'
                ? withinMonths(code.durationValue ?? 0)
                : code.durationType === 'BILLING_CYCLES'
                  ? index < (code.durationValue ?? 0)
                  : index === 0;
        if (applies) cents += toCents(code.resolvedAmountNet);
    }
    return cents / CENTS;
}

interface DiscountSnapshots {
    promotions: { type: string; value: unknown; resolvedAmountNet: number }[];
    promoCode: {
        durationType: string | null;
        durationValue: number | null;
        resolvedAmountNet: number;
    } | null;
}

/**
 * The promotions and the promo code a generated discount line was built from,
 * or null for a line that carries none — one an application wrote itself.
 */
function discountSnapshotsOf(line: ContractLineItemRecord): DiscountSnapshots | null {
    const metadata = line.metadata;
    if (!isRecord(metadata) || metadata.generated !== true) return null;
    const promotions = Array.isArray(metadata.promotionSnapshots)
        ? metadata.promotionSnapshots.filter(isRecord).map((snapshot) => ({
              type: typeof snapshot.type === 'string' ? snapshot.type : '',
              value: snapshot.value,
              resolvedAmountNet: numberOr0(snapshot.resolvedAmountNet),
          }))
        : [];
    const code = isRecord(metadata.promoCodeSnapshot) ? metadata.promoCodeSnapshot : null;
    return {
        promotions,
        promoCode: code
            ? {
                  durationType: typeof code.durationType === 'string' ? code.durationType : null,
                  durationValue: typeof code.durationValue === 'number' ? code.durationValue : null,
                  resolvedAmountNet: numberOr0(code.resolvedAmountNet),
              }
            : null,
    };
}

function promotionMonths(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (isRecord(value) && typeof value.months === 'number') return value.months;
    return null;
}

// ── Periods ──────────────────────────────────────────────────────────────

/**
 * The periods of one source still to charge: those after the last one charged,
 * up to and including the window it is in now, each a whole cycle on the
 * plan's day. None that starts after `now`, or at or after `endsAt`.
 *
 * A window a renewal skipped ahead of is walked cycle by cycle from where the
 * journal left off. A walk that does not land on the window's start — the
 * window was opened afresh, as a plan change into a longer rhythm does — stops
 * short rather than inventing a period of a length nobody agreed to.
 */
function periodsToCharge(args: {
    window: ChargePeriod;
    lastEnd: Date | null;
    cycle: BillingCycle;
    anchorDay: number | null;
    now: Date;
    endsAt: Date | null;
}): ChargePeriod[] {
    const { window, lastEnd, cycle, anchorDay, now, endsAt } = args;
    const periods: ChargePeriod[] = [];
    if (lastEnd && lastEnd < window.start) {
        let start = lastEnd;
        for (let step = 0; step < MAX_CYCLES && start < window.start; step++) {
            const end = advanceOneCycle(start, cycle, anchorDay ?? undefined);
            if (end > window.start) break;
            periods.push({ start, end });
            start = end;
        }
    }
    if (!lastEnd || lastEnd <= window.start) periods.push(window);
    return periods.filter((period) => period.start <= now && (!endsAt || period.start < endsAt));
}

/** The end of the latest whole period charged for one source. */
function lastPeriodEnd(
    written: readonly SubscriberChargeRecord[],
    source: 'plan' | 'bundle',
    sourceRef: string,
): Date | null {
    let last: Date | null = null;
    for (const charge of written) {
        if (charge.source !== source || charge.sourceRef !== sourceRef) continue;
        if (!PERIOD_ORIGINS.includes(charge.origin)) continue;
        if (!last || charge.periodEnd > last) last = charge.periodEnd;
    }
    return last;
}

/** The start of the plan period in which `at` falls, walked back from the current window. */
function firstPeriodStart(subscription: ChargedSubscription, at: Date): Date | null {
    let start = subscription.currentPeriodStart;
    if (!start) return null;
    for (let step = 0; step < MAX_CYCLES && start > at; step++) {
        start = retreatOneCycle(
            start,
            subscription.billingCycle,
            subscription.anchorDay ?? undefined,
        );
    }
    return start > at ? null : start;
}

/** How many whole cycles lie between `from` and `to`, or null where `to` is not on the walk. */
function cyclesBetween(from: Date, to: Date, subscription: ChargedSubscription): number | null {
    let at = from;
    for (let step = 0; step < MAX_CYCLES; step++) {
        if (at.getTime() === to.getTime()) return step;
        if (at > to) return null;
        at = advanceOneCycle(at, subscription.billingCycle, subscription.anchorDay ?? undefined);
    }
    return null;
}

function monthsAfter(from: Date, months: number, anchorDay: number | null): Date {
    let at = from;
    for (let step = 0; step < months; step++) {
        at = advanceOneCycle(at, 'MONTHLY', anchorDay ?? from.getUTCDate());
    }
    return at;
}

// ── Contracts ────────────────────────────────────────────────────────────

/**
 * The line a period is priced from: in the contract in force when the period
 * starts, or — where that contract does not name it — in the first contract
 * that takes effect within the period and does.
 *
 * The second case is the ordinary one at the start of something: a window is
 * opened and the contract for it is written a moment later, and an add-on is
 * booked before the contract that takes it in. A contract taking effect after
 * the period has ended prices nothing in it.
 */
function lineFor(
    contracts: readonly SubscriptionContractRecord[],
    period: ChargePeriod,
    matches: (line: ContractLineItemRecord) => boolean,
): { contract: SubscriptionContractRecord; line: ContractLineItemRecord } | null {
    const inForce = contractInForce(contracts, period.start);
    const inForceLine = inForce?.lineItems.find(matches);
    if (inForce && inForceLine) return { contract: inForce, line: inForceLine };
    for (const contract of [...contracts].sort(byEffectiveFrom)) {
        if (contract.status === 'scheduled') continue;
        if (contract.effectiveFrom < period.start || contract.effectiveFrom >= period.end) continue;
        const line = contract.lineItems.find(matches);
        if (line) return { contract, line };
    }
    return null;
}

/** The contract whose window holds `at` — the latest to take effect, where two do. */
function contractInForce(
    contracts: readonly SubscriptionContractRecord[],
    at: Date,
): SubscriptionContractRecord | null {
    return (
        [...contracts]
            .filter(
                (contract) =>
                    contract.status !== 'scheduled' &&
                    contract.effectiveFrom <= at &&
                    (contract.effectiveUntil === null || at < contract.effectiveUntil),
            )
            .sort(byEffectiveFrom)
            .at(-1) ?? null
    );
}

function earliest(
    contracts: readonly SubscriptionContractRecord[],
): SubscriptionContractRecord | null {
    return [...contracts].sort(byEffectiveFrom)[0] ?? null;
}

function byEffectiveFrom(a: SubscriptionContractRecord, b: SubscriptionContractRecord): number {
    return a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
}

// ── Helpers ──────────────────────────────────────────────────────────────

function chargeOf(
    input: ChargeDerivationInput,
    contract: SubscriptionContractRecord,
    line: ContractLineItemRecord,
    charge: {
        origin: SubscriberChargeOrigin;
        source: NewSubscriberCharge['source'];
        sourceRef: string;
        period: ChargePeriod;
        amountNet: number;
        bookedAt: Date;
    },
): NewSubscriberCharge {
    return {
        subscriberId: input.subscriberId,
        tenantId: input.subscription.tenantId,
        subscriptionId: input.subscription.id,
        contractId: contract.id,
        contractLineItemId: line.id,
        origin: charge.origin,
        source: charge.source,
        sourceRef: charge.sourceRef,
        periodStart: charge.period.start,
        periodEnd: charge.period.end,
        currency: line.currency,
        // Rounded once, here, where it is derived (`SC-PRIC-018`).
        amountNet: toCents(charge.amountNet) / CENTS,
        bookedAt: charge.bookedAt,
    };
}

function windowOf(start: Date | null, end: Date | null): ChargePeriod | null {
    return start && end && start < end ? { start, end } : null;
}

function earlierOf(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
}

function rhythmOf(cycle: BillingCycle): 'monthly' | 'yearly' {
    return cycle === 'YEARLY' ? 'yearly' : 'monthly';
}

function toCents(amount: number): number {
    return Math.round(amount * CENTS);
}

function numberOr0(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
