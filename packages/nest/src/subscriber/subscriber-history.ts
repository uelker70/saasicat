// A subscriber's history as the operator reads it: every correction of its
// legal identity, every change of its country or business status, and every
// check of its VAT identification number, the latest first.
//
// A correction that gives the subscriber another VAT number is written twice,
// as a correction and as a change of the tax origin, because the number is part
// of both. The history names it once, as the correction it was: a change of the
// tax origin that moved only the number is left out.

import type {
    AdminSubscriberHistoryEntry,
    AdminVatIdCheckOutcome,
    SubscriberCorrectionRecord,
    SubscriberTaxOriginChangeRecord,
    SubscriberVatIdCheckRecord,
    SubscriberVatIdCheckResult,
} from '@saasicat/core';

/** The records a history is read from, as the repository lists them. */
export interface SubscriberHistorySources {
    corrections: readonly SubscriberCorrectionRecord[];
    taxOriginChanges: readonly SubscriberTaxOriginChangeRecord[];
    vatIdChecks: readonly SubscriberVatIdCheckRecord[];
    /** The check that counts for the number held now, or `null`. */
    countingCheckId: string | null;
}

export function subscriberHistoryOf(
    sources: SubscriberHistorySources,
): AdminSubscriberHistoryEntry[] {
    const entries: Array<{ at: Date; entry: AdminSubscriberHistoryEntry }> = [
        ...sources.vatIdChecks.map((check) => ({
            at: check.checkedAt,
            entry: {
                kind: 'vat-id-checked' as const,
                at: check.checkedAt.toISOString(),
                vatId: check.vatId,
                valid: check.valid,
                service: check.service,
                counts: check.id === sources.countingCheckId,
            },
        })),
        ...sources.corrections.map((correction) => ({
            at: correction.correctedAt,
            entry: {
                kind: 'identity-corrected' as const,
                at: correction.correctedAt.toISOString(),
                by: correction.correctedBy,
                previous: correction.previous,
                corrected: correction.corrected,
                reason: correction.reason,
            },
        })),
        ...sources.taxOriginChanges
            .filter((change) => !('vatId' in change.changed))
            .map((change) => ({
                at: change.changedAt,
                entry: {
                    kind: 'tax-origin-changed' as const,
                    at: change.changedAt.toISOString(),
                    by: change.changedBy,
                    previous: change.previous,
                    changed: change.changed,
                    reason: change.reason,
                },
            })),
    ];
    // Stable, so entries of one moment keep the order they are listed in above:
    // a check before the correction it follows, since a check is made after the
    // write that gave the number — latest first, even within one millisecond.
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).map(({ entry }) => entry);
}

/** A check's result as the operator is shown it, dates as ISO strings. */
export function vatIdCheckOutcomeOf(result: SubscriberVatIdCheckResult): AdminVatIdCheckOutcome {
    if (!result.completed) return { completed: false, reason: result.reason };
    return {
        completed: true,
        valid: result.check.valid,
        checkedAt: result.check.checkedAt.toISOString(),
        service: result.check.service,
        counts: result.counts,
    };
}
