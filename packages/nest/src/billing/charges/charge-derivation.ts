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
import { computeNewPeriodCharge, computeProration } from '../proration.js';

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

/**
 * Charges written for a whole period rather than a part of one — including the
 * new period an upgrade into a longer rhythm opens, which is charged as a
 * `planChange`. The difference a same-rhythm upgrade adds is a `planChange`
 * too, but for the rest of a period another charge already covers; see
 * `isDifference`.
 */
const PERIOD_ORIGINS: readonly SubscriberChargeOrigin[] = [
    'activation',
    'renewal',
    'bundleBooking',
    'planChange',
];

/** A whole plan period, written or about to be, with the rhythm it is priced in. */
interface PlanPeriod {
    charge: Pick<
        NewSubscriberCharge,
        'contractId' | 'periodStart' | 'periodEnd' | 'origin' | 'amountNet' | 'bookedAt'
    >;
    rhythm: Rhythm;
}

type Rhythm = 'monthly' | 'yearly';

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
    const periods = [...writtenPlanPeriods(input), ...planCharges.map(({ period }) => period)];
    return [
        ...planCharges.map(({ charge }) => charge),
        ...deriveUpgradeDifferences(input, periods),
        ...deriveDiscountCharges(input, planCharges, periods),
        ...deriveBundleCharges(input, accountStart(input)),
    ];
}

/**
 * The running bookings the contract in force at `now` does not name — what a
 * contract write that failed after a booking leaves behind. Empty where no
 * contract is in force: a subscription without one gets no charges, and no
 * contract either, from here.
 *
 * Only a booking that started after that contract took effect. A contract
 * written after the booking that still does not name it came from a source
 * that does not name bookings (`sourceVersionId`), and writing it again would
 * write the same contract on every call.
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
            inForce.effectiveFrom < booking.startedAt &&
            booking.currentPeriodEnd !== null &&
            (booking.canceledEffectiveAt === null || booking.canceledEffectiveAt > now) &&
            !inForce.lineItems.some(
                (item) =>
                    item.kind === 'bundle' && item.sourceVersionId === booking.bundleVersionId,
            ),
    );
}

// ── The plan ─────────────────────────────────────────────────────────────

/** A plan charge about to be written, and the period it is. */
interface DuePlanCharge {
    charge: NewSubscriberCharge;
    period: PlanPeriod;
}

