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
 * A calendar day (`YYYY-MM-DD`) as the reader writes it — that day in every
 * zone, so it is written from its UTC midnight in UTC. A moment is no day: it
 * becomes one by `client/installation-day.ts`, which says which day is meant.
 */
export function formatDay(day: string, intlLocale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(intlLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/** A calendar day in the short form a list writes, `28 Oct 2026` — that day in every zone. */
export function formatShortDay(day: string, intlLocale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(intlLocale, {
        day: '2-digit',
        month: 'short',
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
