// The values of a refusal that are days.
//
// A refusal carries the values its sentence names beside it (`params`), so a
// reader's catalogue can build the sentence in their language. A day among them
// is one the server named in the installation's zone (`SC-UI-028`), written
// `YYYY-MM-DD`; how a reader sees it written is the application's business, as
// for every other day it shows. So a refusal names which of its values are days
// (`dayParams`), and a page writes exactly those with its formatter, rather
// than guessing from a value's shape — a reference or a label can look like a
// day as well.

import type { CalendarDay } from './zoned-day.js';

/**
 * `params` with each value `dayParams` names written by `write`. A name that is
 * not there, or whose value is not text, is left as it is; `dayParams` arrives
 * in a response, so anything but a list of names names nothing.
 */
export function writeDayParams<Value>(
    params: Readonly<Record<string, Value>>,
    dayParams: unknown,
    write: (day: CalendarDay) => string,
): Record<string, Value | string> {
    if (!Array.isArray(dayParams)) return { ...params };
    const written: Record<string, Value | string> = { ...params };
    for (const name of dayParams) {
        if (typeof name !== 'string') continue;
        const day = written[name];
        if (typeof day === 'string') written[name] = write(day);
    }
    return written;
}
