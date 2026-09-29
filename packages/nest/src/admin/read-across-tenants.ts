import type { RlsBypassPort } from '@saasicat/core';

/**
 * Runs work that spans every tenant inside the bypass frame where one is
 * bound, and plainly where none is — a read, or a write the installation does
 * for all of them, such as a nightly sweep or an operator's refresh.
 *
 * An installation without row-level security binds a port that only calls
 * through, or binds none because it wires the platform by hand. One that has
 * it cannot reach across tenants without the frame, and what its policy hides
 * looks exactly like nothing: a count comes back as 0, a list as empty, an
 * update changes no row. The port has to lift writes as well as reads.
 */
export function readAcrossTenants<T>(
    bypass: RlsBypassPort | null,
    read: () => Promise<T>,
): Promise<T> {
    return bypass ? bypass.runWithBypass(read) : read();
}
