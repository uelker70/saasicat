// How often the server log says that a due deletion is held before it begins.
//
// The run comes every quarter of an hour and asks every due tenant again, so a
// tenant held for a day would be said 96 times — over an unmarked database,
// the operator's preview, for every due tenant, while everything is as it
// should be. A line is said when it first holds, again at once when what holds
// changes, and otherwise once each installation day, so the log keeps saying
// it without drowning what else it says.
//
// Kept in the process and nowhere else: each instance says it once, and a
// restart says it again, which costs a line and loses nothing.

import type { CalendarDay } from '@saasicat/core';

/** What was said last of one subject, and on which day. */
interface Said {
    readonly what: string;
    readonly day: CalendarDay;
}

/** Decides, subject by subject, whether a line about a held deletion is said. */
export class DeletionLogThrottle {
    private readonly said = new Map<string, Said>();

    /**
     * Whether to say `what` of `subject` on `day`, noting it as said where it
     * is: the first time, where `what` differs from what was said last, and
     * on a day other than the one it was said on.
     */
    shouldSay(subject: string, what: string, day: CalendarDay): boolean {
        const last = this.said.get(subject);
        if (last && last.what === what && last.day === day) return false;
        this.said.set(subject, { what, day });
        return true;
    }
}
