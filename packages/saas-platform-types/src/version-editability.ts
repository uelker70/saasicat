// Editability rule for versioned catalog entries — pure function.
//
// Single source of truth for the question "may the SuperAdmin UI open the
// editor for this version?". Both services (plan/bundle) and
// UI components consume this helper, so that the backend gate
// and the frontend button-disabling stay congruent.
//
// Background: up to SPEC_V2 §11.1 M6 Pack 2c the rule was "publishedAt !== null →
// immutable" (contract protection P1/P4). But that hard rule also prevents
// later corrections to versions that are published but
// not yet active and not yet sold — the typical case when
// a future release was pulled forward and the price still needs to be
// adjusted. The relaxed rule:
//
//   editable === true if
//     publishedAt === null                            (= draft, classic)
//   or
//     publishedAt !== null
//     && supersededAt === null                        (not superseded by a successor)
//     && isLatestInChain                              (highest version number)
//     && (subscriptionCount ?? 1) === 0               (no subscription binds it)
//     && validFrom in the future                      (no new bookings possible yet)
//
// `subscriptionCount === undefined` is defensively interpreted as "non-empty"
// — adapters that don't set the field keep the version
// frozen (fail-closed).

import type { VersionedEntityBase } from './subscription.types.js';

/** Why a version is editable (for UI badges + audit logs). */
export type VersionEditableReason = 'draft' | 'pre-active';

export interface VersionEditability {
    editable: boolean;
    reason: VersionEditableReason | null;
}

/**
 * Decides whether a versioned catalog entity may currently be edited.
 * `now` is parameterized so that tests can be deterministic and
 * services use the same point in time for list annotation + mutation
 * gate.
 */
export function isVersionEditable(
    v: VersionedEntityBase,
    now: Date = new Date(),
): VersionEditability {
    if (v.publishedAt === null) {
        return { editable: true, reason: 'draft' };
    }
    if (v.supersededAt !== null) {
        return { editable: false, reason: null };
    }
    if (v.isLatestInChain !== true) {
        return { editable: false, reason: null };
    }
    if ((v.subscriptionCount ?? 1) > 0) {
        return { editable: false, reason: null };
    }
    if (v.validFrom === null) {
        return { editable: false, reason: null };
    }
    const from = new Date(v.validFrom);
    if (Number.isNaN(from.getTime())) {
        return { editable: false, reason: null };
    }
    if (from.getTime() <= now.getTime()) {
        return { editable: false, reason: null };
    }
    return { editable: true, reason: 'pre-active' };
}
