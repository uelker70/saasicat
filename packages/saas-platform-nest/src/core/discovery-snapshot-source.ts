// Discovery-Snapshot-Auflösung für CatalogModule-Services (#25).
//
// Primärpfad ist der injizierte DISCOVERY_SNAPSHOT_TOKEN — seit #25 ein
// `Symbol.for` (siehe discovery/tokens.ts), damit er über die von tsup/esbuild
// duplizierten CJS-Entry-Bundles hinweg identisch ist. Als zusätzliche
// Robustheit kann auch direkt der DiscoveryScanner injiziert werden (greift,
// wenn Consumer DiscoveryModule + CatalogModule aus DEMSELBEN Bundle ziehen);
// dann wird der Snapshot zur Nutzungszeit über `getSnapshot()` gelesen.

import type { DiscoverySnapshot } from '@saasicat/types';

interface SnapshotProducer {
    getSnapshot(): DiscoverySnapshot;
}

/**
 * Löst den Snapshot zur Nutzungszeit auf: injizierter Token (falls erreichbar)
 * ODER der DiscoveryScanner (voller Snapshot nach Boot). `null`, wenn weder das
 * eine noch das andere bereitsteht.
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
 * Ob überhaupt eine Snapshot-Quelle bereitsteht — für den blocking-Guard, ohne
 * den Snapshot früh (zur Konstruktionszeit) zu bauen.
 */
export function hasDiscoverySnapshotSource(
    injected: DiscoverySnapshot | null | undefined,
    scanner: unknown,
): boolean {
    return injected != null || scanner != null;
}
