// Placeholder interpolation for catalog messages: `{name}` is replaced with
// `params.name`. Unknown placeholders stay verbatim so a missing param is
// visible in the UI instead of silently disappearing.
//
// The implementation lives in `@saasicat/core` because the shipped error-text
// catalogue needs the same interpolation and must not depend on a UI package.
// This stays as the name the UI code already imports.

import { formatErrorMessage } from '@saasicat/core';

export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams): string {
    return formatErrorMessage(template, params);
}

/**
 * A calendar day (`YYYY-MM-DD`, or an ISO timestamp whose day is meant) as the
 * reader writes it. Formatted as the UTC day, so a day stored at midnight UTC
 * does not show as the day before west of Greenwich.
 */
export function formatDay(day: string, intlLocale: string): string {
    return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString(intlLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/**
 * A moment in the reader's own zone and language, with the zone named — what
 * a person typed into a time field and reads back. A dash for none.
 */
export function formatMoment(iso: string | null, intlLocale: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(intlLocale, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}
