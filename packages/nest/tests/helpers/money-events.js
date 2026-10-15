// What the gateway reports about money, as its adapter translates it: a
// collection's outcome, a refund, a reversal — each for the attempt whose key
// the payment carries.

import { toCents } from '@saasicat/core';

import { ISSUED } from './invoice-collection.js';

/** The gateway's report of what became of the attempt `attemptKey`. */
export const collectionReported = (eventId, attemptKey, outcome) => ({
    kind: 'collection-reported',
    eventId,
    occurredAt: ISSUED.toISOString(),
    attemptKey,
    outcome,
});

/** The gateway's report of a refund of the payment `paymentRef`, which `attemptKey` collected. */
export const refundReported = (eventId, attemptKey, refund) => ({
    kind: 'refund-reported',
    eventId,
    occurredAt: ISSUED.toISOString(),
    attemptKey,
    refund: { currency: 'EUR', status: 'pending', ...refund },
});

/**
 * The gateway's report of a reversal of the payment `paymentRef`, which
 * `attemptKey` collected: what it withdrew and gave back so far, in cents.
 */
export const reversalReported = (eventId, attemptKey, reversal) => ({
    kind: 'reversal-reported',
    eventId,
    occurredAt: ISSUED.toISOString(),
    attemptKey,
    reversal: { currency: 'EUR', reinstatedCents: 0, ...reversal },
});

/** A success for `invoice` under `paymentRef`, of its whole amount unless told otherwise. */
export const succeeded = (invoice, paymentRef, amount = invoice.totalGross) => ({
    status: 'succeeded',
    paymentRef,
    amountCents: toCents(amount),
    currency: 'EUR',
});
