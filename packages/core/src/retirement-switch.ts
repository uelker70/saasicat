// What switching to a retirement's replacement before its date costs
// (`SC-SUB-032`). One answer for the page that offers the switch and the
// contract that records it.

import { sumToCents } from './money.js';
import type { VersionRetiredNotice } from './version-retirement.types.js';

/** What the switch costs, per period of the subscriber's rhythm. */
export interface RetirementSwitchTerms {
    /** The replacement's net price. */
    readonly priceNet: number;
    /**
     * Where the replacement costs more: the price the subscriber goes on paying,
     * the difference that is held, and the last day it is held — the day before
     * the date they were told. Null where it costs the same or less: its price
     * then applies from the subscriber's next period.
     */
    readonly held: {
        readonly priceNet: number;
        readonly amountNet: number;
        readonly lastDay: string;
    } | null;
}

/**
 * What switching to the replacement now costs in `billingCycle`, or null where
 * the replacement has no price in it.
 */
export function retirementSwitchTerms(
    notice: Pick<VersionRetiredNotice, 'retired' | 'replacement' | 'lastDayToCancel'>,
    billingCycle: string,
): RetirementSwitchTerms | null {
    const priceIn = (side: VersionRetiredNotice['retired']) =>
        billingCycle === 'YEARLY' ? side.yearlyNet : side.monthlyNet;
    const replacement = priceIn(notice.replacement);
    if (replacement === null) return null;
    const retired = priceIn(notice.retired);
    if (retired === null || replacement <= retired) return { priceNet: replacement, held: null };
    return {
        priceNet: replacement,
        held: {
            priceNet: retired,
            amountNet: sumToCents(replacement, -retired),
            // The last day to cancel without notice is the same day: the last
            // whole one before the date the replacement takes over.
            lastDay: notice.lastDayToCancel,
        },
    };
}
