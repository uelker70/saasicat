// Discovery snapshot resolution for CatalogModule services (#25).
//
// The primary path is the injected DISCOVERY_SNAPSHOT_TOKEN — since #25 a
// `Symbol.for` (see discovery/tokens.ts), so that it is identical across the
// CJS entry bundles that tsup/esbuild duplicate. For additional
// robustness the DiscoveryScanner can also be injected directly (applies
// when the consumer pulls DiscoveryModule + CatalogModule from the SAME bundle);
// the snapshot is then read at use time via `getSnapshot()`.

import type { DiscoverySnapshot } from '@saasicat/types';

interface SnapshotProducer {
    getSnapshot(): DiscoverySnapshot;
}

/**
 * Resolves the snapshot at use time: injected token (if reachable)
 * OR the DiscoveryScanner (full snapshot after boot). `null` if neither
 * one nor the other is available.
 */
export function resolveDiscoverySnapshot(
    injected: DiscoverySnapshot | null | undefined,
    scanner: SnapshotProducer | null | undefined,
): DiscoverySnapshot | null {
    if (injected) return injected;
    if (scanner) return scanner.getSnapshot();
    return null;
}

/**
 * Whether any snapshot source is available at all — for the blocking guard,
 * without building the snapshot early (at construction time).
 */
export function hasDiscoverySnapshotSource(
    injected: DiscoverySnapshot | null | undefined,
    scanner: unknown,
): boolean {
    return injected != null || scanner != null;
}
