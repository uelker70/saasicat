// Whether a subscription's cancellation has already taken effect.
//
// The distinction the page has to make, and the reason it cannot read `status`
// to make it: a cancellation is recorded on the subscription, and nothing
// transitions the status when its date arrives — the platform stops the billing
// period and ends the entitlements, but the column keeps saying ACTIVE. A page
// that trusts it goes on showing a positive badge and a next billing date for a
// subscription that is over, beside a sentence promising nothing changes before
// a date in the past.
//
// The same reading the platform applies, deliberately: on a row written before
// `canceledAt` and `canceledEffectiveAt` separated, the first field IS the
// effective date and the second is null.

/** The two cancellation fields as `GET /billing/usage` reports them. */
export interface CancellationTimestamps {
    canceledAt: string | null;
    canceledEffectiveAt: string | null;
}

/** When the cancellation lands, or null while none was declared. */
export function cancellationLandsAt(usage: CancellationTimestamps): string | null {
    return usage.canceledEffectiveAt ?? usage.canceledAt;
}

/**
 * True once that date has passed. A cancellation still to come is not an end:
 * the subscription runs, is billed and keeps everything until then.
 */
export function subscriptionHasEnded(
    usage: CancellationTimestamps,
    now: Date = new Date(),
): boolean {
    const landsAt = cancellationLandsAt(usage);
    return landsAt !== null && new Date(landsAt).getTime() <= now.getTime();
}
