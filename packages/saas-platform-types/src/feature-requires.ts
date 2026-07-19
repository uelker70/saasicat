// Pure Helper rund um code-discoverte Feature-Abhängigkeiten (#35).
//
// Eine Auswahl (Plan-Features, Bundle-Features, Konfigurator-Selection)
// ist „dependency-gedeckt", wenn jedes `requires`-Feature der enthaltenen
// Features ebenfalls in der Auswahl liegt. Was fehlt, liefert
// `collectUnsatisfiedRequires` — Public-Catalog-Endpoints exponieren das
// als `requiresFeatures`, damit Konfigurator-UIs inkompatible Bundles
// ausgrauen können, und der Upsell-Resolver (#36) bewertet damit
// Kombi-Bundles höher.
//
// Bewusst hier im types-Paket (wie `pickActivePromo`): Backend UND
// Frontend rechnen mit derselben Funktion — der Client prüft „sind die
// requiresFeatures durch Plan + aktuelle Auswahl gedeckt?" mit demselben
// Index-Format.

/** Feature-Key → seine `requires`-Keys (aus Discovery/FeatureCatalogEntry). */
export type FeatureRequiresIndex = ReadonlyMap<string, readonly string[]>;

interface FeatureRequiresSource {
    featureKey: string;
    requires?: readonly string[] | null;
}

/**
 * Baut den Lookup-Index aus Snapshot-Features (`DiscoveredFeature`) oder
 * Catalog-Entries (`FeatureCatalogEntryRow`) — beide tragen
 * `featureKey` + `requires`. Selbstbezüge werden ignoriert.
 */
export function buildFeatureRequiresIndex(
    features: readonly FeatureRequiresSource[],
): FeatureRequiresIndex {
    const index = new Map<string, readonly string[]>();
    for (const feature of features) {
        const requires = (feature.requires ?? []).filter((key) => key !== feature.featureKey);
        if (requires.length > 0) index.set(feature.featureKey, requires);
    }
    return index;
}

/**
 * Union der `requires` aller `selected`-Features minus der Features, die
 * `selected` selbst enthält — also genau die Abhängigkeiten, die außerhalb
 * der Auswahl gedeckt sein müssen. Sortiert, dedupliziert; leeres Ergebnis
 * = die Auswahl ist self-contained (z. B. Kombi-Bundle SPORTPLATZ).
 */
export function collectUnsatisfiedRequires(
    selected: readonly string[],
    index: FeatureRequiresIndex,
): string[] {
    const own = new Set(selected);
    const unsatisfied = new Set<string>();
    for (const featureKey of selected) {
        for (const required of index.get(featureKey) ?? []) {
            if (!own.has(required)) unsatisfied.add(required);
        }
    }
    return [...unsatisfied].sort((a, b) => a.localeCompare(b));
}

/**
 * Buchbarkeits-Status eines Bundles relativ zu den bereits gedeckten
 * Features (Plan ∪ schon gewählte/gebuchte Bundles):
 * - `covered`     — alle Bundle-Features sind bereits gedeckt → würde doppelt
 *                   verkauft; UI zeigt „bereits enthalten" und zählt nicht mit.
 * - `missing-requires` — mindestens ein `requiresFeatures` ist ungedeckt → ausgrauen.
 * - `bookable`    — wählbar.
 */
export type BundleAvailabilityState = 'bookable' | 'covered' | 'missing-requires';

/** Feature-Träger eines Bundles für die Buchbarkeits-Ableitung. */
export interface BundleFeatureShape {
    features: readonly string[];
    requiresFeatures?: readonly string[] | null;
}

/**
 * Ungedeckte `requiresFeatures` eines Bundles relativ zur Deckung. Sortiert,
 * dedupliziert; leeres Ergebnis = alle Voraussetzungen gedeckt.
 */
export function missingRequiresFor(
    bundle: BundleFeatureShape,
    coveredFeatures: ReadonlySet<string>,
): string[] {
    const missing = (bundle.requiresFeatures ?? []).filter((key) => !coveredFeatures.has(key));
    return [...new Set(missing)].sort((a, b) => a.localeCompare(b));
}

/**
 * Einheitliche Status-Ableitung für Konfigurator- und Bundle-Store-UIs (#22/#35).
 * Reihenfolge bewusst: vollständige Deckung schlägt fehlende requires (ein
 * komplett gedecktes Bundle ist nie buchbar, egal welche requires offen sind).
 * Quotas zählen nicht — sie wirken additiv.
 */
