import type { BillingCycle } from '@saasicat/core';

import { advanceOneCycle, billingAnchorDay } from './billing-period.js';

// When a cancellation lands.
//
// Declaring one is never refused — a customer may say at any time that they
// want out, and this platform records that rather than arguing with it. What
// the rules decide is the DATE, and it is not always the end of the period the
// customer is in.
//
// Three facts feed it. The minimum term is what was committed to at activation
// and again at every renewal. The notice period, if an installation configures
// one, closes the door some days before that end. And a declaration made after
// the door closed lands one period later — a hard cut, not a grace period.
//
// The default notice period is zero, which makes the third fact impossible.
// Most installations should leave it there: it is the reading a customer
// expects, and the one that generates no disputes.

const DAY_MS = 86_400_000;

export interface CancellationInput {
    /** When the customer declared it. */
    now: Date;
    /** End of the period they are in, if the subscription has one. */
    currentPeriodEnd: Date | null;
    /** End of what was committed to. Null on a subscription with no term. */
    minimumTermUntil: Date | null;
    /** Needed only to find the following period end when notice has passed. */
    billingCycle: BillingCycle;
    /** Days before the term end after which a cancellation is too late. */
    noticePeriodDays: number;
    /**
     * The day of the month the subscription is billed on.
     *
     * Only the hard cut reads it, and only then does it matter — but there it
     * matters in money. A declaration made after the notice window lands one
     * period past the term end, and computing that step from the term end alone
     * takes its day from a date that may already have been clamped: an
     * anchor-31 subscription whose term ends 28 February was cut to 28 March
     * rather than 31 March, three days short of the period the customer had
     * just been charged for.
     */
    billingAnchorDay?: number | null;
}

export interface CancellationDecision {
    /** When the cancellation takes effect. */
    effectiveAt: Date;
    /** The term end it was measured against. */
    termEndsAt: Date;
    /** True when the notice window had already closed. */
    afterNoticeDeadline: boolean;
    /** The moment after which a cancellation lands one period later. */
    noticeDeadline: Date | null;
}

/**
 * Decides when a cancellation declared at `now` takes effect.
 *
 * Never returns a date in the past: a term that has already ended means the
 * cancellation lands immediately, which is what a customer outside any
 * commitment should get.
 */
export function decideCancellation(input: CancellationInput): CancellationDecision {
    const { now, currentPeriodEnd, minimumTermUntil, billingCycle, noticePeriodDays } = input;
    const anchorDay = input.billingAnchorDay ?? undefined;

    // The commitment outranks the period: they coincide unless a notice period
    // has already pushed one term past the other.
    const candidates = [minimumTermUntil, currentPeriodEnd].filter(
        (date): date is Date => date !== null,
    );
    const termEndsAt = candidates.length
        ? new Date(Math.max(...candidates.map((date) => date.getTime())))
        : now;

    if (termEndsAt <= now) {
        // Nothing left to run. Deferring to a period end in the past would
        // report a date the reader has to reason about backwards.
        return { effectiveAt: now, termEndsAt, afterNoticeDeadline: false, noticeDeadline: null };
    }

    if (noticePeriodDays <= 0) {
        return {
            effectiveAt: termEndsAt,
            termEndsAt,
            afterNoticeDeadline: false,
            noticeDeadline: null,
        };
    }

    const noticeDeadline = new Date(termEndsAt.getTime() - noticePeriodDays * DAY_MS);
    if (now <= noticeDeadline) {
        return { effectiveAt: termEndsAt, termEndsAt, afterNoticeDeadline: false, noticeDeadline };
    }

    // Far enough that the notice is actually served, not exactly one period on.
    //
    // One step is right whenever the notice is shorter than the period, which
    // is the case an installation should configure. Where it is not — 60 days
    // of notice on a monthly cycle — one step gives the customer between 31 and
    // 60 days depending on the day they happened to declare, and the operator
    // has promised 60. Stepping until the notice is served degrades honestly
    // instead: a misconfiguration then costs the customer a longer wait rather
    // than costing the operator a promise they cannot keep.
    // Resolved once, before any stepping.
    //
    // Without an anchor each step reads its day from the step before it, and
    // the step before it has already been through a clamp — so one February
    // eats the day and never gives it back. Over a single step that was
    // invisible; over several it compounds: from a term ending 31 January with
    // 60 days of notice, the walk went 28 February, 28 March (57 days, still
    // short), 28 April, holding the customer a month longer than the notice
    // asked for. With the anchor kept it is 28 February, 31 March, and it
    // stops.
    //
    // Reading the fallback from `termEndsAt` inherits whatever clamp that date
    // already carries — a port that omits `billingAnchorDay` cannot be rescued
    // here. What this removes is the compounding, not the original loss.
    const steppingAnchor = anchorDay ?? billingAnchorDay(termEndsAt);
    let effectiveAt = advanceOneCycle(termEndsAt, billingCycle, steppingAnchor);
    while (effectiveAt.getTime() - now.getTime() < noticePeriodDays * DAY_MS) {
        effectiveAt = advanceOneCycle(effectiveAt, billingCycle, steppingAnchor);
    }
    return { effectiveAt, termEndsAt, afterNoticeDeadline: true, noticeDeadline };
}

