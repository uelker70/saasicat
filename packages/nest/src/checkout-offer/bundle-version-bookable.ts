// Whether a bundle version can be booked at a moment — the window
// `findActiveBundleVersion` asks the database for, for a row already read.
//
// Asked twice about an offer: when it is priced, so an add-on no longer on sale
// is not put into it, and when it is consumed, so one that went off sale in
// between does not become part of a contract. A tenant booking an add-on and
// its preview ask the same.

import type { BundleVersionRow } from '@saasicat/core';
import { startOfUtcDay } from '@saasicat/core';

/** Why the version cannot be booked at `nowMs`, or `null` when it can. */
export function bundleVersionNotBookableReason(
    version: Pick<BundleVersionRow, 'publishedAt' | 'supersededAt' | 'validFrom' | 'validUntil'>,
    nowMs: number,
): 'not_published' | 'superseded' | 'not_yet_valid' | 'expired' | null {
    if (version.publishedAt === null) return 'not_published';
    if (dateIsAfter(version.validFrom, nowMs)) return 'not_yet_valid';
    if (isValidUntilExpired(version.validUntil, nowMs)) return 'expired';
    // A superseded version keeps selling until its window closes — a successor
    // published today may start next month — but only within a last day it
    // carries: one superseded without, as a row from before the dates were
    // kept is, never closes (`buildActiveVersionWhere`).
    if (version.supersededAt !== null && !version.validUntil) return 'superseded';
    return null;
}

function dateIsAfter(value: string | null, nowMs: number): boolean {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isNaN(time) || time > nowMs;
}

/**
 * `validUntil` is day-inclusive (a UTC midnight date): expired only from the
 * following day, i.e. when validUntil < startOfDay(now). Symmetric to the
 * catalog resolver (`buildActivePlanVersionWhere`).
 */
export function isValidUntilExpired(value: string | null | undefined, nowMs: number): boolean {
    if (!value) return false;
    const validUntil = new Date(value).getTime();
    if (Number.isNaN(validUntil)) return true;
    return validUntil < startOfUtcDay(new Date(nowMs)).getTime();
}
