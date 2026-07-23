// Feature aliases from `replaces` chains (#39, grandfathering).
//
// Active contracts reference feature keys as frozen snapshots. When a
// feature is replaced in code by a new one (`replaces` on the NEW feature,
// old code deleted), an existing contract with the old key would no longer
// deliver the new feature. These helpers expand the granted features along
// the replaces edges — transitively (A→B→C); cycles are rejected when the
// index is built.
//
// Pure functions, no NestJS DI — testable in isolation; the
// EntitlementService wires them against the DiscoverySnapshot.

import type { DiscoveredFeature } from '@saasicat/types';

/** Old feature key → direct successor keys (from their `replaces`). */
export type ReplacedByIndex = ReadonlyMap<string, readonly string[]>;

type FeatureReplacesSource = Pick<DiscoveredFeature, 'featureKey' | 'replaces'>;

/**
 * Builds the edge index `oldKey → [successorKeys]` from the snapshot's
 * `replaces` declarations. Multiple successors per old key are allowed
 * (feature split: the old key then delivers all successors).
 * Self-references are ignored; cycles (A replaces B, B replaces A) are a
 * code error and throw.
 */
export function buildReplacedByIndex(features: readonly FeatureReplacesSource[]): ReplacedByIndex {
    const index = new Map<string, string[]>();
    for (const feature of features) {
        for (const oldKey of feature.replaces ?? []) {
            if (oldKey === feature.featureKey) continue;
            const list = index.get(oldKey) ?? [];
            list.push(feature.featureKey);
            index.set(oldKey, list);
        }
    }
    for (const list of index.values()) list.sort((a, b) => a.localeCompare(b));
    assertNoReplacesCycle(index);
    return index;
}

/**
 * Expands granted feature keys along the replaces chains: every granted
 * old key transitively also grants its successors. The old keys remain
 * included (defense in depth — guards that still check the old key keep
 * working).
 */
export function expandReplacedFeatures(
    granted: ReadonlySet<string>,
    index: ReplacedByIndex,
): Set<string> {
    const expanded = new Set(granted);
    const worklist = [...granted];
    while (worklist.length > 0) {
        const key = worklist.pop() as string;
        for (const successor of index.get(key) ?? []) {
            if (expanded.has(successor)) continue;
            expanded.add(successor);
            worklist.push(successor);
        }
    }
    return expanded;
}

/**
 * DFS cycle detection over the replaces edges. A cycle means: two
 * features replace each other — the alias resolution could not be defined
 * to terminate, so a hard error with the concrete chain.
 */
function assertNoReplacesCycle(index: ReadonlyMap<string, readonly string[]>): void {
    const DONE = 2;
    const IN_PROGRESS = 1;
    const state = new Map<string, number>();

    const visit = (key: string, path: string[]): void => {
        const s = state.get(key);
        if (s === DONE) return;
        if (s === IN_PROGRESS) {
            const cycleStart = path.indexOf(key);
            const cycle = [...path.slice(cycleStart), key].join(' → ');
            throw new Error(
                `replaces-Zyklus in den Discovery-Metadaten: ${cycle}. ` +
                    'Feature-Ersetzungen müssen azyklisch sein — replaces-Deklarationen im Code korrigieren (#39).',
            );
        }
        state.set(key, IN_PROGRESS);
        for (const successor of index.get(key) ?? []) {
            visit(successor, [...path, key]);
        }
        state.set(key, DONE);
    };

    for (const key of index.keys()) visit(key, []);
}
