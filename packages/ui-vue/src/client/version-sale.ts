// Whether a plan or add-on version is on sale, as the admin says it.
//
// The platform decides it once (`isVersionActiveAt` in `@saasicat/core`): the
// catalogue, checkout and every booking ask that window. The admin asks the
// same function, so a version the operator sees as on sale is the one a tenant
// can book — and a predecessor whose successor starts next month is still on
// sale until then, though it was superseded the day the successor was
// published.
//
// Framework-free: dates in, a state out. Every admin surface that shows a
// version's state reads it from here, and words it with `describeVersionSale`.

import { isVersionActiveAt, type VersionWindow } from '@saasicat/core';

import { formatDay, formatMessage } from './i18n/format.js';
import type { SaMessages } from './i18n/messages.js';

/** The dates of a version that decide its state, as a row carries them. */
export interface VersionSaleDates extends VersionWindow {
    readonly publishedAt?: string | null;
}

/**
 * Where a version stands. A day is an ISO date (`YYYY-MM-DD`, UTC):
 * - `scheduled` — published and not on sale yet; `from` is its first day.
 * - `on-sale` — on sale now; `until` is its last day, where one is known.
 * - `off-sale` — no longer on sale; `since` is its first day off sale, where
 *   one is known — a version superseded without a last day has none.
 */
export type VersionSale =
    | { readonly kind: 'draft' }
    | { readonly kind: 'scheduled'; readonly from: string }
    | { readonly kind: 'on-sale'; readonly until: string | null }
    | { readonly kind: 'off-sale'; readonly since: string | null };

export type VersionSaleKind = VersionSale['kind'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The state of `version` at `now`. */
export function versionSale(version: VersionSaleDates, now: Date): VersionSale {
    if (!version.publishedAt) return { kind: 'draft' };
    if (isVersionActiveAt(version, now)) {
        return { kind: 'on-sale', until: lastDayOnSale(version) };
    }
    // A start still to come is announced only where the version will be on
    // sale on that day: one superseded before it started never will be.
    const start = dateOf(version.validFrom);
    if (start && start > now && isVersionActiveAt(version, start)) {
        return { kind: 'scheduled', from: dayOf(start) };
    }
    return { kind: 'off-sale', since: firstDayOffSale(version, now) };
}

/**
 * The version on sale at `now` among one plan's or add-on's versions, in the
 * order the platform picks it: the latest `validFrom`, a version without one
 * last, then the highest number.
 */
export function versionOnSale<V extends VersionSaleDates & { readonly version?: number }>(
    versions: readonly V[],
    now: Date,
): V | null {
    const onSale = versions.filter((v) => versionSale(v, now).kind === 'on-sale');
    const startOf = (v: V): number => dateOf(v.validFrom)?.getTime() ?? -Infinity;
    onSale.sort((a, b) => startOf(b) - startOf(a) || (b.version ?? 0) - (a.version ?? 0));
    return onSale[0] ?? null;
}

/**
 * What a listing shows for a plan or add-on: the version on sale, otherwise
 * the next one scheduled. A draft is not shown by this.
 */
export function versionOnSaleOrNext<V extends VersionSaleDates & { readonly version?: number }>(
    versions: readonly V[],
    now: Date,
): V | null {
    const onSale = versionOnSale(versions, now);
    if (onSale) return onSale;
    const scheduled = versions.filter((v) => versionSale(v, now).kind === 'scheduled');
    const startOf = (v: V): number => dateOf(v.validFrom)?.getTime() ?? Infinity;
    scheduled.sort((a, b) => startOf(a) - startOf(b));
    return scheduled[0] ?? null;
}

/** The state in the reader's words, with its day where it has one. */
export function describeVersionSale(
    sale: VersionSale,
    texts: SaMessages['common']['versionSale'],
    intlLocale: string,
): string {
    const on = (day: string): { date: string } => ({ date: formatDay(day, intlLocale) });
    switch (sale.kind) {
        case 'draft':
            return texts.draft;
        case 'scheduled':
            return formatMessage(texts.scheduled, on(sale.from));
        case 'on-sale':
            return sale.until ? formatMessage(texts.onSaleUntil, on(sale.until)) : texts.onSale;
        case 'off-sale':
            return sale.since ? formatMessage(texts.offSaleSince, on(sale.since)) : texts.offSale;
    }
}

/** The last day on sale: the earlier of its last day and the day before it ends. */
function lastDayOnSale(version: VersionSaleDates): string | null {
    const days: string[] = [];
    const validUntil = dateOf(version.validUntil);
    if (validUntil) days.push(dayOf(validUntil));
    const endsAt = dateOf(version.endsAt);
    // `endsAt` is a moment and the sale stops at it, so the last day is the
    // one its final millisecond on sale falls in.
    if (endsAt) days.push(dayOf(new Date(endsAt.getTime() - 1)));
    return earliest(days);
}

/** The first day off sale, of the ends that have passed by `now`. */
function firstDayOffSale(version: VersionSaleDates, now: Date): string | null {
    const days: string[] = [];
    const validUntil = dateOf(version.validUntil);
    if (validUntil && dayOf(validUntil) < dayOf(now)) {
        days.push(dayOf(new Date(validUntil.getTime() + DAY_MS)));
    }
    const endsAt = dateOf(version.endsAt);
    if (endsAt && endsAt <= now) days.push(dayOf(endsAt));
    return earliest(days);
}

function earliest(days: string[]): string | null {
    return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

function dateOf(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dayOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}