/**
 * Notice periods, one per rhythm.
 *
 * One number for both was the shape until 2026-08-27, and it could not be right
 * for both: a yearly contract with a fortnight of notice is unusual, and a
 * monthly contract with three months of notice is void against a consumer. The
 * two are configured apart because real contracts set them apart.
 *
 * Both default to zero — no notice at all — which is the reading a customer
 * expects and the one that generates no disputes.
 *
 * **No ceiling is enforced.** §309 Nr. 9 BGB limits the notice period in German
 * consumer contracts to one month, and an installation serving businesses is
 * not bound by it. The platform cannot know which it is, so the number is the
 * consumer app's to choose and this is the sentence that says what it costs.
 */
export interface CancellationNoticePeriods {
    /** Days of notice for a monthly subscription. */
    monthly?: number;
    /** Days of notice for a yearly subscription. */
    yearly?: number;
}

/**
 * The notice a subscription on `billingCycle` is owed.
 *
 * Absent means none. The two rhythms are read apart rather than one falling
 * back to the other: a configuration that names only one has deliberately left
 * the other at zero, and inferring it would be inventing a term.
 */
export function noticeDaysFor(
    periods: CancellationNoticePeriods | undefined,
    billingCycle: string,
): number {
    if (!periods) return 0;
    return (billingCycle === 'YEARLY' ? periods.yearly : periods.monthly) ?? 0;
}

/**
 * The fields a cancellation is decided from. Narrow on purpose: this file
 * decides dates and knows nothing about persistence.
 */
export interface CancellableSubscription {
    status: string;
    billingCycle: BillingCycle;
    currentPeriodEnd: Date | null;
    minimumTermUntil: Date | null;
    trialEndsAt: Date | null;
    /** See `CancellationInput.billingAnchorDay`. */
    billingAnchorDay?: number | null;
}

/**
 * Decides a cancellation from a subscription, which is the only correct way to
 * build the input above: reading the four date fields at a call site loses the
 * fifth fact, and there is no type that notices.
 *
 * That fifth fact is whether the subscription commits to anything. A trial does
 * not. It has a period end like every other subscription — the repository's own
 * fixture sets one — and treating that as a term makes the two rules a customer
 * meets disagree: a plan change during a trial takes effect at once because
 * there is nothing to protect, while a cancellation was measured against a term
 * that does not exist.
 *
 * The consequence was not a date a few weeks out. With a notice period
 * configured, a trial ending in five days is already past its deadline, so the
 * cancellation landed one BILLING CYCLE after the trial — a customer ending a
 * yearly-cycle trial bought a year by cancelling it. The window exists so that a
 * term cannot be left at the last moment; a trial has no term to leave.
 *
 * What a trial does have is an end, and the cancellation lands there: nothing is
 * billed for the remainder and the customer keeps what they were given. Ending
 * it on the spot would take the trial away as the price of saying they do not
 * want to convert.
 */
export function decideCancellationFor(
    sub: CancellableSubscription,
    now: Date,
    noticePeriodDays: number,
): CancellationDecision {
    const isTrial = sub.status === 'TRIAL';
    return decideCancellation({
        now,
        currentPeriodEnd: isTrial
            ? (sub.trialEndsAt ?? sub.currentPeriodEnd)
            : sub.currentPeriodEnd,
        minimumTermUntil: isTrial ? null : sub.minimumTermUntil,
        billingCycle: sub.billingCycle,
        noticePeriodDays: isTrial ? 0 : noticePeriodDays,
        billingAnchorDay: sub.billingAnchorDay,
    });
}
