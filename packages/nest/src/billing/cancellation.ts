import type { BillingCycle } from '@saasicat/core';

import { advanceOneCycle } from './billing-period.js';

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

    return {
        effectiveAt: advanceOneCycle(termEndsAt, billingCycle),
        termEndsAt,
        afterNoticeDeadline: true,
        noticeDeadline,
    };
}