export function resolveBundleAvailability(
    bundle: BundleFeatureShape,
    coveredFeatures: ReadonlySet<string>,
): BundleAvailabilityState {
    if (bundle.features.length > 0 && bundle.features.every((f) => coveredFeatures.has(f))) {
        return 'covered';
    }
    if (missingRequiresFor(bundle, coveredFeatures).length > 0) return 'missing-requires';
    return 'bookable';
}

/** Bundle mit Features + identifizierender Version-ID für die Redundanz-Ableitung. */
export interface SelectableBundleShape extends BundleFeatureShape {
    bundleVersionId: string;
    /**
     * Optionale Sortier-Position. Macht die Auswahl des behaltenen Bundles
     * bei gegenseitiger Deckung vorhersehbar (`selectChargeableBundles`).
     * Fehlend = ans Ende sortiert, dann nach `bundleVersionId`.
     */
    sortOrder?: number;
}

/**
 * Deckung eines Bundles relativ zu Plan ∪ den *übrigen* gewählten Bundles —
 * das Bundle selbst zählt nicht gegen sich (sonst wäre jedes Bundle trivial
 * „bereits enthalten"). Geteilte Quelle für Grid-Ausgrauung UND Preis-/
 * Payload-Exklusion: Konfigurator-Grid und Subscription-Draft müssen dieselbe
 * Deckung sehen, sonst driften Anzeige und Abrechnung auseinander.
 */
export function coverageExcludingSelf(
    selfVersionId: string,
    planFeatures: readonly string[],
    selectedBundles: readonly SelectableBundleShape[],
): Set<string> {
    const covered = new Set(planFeatures);
    for (const bundle of selectedBundles) {
        if (bundle.bundleVersionId === selfVersionId) continue;
        for (const feature of bundle.features) covered.add(feature);
    }
    return covered;
}

/**
 * Ist ein bereits gewähltes Bundle durch Plan ∪ die übrigen gewählten Bundles
 * vollständig gedeckt (redundant)? Solche Bundles werden doppelt verkauft —
 * sie dürfen weder in die Preis-Summe noch in die API-Payload einfließen.
 * Nutzt dieselbe `resolveBundleAvailability`-Ableitung wie das Grid.
 */
export function isBundleRedundant(
    bundle: SelectableBundleShape,
    planFeatures: readonly string[],
    selectedBundles: readonly SelectableBundleShape[],
): boolean {
    const covered = coverageExcludingSelf(bundle.bundleVersionId, planFeatures, selectedBundles);
    return resolveBundleAvailability(bundle, covered) === 'covered';
}

/**
 * Deterministische Reihenfolge für die iterative Redundanz-Entfernung:
 * `sortOrder` aufsteigend (fehlend ans Ende), dann `bundleVersionId`. So ist
 * vorhersehbar, welches Bundle bei gegenseitiger Deckung entfernt wird.
 */
function compareSelectable(a: SelectableBundleShape, b: SelectableBundleShape): number {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.bundleVersionId.localeCompare(b.bundleVersionId);
}

/**
 * Minimal-deckende Teilmenge der gewählten Bundles: behält genau die Bundles,
 * die berechnet/gebucht werden, und verwirft redundante (durch Plan ∪ die
 * übrigen behaltenen Bundles vollständig gedeckte) Bundles.
 *
 * Iterative statt einmalige Entfernung: ein einmaliger
 * `filter(b => !isBundleRedundant(b, plan, alle))` über die volle Auswahl
 * verwirft bei gegenseitiger/zyklischer Deckung ALLE Beteiligten (Y={C} und
 * Z={C} decken sich gegenseitig → beide gefiltert → Feature C ginge verloren
 * und würde weder berechnet noch gebucht). Stattdessen wird wiederholt EIN
 * redundantes Bundle relativ zur AKTUELL behaltenen Menge entfernt und neu
 * bewertet. Das garantiert, dass die behaltene Menge dieselbe Feature-Union
 * (minus Plan) deckt wie die volle Auswahl — bei gegenseitiger/zyklischer
 * Deckung bleibt deterministisch genau EIN Bundle übrig, bei echter Teilmenge
 * (Y={C} ⊂ Z={C,D}) wird Y verworfen und Z behalten.
 */
export function selectChargeableBundles<T extends SelectableBundleShape>(
    planFeatures: readonly string[],
    selectedBundles: readonly T[],
): T[] {
    const kept = [...selectedBundles].sort(compareSelectable);
    for (;;) {
        const redundantIndex = kept.findIndex((bundle) =>
            isBundleRedundant(bundle, planFeatures, kept),
        );
        if (redundantIndex === -1) return kept;
        kept.splice(redundantIndex, 1);
    }
}
