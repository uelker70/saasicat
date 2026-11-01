import type { CalendarDay } from '@saasicat/core';

/**
 * A calendar day the server handed out (`YYYY-MM-DD`), as an instant the
 * application's date formatter can be handed.
 *
 * The formatter is the application's, and it reads an instant in the viewer's
 * zone. So the instant is noon of that day in the viewer's zone, which every
 * zone writes as that day — the server decided which day it is, and the
 * formatter only decides how it is written.
 */
export function dayAsInstant(day: CalendarDay): string {
    const [year = Number.NaN, month = Number.NaN, date = Number.NaN] = day.split('-').map(Number);
    return new Date(year, month - 1, date, 12).toISOString();
}

/** `day` as the application's formatter writes days; a dash where there is none. */
export function writeDay(
    formatDate: (iso: string) => string,
    day: CalendarDay | null | undefined,
): string {
    return day ? formatDate(dayAsInstant(day)) : '—';
}
