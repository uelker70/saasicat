// What another version of the same plan is for a subscriber, judged against
// the version the subscription is bound to — not against the one published
// before the candidate, and not by a flag set when the candidate was
// published. The bound version is what the subscriber has; the candidate's
// predecessor may be a version they never had.

import { classifyBundleVersionDiff, type BundleVersionFields } from './version-diff.js';
import type { VersionChange } from './subscription.types.js';

/**
 * - `improvement` — nothing dearer in any rhythm, no feature missing, no quota
 *   lower. Taken at once and free, the term kept.
 * - `more-for-more` — nothing missing or lower, but dearer in at least one
 *   rhythm. Taken like an upgrade: at once, the difference prorated. The rule
 *   reads every rhythm, so in the subscriber's own the difference can be zero
 *   or below — monthly 49 to 45 with yearly 490 to 500 is more for more for a
 *   monthly subscriber too.
 * - `takes-something-away` — a feature missing or a quota lower, whatever the
 *   price. Taken like a downgrade: at the end of the running term, and only
 *   when the subscriber asks for it.
 * - `same` — the two agree on everything compared: there is nothing to offer.
 */
export type VersionOfferClass = 'improvement' | 'more-for-more' | 'takes-something-away' | 'same';

/**
 * A version as the comparison reads it. A price may be absent: that is a
 * rhythm the version is not sold in, and a rhythm that stops being sold counts
 * against the candidate like a price that went up.
 */
export type VersionOfferFields = BundleVersionFields;

export interface VersionOffer {
    readonly class: VersionOfferClass;
    /** Every difference, bound to candidate, as the catalogue's diff states it. */
    readonly changes: readonly VersionChange[];
}

/** One version as a subscriber compares it. A price of null is a rhythm it is not sold in. */
export interface VersionOfferSide {
    readonly planVersionId: string;
    readonly version: number;
    readonly features: readonly string[];
    readonly quotas: Readonly<Record<string, number>>;
    readonly monthlyNet: number | null;
    readonly yearlyNet: number | null;
}

/**
 * A newer version of the subscriber's plan, offered: the version bound and the
 * one offered side by side, what kind of offer it is, and when a switch taken
 * now would take effect — at once, or, for one that takes something away, at
 * the end of the running term. `GET billing/version-offer` answers with it.
 */
export interface VersionOfferView {
    readonly plan: string;
    readonly bound: VersionOfferSide;
    readonly offered: VersionOfferSide;
    readonly class: Exclude<VersionOfferClass, 'same'>;
    readonly changes: readonly VersionChange[];
    /** ISO instant. */
    readonly takesEffectAt: string;
}

/** A change that takes something the subscriber has away from them. */
function takesSomethingAway(change: VersionChange): boolean {
    if (change.direction !== 'REGRESSION') return false;
    return change.field === 'features.removed' || change.field.startsWith('quotas.');
}

/**
 * Classifies `candidate` against `bound`. The comparison is the catalogue's
 * own diff — prices with a rhythm that may be absent, as a bundle version's
 * are — so an offer and a published version describe their changes alike.
 */
export function classifyVersionOffer(
    bound: VersionOfferFields,
    candidate: VersionOfferFields,
): VersionOffer {
    const { changes } = classifyBundleVersionDiff(bound, candidate);
    if (changes.some(takesSomethingAway)) return { class: 'takes-something-away', changes };
    if (changes.some((change) => change.direction === 'REGRESSION')) {
        return { class: 'more-for-more', changes };
    }
    return { class: changes.length > 0 ? 'improvement' : 'same', changes };
}
