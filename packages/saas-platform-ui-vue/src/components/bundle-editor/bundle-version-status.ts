// Pure helper functions for the bundle-version UI — analogous to the
// plan simulation (saasadminui/project/bundles.jsx). The logic knows only
// the wire format (`BundleVersionRow`, `PlanVersionRow`), no DOM, no
// API calls — so it can be consumed 1:1 by the inline editor + strip +
// status banner + compat picker and called purely in tests.

import type { BundleVersionRow, PlanVersionRow } from '@saasicat/types';

import { SA_INTL_LOCALES, type SaLocale } from '../../client/i18n/locale.js';
import { bundlesMessages } from '../../client/i18n/messages/bundles.js';

/** UI lifecycle status of a single BundleVersion. */
export type BundleVersionUiStatus = 'draft' | 'live' | 'scheduled' | 'superseded';

/** Top-level status of a bundle stem across all versions. */
export type BundleAggregateStatus = BundleVersionUiStatus | 'retired';

/**
 * Status of a BundleVersion at a given date. Mapping:
 *   - draft     : publishedAt === null
 *   - superseded: supersededAt !== null  OR  validUntil < today
 *   - scheduled : published, validFrom > today, supersededAt === null
 *   - live      : otherwise (published, validFrom ≤ today ≤ validUntil)
 *
 * When `validFrom` is null (legacy version without lifecycle backfill),
 * the version is interpreted as "live" — this is the pragmatic
 * transitional behavior until the backfill migration.
 */
export function bundleVersionStatus(
    v: BundleVersionRow,
    now: Date = new Date(),
): BundleVersionUiStatus {
    if (v.publishedAt === null) return 'draft';
    if (v.supersededAt !== null) return 'superseded';
    if (v.validUntil) {
        const until = new Date(v.validUntil);
        if (!Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) {
            return 'superseded';
        }
    }
    if (v.validFrom) {
        const from = new Date(v.validFrom);
        if (!Number.isNaN(from.getTime()) && from.getTime() > now.getTime()) {
            return 'scheduled';
        }
    }
    return 'live';
}

/** UI metadata for a status (label, CSS class, tooltip). */
export interface BundleStatusMeta {
    label: string;
    cls: 'draft' | 'live' | 'scheduled' | 'supersed';
    tooltip: string;
}

const BUNDLE_STATUS_CLASS: Record<BundleAggregateStatus, BundleStatusMeta['cls']> = {
    draft: 'draft',
    live: 'live',
    scheduled: 'scheduled',
    superseded: 'supersed',
    retired: 'supersed',
};

/** Label, chip class and tooltip for a status in the given UI locale. */
export function bundleStatusMeta(
    status: BundleAggregateStatus,
    locale: SaLocale,
): BundleStatusMeta {
    const texts = bundlesMessages[locale].status[status];
    return { label: texts.label, cls: BUNDLE_STATUS_CLASS[status], tooltip: texts.tooltip };
}

/**
 * Sorts the versions of a bundle line ascending by
 * `validFrom` (drafts without validFrom go to the end).
 */
export function bundleVersionsSorted(versions: BundleVersionRow[]): BundleVersionRow[] {
    return [...versions].sort((a, b) => {
        const av = a.validFrom ?? '';
        const bv = b.validFrom ?? '';
        if (av === bv) return a.version - b.version;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv);
    });
}

/**
 * Currently active (live) bundle version or `null`.
 * Unlike `bundleVersionStatus`, this refers to the whole bundle
 * stem — used in the card header for the "Live · v3" display.
 */
export function bundleActiveVersionAt(
    versions: BundleVersionRow[],
    now: Date = new Date(),
): BundleVersionRow | null {
    return versions.find((v) => bundleVersionStatus(v, now) === 'live') ?? null;
}

export function bundleAggregateStatus(
    versions: BundleVersionRow[],
    deletedAt: string | null,
    now: Date = new Date(),
): BundleAggregateStatus {
    if (deletedAt) return 'retired';
    let hasLive = false;
    let hasScheduled = false;
    let hasSuperseded = false;
    let hasDraft = false;
    for (const v of versions) {
        const status = bundleVersionStatus(v, now);
        if (status === 'live') hasLive = true;
        else if (status === 'scheduled') hasScheduled = true;
        else if (status === 'superseded') hasSuperseded = true;
        else if (status === 'draft') hasDraft = true;
    }
    if (hasLive) return 'live';
    if (hasScheduled) return 'scheduled';
    if (hasDraft) return 'draft';
    if (hasSuperseded) return 'superseded';
    return 'draft';
}

/**
 * Overlap between a BundleVersion and a PlanVersion:
 * features + quotas that the plan already contains. Double counting
 * → warning in the editor (the bundle would count features multiple
 * times in the combined plan).
 */
export interface BundlePlanOverlap {
    features: string[];
    quotas: string[];
    hasAny: boolean;
}

export function findBundlePlanOverlap(
    bundle: { features: string[]; quotas?: Record<string, number> },
    plan: PlanVersionRow | null | undefined,
): BundlePlanOverlap {
    if (!plan) return { features: [], quotas: [], hasAny: false };
    const planFeatures = new Set(plan.features);
    const planQuotas = new Set(Object.keys(plan.quotas ?? {}));
    const features = bundle.features.filter((f) => planFeatures.has(f));
    const quotas = Object.keys(bundle.quotas ?? {}).filter((q) => planQuotas.has(q));
    return { features, quotas, hasAny: features.length > 0 || quotas.length > 0 };
}

/**
 * ISO `YYYY-MM-DD` → numeric date in the UI locale; null/empty → '—'.
 * Formatted in UTC so a calendar day never shifts across time zones.
 */
export function formatDate(iso: string | null | undefined, locale: SaLocale): string {
    if (!iso) return '—';
    const day = iso.slice(0, 10);
    const [y, m, d] = day.split('-');
    if (!y || !m || !d) return iso;
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(SA_INTL_LOCALES[locale], {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
    });
}
