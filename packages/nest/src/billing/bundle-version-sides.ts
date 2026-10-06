// An add-on version as a subscriber compares it with another: the side a
// retirement's notice, its reminder, the early switch and an offer each read,
// priced beside one plan, and the differences between two of them.

import {
    classifyBundleVersionDiff,
    type BillingCycle,
    type BundleVersionFields,
    type BundleVersionSide,
    type BundleVersionRetiredNotice,
    type BundleVersionRow,
    type VersionChange,
} from '@saasicat/core';

import { resolveBundlePriceNet } from './bundle-price.js';

/**
 * One version as a subscriber compares it, priced beside `planKey` —
 * `pricingOverrides` included — or at its own prices where no plan is named.
 */
export function bundleVersionSide(
    version: BundleVersionRow,
    planKey: string | null,
): BundleVersionSide {
    const priced = planKey === null ? { ...version, pricingOverrides: [] } : version;
    return {
        bundleVersionId: version.id,
        bundleKey: version.bundleKey,
        label: version.label,
        version: version.version,
        features: [...version.features],
        quotas: { ...version.quotas },
        monthlyNet: resolveBundlePriceNet(priced, planKey ?? '', 'MONTHLY'),
        yearlyNet: resolveBundlePriceNet(priced, planKey ?? '', 'YEARLY'),
    };
}

/**
 * What the catalogue's diff compares of a side: what it grants, and its price
 * in each rhythm — or, with `inRhythm`, in that rhythm alone, the other left
 * out of the comparison.
 */
export function comparedFieldsOfSide(
    side: BundleVersionSide,
    inRhythm?: BillingCycle,
): BundleVersionFields {
    return {
        features: [...side.features],
        quotas: { ...side.quotas },
        monthlyNet: inRhythm === 'YEARLY' ? null : side.monthlyNet,
        yearlyNet: inRhythm === 'MONTHLY' ? null : side.yearlyNet,
    };
}

/** Every difference, from one version to the other, as the catalogue's diff states it. */
export function bundleVersionChanges(
    from: BundleVersionSide,
    to: BundleVersionSide,
): VersionChange[] {
    return classifyBundleVersionDiff(comparedFieldsOfSide(from), comparedFieldsOfSide(to)).changes;
}

/**
 * A told notice's two versions as they compare beside `planKey` now: each
 * priced for that plan as the catalogue holds it (`retired`, `replacement`),
 * and the differences between them. Where a version cannot be read, the
 * side the notice recorded stands.
 */
export function bundleRetirementSidesFor(
    told: Pick<BundleVersionRetiredNotice, 'retired' | 'replacement'>,
    planKey: string,
    retired: BundleVersionRow | null,
    replacement: BundleVersionRow | null,
): Pick<BundleVersionRetiredNotice, 'planKey' | 'retired' | 'replacement' | 'changes'> {
    const retiredSide = retired ? bundleVersionSide(retired, planKey) : told.retired;
    const replacementSide = replacement
        ? bundleVersionSide(replacement, planKey)
        : told.replacement;
    return {
        planKey,
        retired: retiredSide,
        replacement: replacementSide,
        changes: bundleVersionChanges(retiredSide, replacementSide),
    };
}
