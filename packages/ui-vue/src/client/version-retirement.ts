// What an operator reads off a retirement before announcing it, framework-free:
// which versions may be retired, the dates the subscriptions — or, for an
// add-on version, the bookings — move on, and the ones it does not reach.

import type {
    BundleVersionRetirementView,
    RetirementBlocker,
    RetirementProgress,
    RetirementReachedRow,
    RetirementSkipReason,
    VersionRetirementView,
    VersionSaleDates,
} from '@saasicat/core';

import { formatMessage } from './i18n/format.js';
import { versionSale } from './version-sale.js';

/**
 * Whether a retirement may be started for `version` at `now` — a plan's or an
 * add-on's: published and no longer on sale, so nobody books it after the
 * announcement. The server decides again; this only says where the action is
 * offered.
 */
export function isRetirable(version: VersionSaleDates, now: Date): boolean {
    return versionSale(version, now).kind === 'off-sale';
}

/** One date subscriptions move to the replacement on, and how many do. */
export interface RetirementDate {
    /** ISO 8601. */
    readonly effectiveAt: string;
    /** ISO date: the last day those subscriptions may cancel without notice. */
    readonly lastDayToCancel: string;
    readonly count: number;
}

/** The dates what a preview reaches moves on, the earliest first. */
export function retirementDates(preview: {
    readonly reached: readonly Pick<RetirementReachedRow, 'effectiveAt' | 'lastDayToCancel'>[];
}): RetirementDate[] {
    const byDate = new Map<string, RetirementDate>();
    for (const row of preview.reached) {
        const seen = byDate.get(row.effectiveAt);
        byDate.set(row.effectiveAt, {
            effectiveAt: row.effectiveAt,
            lastDayToCancel: row.lastDayToCancel,
            count: (seen?.count ?? 0) + 1,
        });
    }
    return [...byDate.values()].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}

/** The order the reasons are listed in, from the plainest to the most particular. */
const SKIP_ORDER: readonly RetirementSkipReason[] = [
    'ended',
    'cancelled-before',
    'changes-before',
    'no-term',
    'already-told',
];

/** What is on the version and a preview does not reach, counted by reason. */
export function retirementSkips<R extends RetirementSkipReason>(preview: {
    readonly skipped: readonly { readonly reason: R }[];
}): Array<{ reason: R; count: number }> {
    return (SKIP_ORDER as readonly R[])
        .map((reason) => ({
            reason,
            count: preview.skipped.filter((row) => row.reason === reason).length,
        }))
        .filter((entry) => entry.count > 0);
}

/**
 * Whom a preview misses, one line per reason in the order `retirementSkips`
 * gives, each worded by the area's sentence for its reason.
 */
export function retirementSkipLines<R extends RetirementSkipReason>(
    preview: { readonly skipped: readonly { readonly reason: R }[] },
    sentences: Readonly<Record<R, string>>,
): Array<{ reason: R; text: string }> {
    return retirementSkips(preview).map(({ reason, count }) => ({
        reason,
        text: formatMessage(sentences[reason], { count }),
    }));
}

/**
 * The most recent announcement that retired `planVersionId`, or null — the
 * first in `records`, which the server lists the most recent first.
 */
export function retirementOf(
    records: readonly VersionRetirementView[],
    planVersionId: string,
): VersionRetirementView | null {
    return records.find((record) => record.retired.planVersionId === planVersionId) ?? null;
}

/**
 * The most recent announcement that retired the add-on version
 * `bundleVersionId`, or null — the first in `records`, most recent first.
 */
export function bundleRetirementOf(
    records: readonly BundleVersionRetirementView[],
    bundleVersionId: string,
): BundleVersionRetirementView | null {
    return records.find((record) => record.retired.bundleVersionId === bundleVersionId) ?? null;
}

/**
 * Where the subscriptions a retirement reached stand, in the order an operator
 * reads it, and last how many of them were reminded — a count beside the
 * states, not one of them.
 */
const PROGRESS_ORDER = ['overdue', 'notTold', 'waiting', 'moved', 'ended', 'reminded'] as const;

/**
 * The states that ask the operator for a look: a move that has not happened by
 * its date, and a subscription whose notice has reached nobody — it is not
 * moved until it is told.
 */
const NEEDS_ATTENTION: ReadonlySet<string> = new Set(['overdue', 'notTold']);

/**
 * How far a retirement has come, as the parts worth saying: each state with
 * subscriptions in it, the ones asking for attention first, and the reminded
 * ones last.
 */
export function retirementProgressParts(
    progress: RetirementProgress,
): Array<{ state: (typeof PROGRESS_ORDER)[number]; count: number; attention: boolean }> {
    return PROGRESS_ORDER.map((state) => ({
        state,
        count: progress[state],
        attention: NEEDS_ATTENTION.has(state),
    })).filter((part) => part.count > 0);
}

/**
 * A blocker in the operator's language: the catalogue's sentence for its code
 * where there is one, the server's English sentence otherwise.
 */
export function blockerText(
    blocker: RetirementBlocker,
    sentences: Readonly<Record<string, string>>,
): string {
    const template = sentences[blocker.code];
    return template ? formatMessage(template, blocker.params) : blocker.message;
}
