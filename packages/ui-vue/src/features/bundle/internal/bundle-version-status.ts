// Pure helper functions for the bundle-version UI — analogous to the
// plan simulation (saasadminui/project/bundles.jsx). The logic knows only
// the wire format (`BundleVersionRow`, `PlanVersionRow`), no DOM, no
// API calls — so it can be consumed 1:1 by the inline editor + strip +
// status banner + compat picker and called purely in tests.

import type { BundleVersionRow, PlanVersionRow } from '@saasicat/core';

import type { SaMessages } from '../../../client/i18n/messages.js';
import {
    describeVersionSale,
    versionOnSale,
    versionSale,
    type VersionSaleKind,
} from '../../../client/version-sale.js';

/** Where a single BundleVersion stands — the platform's sale rule (`versionSale`). */
export type BundleVersionUiStatus = VersionSaleKind;

/** Top-level status of a bundle stem across all versions. */
export type BundleAggregateStatus = BundleVersionUiStatus | 'retired';

/** Where `v` stands at `now`. */
export function bundleVersionStatus(
    v: BundleVersionRow,
    now: Date = new Date(),
): BundleVersionUiStatus {
    return versionSale(v, now).kind;
}

/** UI metadata for a status (label, CSS class, tooltip). */
export interface BundleStatusMeta {
    label: string;
    cls: 'draft' | 'live' | 'scheduled' | 'supersed';
    tooltip: string;
}

const BUNDLE_STATUS_CLASS: Record<BundleAggregateStatus, BundleStatusMeta['cls']> = {
    draft: 'draft',
    'on-sale': 'live',
    scheduled: 'scheduled',
    'off-sale': 'supersed',
    retired: 'supersed',
};

const BUNDLE_STATUS_TOOLTIP: Record<BundleAggregateStatus, keyof SaMessages['bundles']['status']> =
    {
        draft: 'draft',
        'on-sale': 'onSale',
        scheduled: 'scheduled',
        'off-sale': 'offSale',
        retired: 'retired',
    };

/** The texts a status is worded with, as the active catalogue resolves them. */
export interface BundleStatusTexts {
    readonly bundles: SaMessages['bundles'];
    readonly common: SaMessages['common'];
    readonly intlLocale: string;
}

/**
 * Label, chip class and tooltip for a status. The label is where `version`
 * stands, with its day; a retired bundle has a label of its own. Takes the
 * resolved slices rather than a locale code — that is what lets an
 * app-supplied language and `i18n.overrides` reach these labels.
 */
export function bundleStatusMeta(
    status: BundleAggregateStatus,
    version: BundleVersionRow | null,
    texts: BundleStatusTexts,
    now: Date = new Date(),
): BundleStatusMeta {
    const label =
        status === 'retired' || version === null
            ? texts.bundles.status.retired.label
            : describeVersionSale(
                  versionSale(version, now),
                  texts.common.versionSale,
                  texts.intlLocale,
              );
    return {
        label,
        cls: BUNDLE_STATUS_CLASS[status],
        tooltip: texts.bundles.status[BUNDLE_STATUS_TOOLTIP[status]].tooltip,
    };
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

/** Where a bundle stands as a whole, and the version that decides it. */
export interface BundleAggregate {
    readonly status: BundleAggregateStatus;
    /** The version on sale, else the next scheduled, else the draft, else the newest. */
    readonly version: BundleVersionRow | null;
}

/**
 * A bundle is on sale while one of its versions is; otherwise it is scheduled
 * while one will be, a draft while it has only an unpublished one, and off sale
 * once every published version is. A retired bundle is retired whatever its
 * versions say.
 */
export function bundleAggregate(
    versions: BundleVersionRow[],
    deletedAt: string | null,
    now: Date = new Date(),
): BundleAggregate {
    const newest = [...versions].sort((a, b) => b.version - a.version)[0] ?? null;
    if (deletedAt) return { status: 'retired', version: newest };
    const onSale = versionOnSale(versions, now);
    if (onSale) return { status: 'on-sale', version: onSale };
    const scheduled = bundleVersionsSorted(versions).find(
        (v) => bundleVersionStatus(v, now) === 'scheduled',
    );
    if (scheduled) return { status: 'scheduled', version: scheduled };
    const draft = versions.find((v) => v.publishedAt === null);
    if (draft) return { status: 'draft', version: draft };
    if (newest) return { status: 'off-sale', version: newest };
    return { status: 'draft', version: null };
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
