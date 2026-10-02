// What an operator reads off a retirement before announcing it, framework-free:
// which versions may be retired, the dates the subscriptions move on, and the
// ones it does not reach.

import type {
    PlanVersionRow,
    RetirementBlocker,
    RetirementPreview,
    RetirementSkipReason,
    VersionRetirementRecord,
} from '@saasicat/core';

import { formatMessage } from './i18n/format.js';
import { versionSale } from './version-sale.js';

/**
 * Whether a retirement may be started for `version` at `now`: published and no
 * longer on sale, so nobody books it after the announcement. The server
 * decides again; this only says where the action is offered.
 */
export function isRetirable(version: PlanVersionRow, now: Date): boolean {
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

/** The dates the subscriptions a preview reaches move on, the earliest first. */
export function retirementDates(preview: RetirementPreview): RetirementDate[] {
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

/** The subscriptions on the version a preview does not reach, counted by reason. */
export function retirementSkips(
    preview: RetirementPreview,
): Array<{ reason: RetirementSkipReason; count: number }> {
    return SKIP_ORDER.map((reason) => ({
        reason,
        count: preview.skipped.filter((row) => row.reason === reason).length,
    })).filter((entry) => entry.count > 0);
}

/**
 * The most recent announcement that retired `planVersionId`, or null — the
 * first in `records`, which the server lists the most recent first.
 */
export function retirementOf(
    records: readonly VersionRetirementRecord[],
    planVersionId: string,
): VersionRetirementRecord | null {
    return records.find((record) => record.retired.planVersionId === planVersionId) ?? null;
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
