// Reading a moment somebody typed, with its time zone.
//
// A time written without an offset means a different moment on every machine
// that reads it — the operator's laptop, the deploy runner, the server — and a
// maintenance window announced for 22:00 would begin at 22:00 wherever the
// reader happened to be (`SC-OPS-011`). So a time without one is refused, not
// read in a zone somebody has to guess.

/** Whether `text` ends in an offset written as `+hh:mm` or `-hh:mm`. */
function endsInOffset(text: string): boolean {
    const sign = text.charAt(text.length - 6);
    return (sign === '+' || sign === '-') && text.charAt(text.length - 3) === ':';
}

/**
 * The moment an ISO 8601 date and time names, provided it states its zone —
 * `2026-10-02T22:00+02:00` or `2026-10-02T20:00Z`. Null for anything else: a
 * date without a time, a time without a zone, or text that is not a date.
 */
export function parseZonedInstant(text: string): Date | null {
    const value = text.trim();
    if (!value.includes('T')) return null;
    const zoned = value.endsWith('Z') || value.endsWith('z') || endsInOffset(value);
    if (!zoned) return null;
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? null : moment;
}
