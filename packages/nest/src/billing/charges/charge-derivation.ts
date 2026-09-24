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
    /** When the subscription started, where the application records it. */
    startedAt: Date | null;
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
 *
 * Nothing is reconstructed from before the account begins, which is the first
 * plan period it charged — or, before it charged one, the plan's current
 * window. The records do not say where the paid periods began: a contract may
 * be concluded during a trial and priced from its end, and a window and the
 * contract written for it are moments apart, in either order. A guess there
 * charges a trial. Starting from what the subscription says it is in now errs
 * the other way, and only where a window moved before anything charged it.
 */
export function deriveDueCharges(input: ChargeDerivationInput): NewSubscriberCharge[] {
    const planCharges = derivePlanCharges(input);
    return [
        ...planCharges,
        ...deriveDiscountCharges(input, planCharges),
        ...deriveBundleCharges(input, accountStart(input)),
    ];
}

/**
 * The running bookings the contract in force at `now` does not name — what a
 * contract write that failed after a booking leaves behind. Empty where no
 * contract is in force: a subscription without one gets no charges, and no
 * contract either, from here.
 */
export function bookingsTheContractMisses(
    contracts: readonly SubscriptionContractRecord[],
    bookings: readonly SubscriptionBundleRecord[],
    now: Date,
): SubscriptionBundleRecord[] {
    const inForce = contractInForce(contracts, now);
    if (!inForce) return [];
    return bookings.filter(
        (booking) =>
            booking.currentPeriodEnd !== null &&
            (booking.canceledEffectiveAt === null || booking.canceledEffectiveAt > now) &&
            !inForce.lineItems.some(
                (item) =>
                    item.kind === 'bundle' && item.sourceVersionId === booking.bundleVersionId,
            ),
    );
}

// ── The plan ─────────────────────────────────────────────────────────────

function derivePlanCharges(input: ChargeDerivationInput): NewSubscriberCharge[] {
    const { subscription } = input;
    if (subscription.status === 'TRIAL') return [];
    const window = windowOf(subscription.currentPeriodStart, subscription.currentPeriodEnd);
    if (!window) return [];

    const priced = periodsToCharge({
        window,
        from: lastPeriodEnd(input.written, 'plan', subscription.id) ?? window.start,
        cycle: subscription.billingCycle,
        anchorDay: subscription.anchorDay,
        input,
        endsAt: subscription.endsAt,
    }).flatMap((period) => {
        const found = lineFor(
            input.contracts,
            period,
            (item) =>
                item.kind === 'plan' && item.billingCycle === rhythmOf(subscription.billingCycle),
        );
        return found ? [{ period, ...found }] : [];
    });

    // A period is the subscription's first when it holds the subscription's
    // start or the moment its first contract took effect. Either alone misses
    // a path: a contract concluded during a trial takes effect before the
    // first paid window, and not every application records a start.
    const firstContract = earliest(input.contracts);
    const opensSubscription = (period: ChargePeriod) =>
        holds(period, subscription.startedAt) ||
        holds(period, firstContract?.effectiveFrom ?? null);
    return priced.map(({ period, contract, line }) =>
        chargeOf(input, contract, line, {
            origin: opensSubscription(period) ? 'activation' : 'renewal',
            source: 'plan',
            sourceRef: subscription.id,
            period,
            amountNet: line.priceNet,
            bookedAt: period.start,
        }),
    );
}

/**
 * Where the account begins: the first plan period it charged, or — before it
 * charged one — the plan's current window. Null in a trial with nothing
 * charged, or without a window: then nothing is charged at all.
 */
function accountStart(input: ChargeDerivationInput): Date | null {
    const { subscription } = input;
    const firstCharged = firstPlanPeriodStart(input.written, subscription.id);
    if (firstCharged) return firstCharged;
    if (subscription.status === 'TRIAL') return null;
    return windowOf(subscription.currentPeriodStart, subscription.currentPeriodEnd)?.start ?? null;
}

// ── The add-ons ──────────────────────────────────────────────────────────

