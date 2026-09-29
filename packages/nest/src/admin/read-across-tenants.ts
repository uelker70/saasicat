import type { RlsBypassPort } from '@saasicat/core';

/**
 * Runs a read that spans every tenant inside the bypass frame where one is
 * bound, and plainly where none is.
 *
 * An installation without row-level security binds a port that only calls
 * through, or binds none because it wires the platform by hand. One that has
 * it cannot read across tenants without the frame, and what its policy hides
 * reads exactly like nothing: a count comes back as 0, a list as empty.
 */
export function readAcrossTenants<T>(
    bypass: RlsBypassPort | null,
    read: () => Promise<T>,
): Promise<T> {
    return bypass ? bypass.runWithBypass(read) : read();
}
