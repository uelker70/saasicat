import type { BillingCycle } from '@saasicat/core';

/**
 * The rhythm a scheduled change lands in: the one it names, or monthly for a
 * change written without one, which is what the materialization applies.
 * Everything that looks ahead to a scheduled change reads it here, so the
 * subscription it expects is the one the change brings.
 */
export function rhythmTheChangeLandsIn(change: {
    readonly pendingBillingCycle: string | null;
}): BillingCycle {
    return (change.pendingBillingCycle ?? 'MONTHLY') as BillingCycle;
}