function deriveBundleCharges(
    input: ChargeDerivationInput,
    accountBegins: Date | null,
): NewSubscriberCharge[] {
    if (!accountBegins) return [];
    const { subscription } = input;
    const anchorDay = subscription.anchorDay;
    const charges: NewSubscriberCharge[] = [];
    for (const booking of input.bookings) {
        const window = windowOf(booking.currentPeriodStart, booking.currentPeriodEnd);
        if (!window) continue;
        const cycle = booking.billingCycle ?? subscription.billingCycle;
        const endsAt = earlierOf(booking.canceledEffectiveAt, subscription.endsAt);
        const lastEnd = lastPeriodEnd(input.written, 'bundle', booking.id);
        // A booking carries its start, so its periods are rebuilt from there —
        // but not from before the account begins: a booking made in a trial
        // runs from the first period the plan is charged for.
        const chainStart = laterOf(booking.startedAt, accountBegins);
        const periods = lastEnd
            ? periodsToCharge({ window, from: lastEnd, cycle, anchorDay, input, endsAt })
            : [
                  ...firstBundlePeriod(window, chainStart, cycle, anchorDay),
                  ...periodsToCharge({
                      window,
                      from: firstBoundaryAfter(window, chainStart, cycle, anchorDay),
                      cycle,
                      anchorDay,
                      input,
                      endsAt,
                  }),
              ].filter((period) => isChargeable(period, input, endsAt));
        for (const period of periods) {
            const priced = lineFor(
                input.contracts,
                period,
                (item) =>
                    item.kind === 'bundle' && item.sourceVersionId === booking.bundleVersionId,
            );
            if (!priced) continue;
            const { contract, line } = priced;
            charges.push(
                chargeOf(input, contract, line, {
                    origin:
                        !lastEnd && sameInstant(period.start, chainStart)
                            ? 'bundleBooking'
                            : 'renewal',
                    source: 'bundle',
                    sourceRef: booking.id,
                    period,
                    // Every period is charged for its share of the whole cycle
                    // it ends, which is all of it except for the short first
                    // one — the same arithmetic the preview quoted
                    // (`SC-BUN-003`, `SC-PRIC-002`).
                    amountNet: computeProration({
                        periodStart: bundleFirstPeriodStart(period.end, cycle, anchorDay),
                        periodEnd: period.end,
                        now: period.start,
                        currentPriceNet: 0,
                        targetPriceNet: line.priceNet,
                    }).prorataDeltaNet,
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

    // Counted from the first plan period the concluded contract prices, not
    // from the day it was concluded: an offer concluded during a trial is
    // discounted from the first period that is paid.
    const { subscription } = input;
    const first = firstPricedBy(concluded.id, input.written, planCharges);
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
 * The periods of one source still to charge: from `from` — where the journal
 * left off, or where the source's chain begins — up to and including the
 * window it is in now, each a whole cycle on the plan's day. None that starts
 * after `now`, or at or after `endsAt`.
 *
 * A window a renewal skipped ahead of is walked cycle by cycle. A walk that
 * does not land on the window's start — the window was opened afresh, as a
 * plan change into a longer rhythm does — stops short rather than inventing a
 * period of a length nobody agreed to.
 */
function periodsToCharge(args: {
    window: ChargePeriod;
    from: Date;
    cycle: BillingCycle;
    anchorDay: number | null;
    input: ChargeDerivationInput;
    endsAt: Date | null;
}): ChargePeriod[] {
    const { window, from, cycle, anchorDay, input, endsAt } = args;
    const periods: ChargePeriod[] = [];
    let start = from;
    for (let step = 0; step < MAX_CYCLES && start < window.start; step++) {
        const end = advanceOneCycle(start, cycle, anchorDay ?? undefined);
        if (end > window.start) break;
        periods.push({ start, end });
        start = end;
    }
    if (from <= window.start) periods.push(window);
    return periods.filter((period) => isChargeable(period, input, endsAt));
}

function isChargeable(
    period: ChargePeriod,
    input: ChargeDerivationInput,
    endsAt: Date | null,
): boolean {
    return (
        period.start < period.end && period.start <= input.now && (!endsAt || period.start < endsAt)
    );
}

/** The first boundary after `start` on the chain that leads to `window`. */
function firstBoundaryAfter(
    window: ChargePeriod,
    start: Date,
    cycle: BillingCycle,
    anchorDay: number | null,
): Date {
    if (window.start <= start) return window.end;
    let boundary = window.start;
    for (let step = 0; step < MAX_CYCLES; step++) {
        const before = retreatOneCycle(boundary, cycle, anchorDay ?? undefined);
        if (before <= start) break;
        boundary = before;
    }
    return boundary;
}

/** A booking's first period: from where its chain begins to the first boundary after it. */
function firstBundlePeriod(
    window: ChargePeriod,
    start: Date,
    cycle: BillingCycle,
    anchorDay: number | null,
): ChargePeriod[] {
    return [{ start, end: firstBoundaryAfter(window, start, cycle, anchorDay) }];
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

/** The start of the earliest whole plan period the journal holds. */
function firstPlanPeriodStart(
    written: readonly SubscriberChargeRecord[],
    subscriptionId: string,
): Date | null {
    let first: Date | null = null;
    for (const charge of written) {
        if (charge.source !== 'plan' || charge.sourceRef !== subscriptionId) continue;
        if (!PERIOD_ORIGINS.includes(charge.origin)) continue;
        if (!first || charge.periodStart < first) first = charge.periodStart;
    }
    return first;
}

/**
 * The start of the first plan period a contract prices, among those already
 * written and those about to be.
 */
function firstPricedBy(
    contractId: string,
    written: readonly SubscriberChargeRecord[],
    due: readonly { contractId: string; periodStart: Date }[],
): Date | null {
    let first: Date | null = null;
    const planPeriods = written.filter(
        (charge) => charge.source === 'plan' && PERIOD_ORIGINS.includes(charge.origin),
    );
    for (const charge of [...planPeriods, ...due]) {
        if (charge.contractId !== contractId) continue;
        if (!first || charge.periodStart < first) first = charge.periodStart;
    }
    return first;
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

function laterOf(a: Date, b: Date): Date {
    return b > a ? b : a;
}

function sameInstant(a: Date, b: Date): boolean {
    return a.getTime() === b.getTime();
}

function holds(period: ChargePeriod, at: Date | null): boolean {
    return at !== null && period.start <= at && at < period.end;
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
