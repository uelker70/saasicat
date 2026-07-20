// Pure helpers around code-discovered feature dependencies (#35).
//
// A selection (plan features, bundle features, configurator selection)
// is "dependency-covered" when every `requires` feature of the contained
// features is also part of the selection. What is missing is returned by
// `collectUnsatisfiedRequires` — public catalog endpoints expose it
// as `requiresFeatures` so configurator UIs can grey out incompatible
// bundles, and the upsell resolver (#36) uses it to rank combo bundles
// higher.
//
// Deliberately here in the types package (like `pickActivePromo`): backend AND
// frontend compute with the same function — the client checks "are the
// requiresFeatures covered by plan + current selection?" using the same
// index format.

/** Feature key → its `requires` keys (from Discovery/FeatureCatalogEntry). */
export type FeatureRequiresIndex = ReadonlyMap<string, readonly string[]>;

interface FeatureRequiresSource {
    featureKey: string;
    requires?: readonly string[] | null;
}

/**
 * Builds the lookup index from snapshot features (`DiscoveredFeature`) or
 * catalog entries (`FeatureCatalogEntryRow`) — both carry
 * `featureKey` + `requires`. Self-references are ignored.
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
 * Union of the `requires` of all `selected` features minus the features that
 * `selected` itself contains — i.e. exactly the dependencies that must be
 * covered outside the selection. Sorted, deduplicated; an empty result
 * = the selection is self-contained (e.g. combo bundle SPORTPLATZ).
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
 * Bookability state of a bundle relative to the already covered
 * features (plan ∪ already selected/booked bundles):
 * - `covered`     — all bundle features are already covered → would be sold
 *                   twice; the UI shows "bereits enthalten" and it doesn't count.
 * - `missing-requires` — at least one `requiresFeatures` is uncovered → grey out.
 * - `bookable`    — selectable.
 */
export type BundleAvailabilityState = 'bookable' | 'covered' | 'missing-requires';

/** Feature carrier of a bundle for the bookability derivation. */
export interface BundleFeatureShape {
    features: readonly string[];
    requiresFeatures?: readonly string[] | null;
}

/**
 * Uncovered `requiresFeatures` of a bundle relative to the coverage. Sorted,
 * deduplicated; an empty result = all prerequisites covered.
 */
export function missingRequiresFor(
    bundle: BundleFeatureShape,
    coveredFeatures: ReadonlySet<string>,
): string[] {
    const missing = (bundle.requiresFeatures ?? []).filter((key) => !coveredFeatures.has(key));
    return [...new Set(missing)].sort((a, b) => a.localeCompare(b));
}

/**
 * Unified status derivation for configurator and bundle-store UIs (#22/#35).
 * Order is deliberate: full coverage beats missing requires (a fully
 * covered bundle is never bookable, no matter which requires are open).
 * Quotas don't count — they act additively.
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

/** Bundle with features + identifying version ID for the redundancy derivation. */
export interface SelectableBundleShape extends BundleFeatureShape {
    bundleVersionId: string;
    /**
     * Optional sort position. Makes the choice of the kept bundle
     * predictable under mutual coverage (`selectChargeableBundles`).
     * Missing = sorted to the end, then by `bundleVersionId`.
     */
    sortOrder?: number;
}

/**
 * Coverage of a bundle relative to plan ∪ the *remaining* selected bundles —
 * the bundle itself doesn't count against itself (otherwise every bundle would
 * trivially be "already included"). Shared source for grid greying AND price/
 * payload exclusion: the configurator grid and the subscription draft must see
 * the same coverage, otherwise display and billing drift apart.
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
 * Is an already selected bundle fully covered (redundant) by plan ∪ the
 * remaining selected bundles? Such bundles get sold twice — they must
 * flow neither into the price total nor into the API payload.
 * Uses the same `resolveBundleAvailability` derivation as the grid.
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
 * Deterministic order for the iterative redundancy removal:
 * `sortOrder` ascending (missing to the end), then `bundleVersionId`. That way
 * it is predictable which bundle gets removed under mutual coverage.
 */
function compareSelectable(a: SelectableBundleShape, b: SelectableBundleShape): number {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.bundleVersionId.localeCompare(b.bundleVersionId);
}

/**
 * Minimally covering subset of the selected bundles: keeps exactly the bundles
 * that get charged/booked, and discards redundant ones (fully covered by
 * plan ∪ the remaining kept bundles).
 *
 * Iterative rather than one-shot removal: a single
 * `filter(b => !isBundleRedundant(b, plan, all))` over the full selection
 * discards ALL participants under mutual/cyclic coverage (Y={C} and
 * Z={C} cover each other → both filtered → feature C would be lost
 * and neither charged nor booked). Instead, ONE redundant bundle relative
 * to the CURRENTLY kept set is repeatedly removed and re-evaluated.
 * That guarantees that the kept set covers the same feature union
 * (minus plan) as the full selection — under mutual/cyclic coverage
 * exactly ONE bundle remains deterministically, and for a proper subset
 * (Y={C} ⊂ Z={C,D}) Y is discarded and Z is kept.
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
