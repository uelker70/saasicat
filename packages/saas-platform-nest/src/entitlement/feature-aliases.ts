// Feature-Aliase aus `replaces`-Ketten (#39, Bestandsschutz).
//
// Aktive Verträge/Contracts referenzieren Feature-Keys als eingefrorene
// Snapshots. Wird ein Feature im Code durch ein neues ersetzt (`replaces`
// am NEUEN Feature, alter Code gelöscht), würde ein Bestandsvertrag mit
// altem Key das neue Feature nicht liefern. Diese Helper expandieren die
// gewährten Features entlang der replaces-Kanten — transitiv (A→B→C),
// Zyklen werden beim Index-Bau abgelehnt.
//
// Pure Functions, keine NestJS-DI — testbar in Isolation; der
// EntitlementService wired sie gegen den DiscoverySnapshot.

import type { DiscoveredFeature } from '@saasicat/types';

/** Alter Feature-Key → direkte Nachfolger-Keys (aus deren `replaces`). */
export type ReplacedByIndex = ReadonlyMap<string, readonly string[]>;

type FeatureReplacesSource = Pick<DiscoveredFeature, 'featureKey' | 'replaces'>;

/**
 * Baut den Kanten-Index `alterKey → [nachfolgerKeys]` aus den
 * `replaces`-Deklarationen des Snapshots. Mehrere Nachfolger pro altem Key
 * sind erlaubt (Feature-Split: der alte Key liefert dann alle Nachfolger).
 * Selbstbezüge werden ignoriert; Zyklen (A ersetzt B, B ersetzt A) sind ein
 * Code-Fehler und werfen.
 */
export function buildReplacedByIndex(
    features: readonly FeatureReplacesSource[],
): ReplacedByIndex {
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
 * Expandiert gewährte Feature-Keys entlang der replaces-Ketten: jeder
 * gewährte alte Key gewährt transitiv auch seine Nachfolger. Die alten Keys
 * bleiben enthalten (Defense in depth — Guards, die noch den alten Key
 * prüfen, funktionieren weiter).
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
 * DFS-Zyklus-Erkennung über die replaces-Kanten. Ein Zyklus heißt: zwei
 * Features lösen sich gegenseitig ab — die Alias-Auflösung wäre nicht
 * terminierend definierbar, also harter Fehler mit der konkreten Kette.
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
