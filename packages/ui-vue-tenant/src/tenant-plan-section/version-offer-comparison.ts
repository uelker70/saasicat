/**
 * What the version offer card compares, read off the offer: the price in each
 * rhythm, each quota, and the features one version has and the other does
 * not. Framework-free, so the rules for reading an offer sit apart from how the
 * card draws them.
 */

import type { VersionOfferSide, VersionOfferView } from '@saasicat/core';

import type { BadgeTone } from '../ui/badge-tone.js';

export type VersionOfferKind = VersionOfferView['class'];

/**
 * What a comparison reads off a version: its prices, quotas and features. A
 * plan version offered or retired and an add-on version retired carry all
 * four.
 */
export type ComparedVersion = Pick<
    VersionOfferSide,
    'features' | 'quotas' | 'monthlyNet' | 'yearlyNet'
>;

/**
 * Two versions side by side: the one the subscriber has, and the other — a
 * version offered, or the replacement a retirement announces.
 */
export interface VersionPair {
    readonly bound: ComparedVersion;
    readonly offered: ComparedVersion;
}

/** One rhythm's net price in both versions; `null` where a version is not sold in it. */
export interface OfferPriceRow {
    rhythm: 'MONTHLY' | 'YEARLY';
    bound: number | null;
    offered: number | null;
}

/**
 * One quota in both versions. A quota a version does not carry allows nothing,
 * as the classification counts it; `-1` is unlimited.
 */
export interface OfferQuotaRow {
    key: string;
    bound: number;
    offered: number;
}

export function offerPriceRows(offer: VersionPair): OfferPriceRow[] {
    return [
        { rhythm: 'MONTHLY', bound: offer.bound.monthlyNet, offered: offer.offered.monthlyNet },
        { rhythm: 'YEARLY', bound: offer.bound.yearlyNet, offered: offer.offered.yearlyNet },
    ];
}

/** Every quota either version carries, the bound version's first, in their own order. */
export function offerQuotaRows(offer: VersionPair): OfferQuotaRow[] {
    const keys = [
        ...Object.keys(offer.bound.quotas),
        ...Object.keys(offer.offered.quotas).filter((key) => !(key in offer.bound.quotas)),
    ];
    return keys.map((key) => ({
        key,
        bound: offer.bound.quotas[key] ?? 0,
        offered: offer.offered.quotas[key] ?? 0,
    }));
}

/** The features the version offered adds, and the ones it no longer has. */
export function offerFeatureChanges(offer: VersionPair): {
    added: string[];
    removed: string[];
} {
    const bound = new Set(offer.bound.features);
    const offered = new Set(offer.offered.features);
    return {
        added: offer.offered.features.filter((key) => !bound.has(key)),
        removed: offer.bound.features.filter((key) => !offered.has(key)),
    };
}

/** The badge tone a kind of offer is shown in; its label says the same in words. */
export function offerTone(kind: VersionOfferKind): BadgeTone {
    if (kind === 'improvement') return 'positive';
    if (kind === 'more-for-more') return 'info';
    return 'warning';
}

/**
 * Whether taking it asks first. An improvement is taken by one click; one that
 * costs more, or takes something away, says what it does before it does it.
 */
export function offerAsksFirst(kind: VersionOfferKind): boolean {
    return kind !== 'improvement';
}
