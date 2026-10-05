// An add-on version as a subscriber compares it with another: the side a
// retirement's notice, its reminder and the early switch each read, priced
// beside one plan, and the differences between two of them.

import {
    classifyBundleVersionDiff,
    type BundleRetirementSide,
    type BundleVersionRetiredNotice,
    type BundleVersionRow,
    type VersionChange,
} from '@saasicat/core';

import { resolveBundlePriceNet } from './bundle-price.js';

/**
 * One version as a subscriber compares it, priced beside `planKey` —
 * `pricingOverrides` included — or at its own prices where no plan is named.
 */
export function bundleRetirementSide(
    version: BundleVersionRow,
    planKey: string | null,
): BundleRetirementSide {
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

/** Every difference, retired to replacement, as the catalogue's diff states it. */
export function bundleRetirementChanges(
    retired: BundleRetirementSide,
    replacement: BundleRetirementSide,
): VersionChange[] {
    const fields = (side: BundleRetirementSide) => ({
        features: [...side.features],
        quotas: { ...side.quotas },
        monthlyNet: side.monthlyNet,
        yearlyNet: side.yearlyNet,
    });
    return classifyBundleVersionDiff(fields(retired), fields(replacement)).changes;
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
    const retiredSide = retired ? bundleRetirementSide(retired, planKey) : told.retired;
    const replacementSide = replacement
        ? bundleRetirementSide(replacement, planKey)
        : told.replacement;
    return {
        planKey,
        retired: retiredSide,
        replacement: replacementSide,
        changes: bundleRetirementChanges(retiredSide, replacementSide),
    };
}
