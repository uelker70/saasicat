// The times of a maintenance window, between a person and the server.
//
// A person types a time into `<input type="datetime-local">`, which holds a
// wall-clock value without a zone. The server refuses a time without one
// (`SC-OPS-011`), so the value is read here in the browser's own zone — the
// zone the operator sees the form in, and which the form names beside the
// fields — and sent as an instant. Framework-free, so it is tested without a
// browser.

/** The zone the browser reads wall-clock times in, as the form names it. */
export function browserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * What a `datetime-local` input shows for `iso`: `YYYY-MM-DDTHH:mm` in the
 * browser's zone. Empty for no time, or one that is not a date.
 */
export function localInputOf(iso: string | null | undefined): string {
    if (!iso) return '';
    const moment = new Date(iso);
    if (Number.isNaN(moment.getTime())) return '';
    return (
        `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
        `T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
    );
}

/**
 * The instant a `datetime-local` value names, read in the browser's zone, as
 * an ISO string with its zone. Null for an empty or unreadable value.
 */
export function instantOfLocalInput(value: string): string | null {
    if (!value) return null;
    // A value without a zone is local time by the ECMAScript rules for a
    // date-time form, which is exactly the reading the form promises.
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}

/**
 * What a time field sends when a window is moved: nothing where it still shows
 * what the window had, and the instant otherwise. The input shows minutes, and a
 * window announced from the command line carries seconds — saving it for its
 * message alone must not move it.
 */
export function changedInstant(value: string, had: string | null | undefined): string | undefined {
    if (value === localInputOf(had)) return undefined;
    return instantOfLocalInput(value) ?? undefined;
}
