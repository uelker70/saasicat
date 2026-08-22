// The vocabulary a status renders in, and the one mapping that is shared.
//
// Nine places on the admin surface show a status, and three of them had grown
// their own status-to-colour function. Two of those three were the same promo
// vocabulary written twice — one returning `amber-7`, the other `amber-7`, and
// neither able to tell you why an exhausted code is red.
//
// What is NOT here is a central `statusTone(domain, status)` table. AP2 sketched
// one, but the layering says otherwise and it is right: `src/vue/` sits below
// the domain code, so a table here could only take `string` and answer with a
// fallback — which is how an unknown status becomes grey instead of a compile
// error. Each domain therefore owns its own map, typed against its own union,
// and what lives here is the vocabulary they all speak plus the one union that
// genuinely is shared.

import type { PromoCodeStatus } from '@saasicat/types';

/**
 * How a status pill is coloured. A role, not a colour — the theme decides what
 * `warning` looks like in light and in dark, and a consumer's brand can move it.
 */
export type PillTone =
    'positive' | 'warning' | 'negative' | 'muted' | 'primary' | 'accent' | 'info';

/**
 * Tone per promo-code status. Exhaustive by construction: adding a status to
 * `PromoCodeStatus` fails this file to compile until it is given a tone, which
 * is the point — the alternative is a new status silently rendering as grey.
 *
 * `EXHAUSTED` is `muted` rather than `negative`: a code that has been fully
 * redeemed did its job. The two hand-written copies this replaces both fell
 * through to red, which read as a fault on the campaign that worked best.
 */
export const PROMO_STATUS_TONE: Readonly<Record<PromoCodeStatus, PillTone>> = {
    ACTIVE: 'positive',
    PAUSED: 'warning',
    EXPIRED: 'muted',
    EXHAUSTED: 'muted',
};

/** The tone a promo-code status renders in. */
export function promoStatusTone(status: PromoCodeStatus): PillTone {
    return PROMO_STATUS_TONE[status];
}