function derivePlanCharges(input: ChargeDerivationInput): DuePlanCharge[] {
    const { subscription } = input;
    if (subscription.status === 'TRIAL') return [];
    const window = windowOf(subscription.currentPeriodStart, subscription.currentPeriodEnd);
    if (!window) return [];
    const rhythm = rhythmOf(subscription.billingCycle);
    const isPlanLine = (item: ContractLineItemRecord) =>
        item.kind === 'plan' && item.billingCycle === rhythm;

    const replaced = periodReplacedBy(window, input);
    if (replaced) return newPeriodAfterChange(input, window, replaced, isPlanLine);

    const priced = periodsToCharge({
        window,
        from: lastPeriodEnd(input.written, 'plan', subscription.id) ?? window.start,
        cycle: subscription.billingCycle,
        anchorDay: subscription.anchorDay,
        input,
        endsAt: subscription.endsAt,
    }).flatMap((period) => {
        const found = lineFor(input.contracts, period, isPlanLine);
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
    return priced.map(({ period, contract, line }) => {
        const charge = chargeOf(input, contract, line, {
            origin: opensSubscription(period) ? 'activation' : 'renewal',
            source: 'plan',
            sourceRef: subscription.id,
            period,
            amountNet: line.priceNet,
            bookedAt: period.start,
        });
        return { charge, period: { charge, rhythm } };
    });
}

// ── The plan change ──────────────────────────────────────────────────────

/**
 * The whole period the current window was opened inside, where it was: an
 * upgrade into a longer rhythm starts its period on the day of the change
 * (`SC-CHG-021`), inside one the journal already charged. Null where the
 * window follows on from the journal.
 */
function periodReplacedBy(
    window: ChargePeriod,
    input: ChargeDerivationInput,
): SubscriberChargeRecord | null {
    const whole = input.written.filter((charge) =>
        isWholePlanPeriod(charge, input.written, input.subscription.id),
    );
    return (
        whole
            .filter(
                (charge) => charge.periodStart < window.start && window.start < charge.periodEnd,
            )
            .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())[0] ?? null
    );
}

/**
 * The new period an upgrade into a longer rhythm opens: charged in full, less
 * what is left of the period it replaces at the price that was paid for it,
 * and never below nothing — the arithmetic the preview quoted (`SC-CHG-021`,
 * `SC-PRIC-003`). The renewals after it run on from its end.
 */
function newPeriodAfterChange(
    input: ChargeDerivationInput,
    window: ChargePeriod,
    replaced: SubscriberChargeRecord,
    isPlanLine: (item: ContractLineItemRecord) => boolean,
): DuePlanCharge[] {
    const { subscription } = input;
    if (!isChargeable(window, input, subscription.endsAt)) return [];
    const found = lineFor(input.contracts, window, isPlanLine);
    if (!found) return [];
    const charge = chargeOf(input, found.contract, found.line, {
        origin: 'planChange',
        source: 'plan',
        sourceRef: subscription.id,
        period: window,
        amountNet: computeNewPeriodCharge({
            periodStart: replaced.periodStart,
            periodEnd: replaced.periodEnd,
            now: window.start,
            currentPriceNet: pricePaidBefore(window.start, replaced, input.contracts),
            targetPriceNet: found.line.priceNet,
        }).prorataDeltaNet,
        bookedAt: window.start,
    });
    return [{ charge, period: { charge, rhythm: rhythmOf(subscription.billingCycle) } }];
}

/**
 * What the replaced period was being paid at when the change came: the plan
 * line in force just before it, in that period's rhythm — so a same-rhythm
 * upgrade earlier in the period counts, as the preview counts it — or, failing
 * that, the line the period was charged under.
 */
function pricePaidBefore(
    at: Date,
    replaced: SubscriberChargeRecord,
    contracts: readonly SubscriptionContractRecord[],
): number {
    const chargedUnder = lineById(contracts, replaced.contractLineItemId);
    const rhythm = chargedUnder?.billingCycle;
    const before = contractInForce(contracts, new Date(at.getTime() - 1));
    const line = before?.lineItems.find(
        (item) => item.kind === 'plan' && item.billingCycle === rhythm,
    );
    return line?.priceNet ?? chargedUnder?.priceNet ?? replaced.amountNet;
}

/**
 * What an immediate upgrade in the same rhythm adds: for each contract that
 * takes effect inside a whole plan period and names a dearer plan line in that
 * period's rhythm than the one before it, the difference for what is left of
 * the period (`SC-CHG-020`). A contract written again at the same price — an
 * add-on booked, a code recorded — adds nothing, and nothing is ever given
 * back (`SC-PRIC-003`).
 */
function deriveUpgradeDifferences(
    input: ChargeDerivationInput,
    periods: readonly PlanPeriod[],
): NewSubscriberCharge[] {
    const { subscription } = input;
    const charges: NewSubscriberCharge[] = [];
    for (const { charge: period, rhythm } of periods) {
        const isPlanLine = (item: ContractLineItemRecord) =>
            item.kind === 'plan' && item.billingCycle === rhythm;
        for (const contract of input.contracts) {
            const at = contract.effectiveFrom;
            if (contract.status === 'scheduled') continue;
            if (!(period.periodStart < at && at < period.periodEnd)) continue;
            if (!isChargeable({ start: at, end: period.periodEnd }, input, subscription.endsAt)) {
                continue;
            }
            const line = contract.lineItems.find(isPlanLine);
            const before = contractInForce(input.contracts, new Date(at.getTime() - 1));
            const lineBefore = before?.lineItems.find(isPlanLine);
            if (!line || !lineBefore) continue;
            const difference = computeProration({
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
                now: at,
                currentPriceNet: lineBefore.priceNet,
                targetPriceNet: line.priceNet,
            }).prorataDeltaNet;
            if (difference <= 0) continue;
            charges.push(
                chargeOf(input, contract, line, {
                    origin: 'planChange',
                    source: 'plan',
                    sourceRef: subscription.id,
                    period: { start: at, end: period.periodEnd },
                    amountNet: difference,
                    bookedAt: at,
                }),
            );
        }
    }
    return charges;
}

/** The whole plan periods the journal holds, with the rhythm each was priced in. */
function writtenPlanPeriods(input: ChargeDerivationInput): PlanPeriod[] {
    return input.written.flatMap((charge) => {
        if (!isWholePlanPeriod(charge, input.written, input.subscription.id)) return [];
        const line = lineById(input.contracts, charge.contractLineItemId);
        return line ? [{ charge, rhythm: line.billingCycle }] : [];
    });
}

/**
 * Whether a written plan charge is a whole period rather than the difference
 * a same-rhythm upgrade added: a difference always lies inside a whole period
 * the journal holds, ending with it.
 */
function isWholePlanPeriod(
    charge: SubscriberChargeRecord,
    written: readonly SubscriberChargeRecord[],
    subscriptionId: string,
): boolean {
    if (charge.source !== 'plan' || charge.sourceRef !== subscriptionId) return false;
    if (!PERIOD_ORIGINS.includes(charge.origin)) return false;
    return charge.origin !== 'planChange' || !isDifference(charge, written);
}

function isDifference(
    charge: SubscriberChargeRecord,
    written: readonly SubscriberChargeRecord[],
): boolean {
    return written.some(
        (other) =>
            other.source === 'plan' &&
            other.sourceRef === charge.sourceRef &&
            other.periodStart < charge.periodStart &&
            sameInstant(other.periodEnd, charge.periodEnd),
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
 * What was agreed to be taken off, charged beside each plan period it applies
 * to.
 *
 * Each discount is read from the contract it was agreed in — the earliest
 * that records it — not from the one in force: a contract written again later
 * carries no discount line, and the discount runs for the duration it was
 * agreed with (`SC-PROMO-015`). A discount is agreed where an offer is
 * concluded, or where a code redeemed at onboarding is recorded in the first
 * contract after it (`SC-PROMO-025`); one an application carries forward into
 * contracts it writes itself still counts from where it first appeared.
 * Which periods that is follows from the snapshot on the line: a promo code
 * for its duration — once, a number of months, or a number of billing cycles —
 * an `intro` or `freeMonths` promotion for its months, and a `percent` or
 * `amount` promotion, which states no duration, for the first period only.
 */
function deriveDiscountCharges(
    input: ChargeDerivationInput,
    due: readonly DuePlanCharge[],
    periods: readonly PlanPeriod[],
): NewSubscriberCharge[] {
    const { subscription } = input;
    const charges: NewSubscriberCharge[] = [];
    for (const { contract, line } of discountsWhereAgreed(input.contracts)) {
        // A discount keeps to the rhythm it was agreed in: its amount was
        // resolved for a period of that length.
        const rhythm = line.billingCycle;
        const cycle: BillingCycle = rhythm === 'yearly' ? 'YEARLY' : 'MONTHLY';
        // Counted from the first plan period the agreement applies to,
        // whichever contract prices it: an offer concluded during a trial is
        // discounted from the first period that is paid, and a contract
        // written in between — an add-on booked in the trial — does not take
        // the discount with it.
        const first = firstPeriodConcludedFor(contract, periods);
        if (!first) continue;
        const anchorDay =
            rhythm === rhythmOf(subscription.billingCycle)
                ? subscription.anchorDay
                : first.getUTCDate();
        // The first change of rhythm after it was agreed ends it: what was
        // left moves to that period, once, and a later return to its rhythm
        // does not bring it back. Where the first period it applies to is
        // already of the other rhythm — the rhythm changed in a trial — that
        // period is the change, and all of it moves there.
        const beganInItsRhythm = periods.some(
            (period) => period.rhythm === rhythm && sameInstant(period.charge.periodStart, first),
        );
        const endedAt = beganInItsRhythm
            ? firstPeriodStart(
                  periods.filter(
                      (period) => period.rhythm !== rhythm && period.charge.periodStart > first,
                  ),
              )
            : first;
        for (const { charge: planCharge, period } of due) {
            const amount =
                endedAt && planCharge.periodStart > endedAt
                    ? 0
                    : period.rhythm === rhythm
                      ? discountInPeriod(line, first, planCharge.periodStart, cycle, anchorDay)
                      : sameInstant(planCharge.periodStart, endedAt)
                        ? // What is left of the discount is taken off the new
                          // period, and no more than it costs.
                          Math.min(
                              discountLeftAt(line, first, planCharge.periodStart, cycle, anchorDay),
                              planCharge.amountNet,
                          )
                        : 0;
            if (amount <= 0) continue;
            charges.push(
                chargeOf(input, contract, line, {
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

/** What a discount takes off the period of its rhythm that starts at `periodStart`. */
function discountInPeriod(
    line: ContractLineItemRecord,
    first: Date,
    periodStart: Date,
    cycle: BillingCycle,
    anchorDay: number | null,
): number {
    const index = cyclesBetween(first, periodStart, cycle, anchorDay);
    return index === null ? 0 : discountFor(line, index, first, periodStart, anchorDay);
}

/**
 * What a discount would still have taken off the periods of its rhythm that
 * start at or after `at`, had the rhythm not changed. The period running at
 * `at` had its share with its own charge.
 */
function discountLeftAt(
    line: ContractLineItemRecord,
    first: Date,
    at: Date,
    cycle: BillingCycle,
    anchorDay: number | null,
): number {
    let cents = 0;
    let periodStart = first;
    for (let index = 0; index < MAX_CYCLES; index++) {
        const amount = discountFor(line, index, first, periodStart, anchorDay);
        // Every part of a discount only ever stops applying, so the first
        // period it takes nothing off is the end of it.
        if (amount === 0) break;
        if (periodStart >= at) cents += toCents(amount);
        periodStart = advanceOneCycle(periodStart, cycle, anchorDay ?? undefined);
    }
    return cents / CENTS;
}

/** Each discount line, with the earliest contract that records it. */
function discountsWhereAgreed(
    contracts: readonly SubscriptionContractRecord[],
): { contract: SubscriptionContractRecord; line: ContractLineItemRecord }[] {
    const agreed = new Map<
        string,
        { contract: SubscriptionContractRecord; line: ContractLineItemRecord }
    >();
    for (const contract of [...contracts].sort(byEffectiveFrom)) {
        for (const line of contract.lineItems) {
            if (line.kind !== 'discount' || agreed.has(line.sourceKey)) continue;
            agreed.set(line.sourceKey, { contract, line });
        }
    }
    return [...agreed.values()];
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
 * The start of the first plan period an agreement applies to, among those
 * already written and those about to be: one that ends after the contract
 * recording it took effect, and either starts after that or is priced by it. A
 * period that began under an earlier contract and is priced by it is that
 * contract's, even where the agreement was made while it ran.
 */
function firstPeriodConcludedFor(
    concluded: SubscriptionContractRecord,
    periods: readonly PlanPeriod[],
): Date | null {
    const at = concluded.effectiveFrom;
    let first: Date | null = null;
    for (const { charge } of periods) {
        if (charge.periodEnd <= at) continue;
        if (charge.periodStart < at && charge.contractId !== concluded.id) continue;
        if (!first || charge.periodStart < first) first = charge.periodStart;
    }
    return first;
}

/** How many whole cycles lie between `from` and `to`, or null where `to` is not on the walk. */
function cyclesBetween(
    from: Date,
    to: Date,
    cycle: BillingCycle,
    anchorDay: number | null,
): number | null {
    let at = from;
    for (let step = 0; step < MAX_CYCLES; step++) {
        if (at.getTime() === to.getTime()) return step;
        if (at > to) return null;
        at = advanceOneCycle(at, cycle, anchorDay ?? undefined);
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

function sameInstant(a: Date, b: Date | null): boolean {
    return b !== null && a.getTime() === b.getTime();
}

function firstPeriodStart(periods: readonly PlanPeriod[]): Date | null {
    return periods.reduce<Date | null>(
        (first, { charge }) => (!first || charge.periodStart < first ? charge.periodStart : first),
        null,
    );
}

function holds(period: ChargePeriod, at: Date | null): boolean {
    return at !== null && period.start <= at && at < period.end;
}

function earlierOf(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
}

function rhythmOf(cycle: BillingCycle): Rhythm {
    return cycle === 'YEARLY' ? 'yearly' : 'monthly';
}

function lineById(
    contracts: readonly SubscriptionContractRecord[],
    id: string,
): ContractLineItemRecord | null {
    for (const contract of contracts) {
        const line = contract.lineItems.find((item) => item.id === id);
        if (line) return line;
    }
    return null;
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
