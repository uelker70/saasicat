// Reine Helper-Funktionen für die Bundle-Versions-UI — analog zur
// Plan-Simulation (saasadminui/project/bundles.jsx). Die Logik kennt nur
// das Wire-Format (`BundleVersionRow`, `PlanVersionRow`), kein DOM, keine
// API-Calls — damit ist sie 1:1 vom Inline-Editor + Strip + Status-Banner
// + Compat-Picker konsumierbar und in Tests pure aufrufbar.

import type { BundleVersionRow, PlanVersionRow } from '@saasicat/types';

/** UI-Lifecycle-Status einer einzelnen BundleVersion. */
export type BundleVersionUiStatus = 'draft' | 'live' | 'scheduled' | 'superseded';

/** Top-Level-Status eines Bundle-Stamms über alle Versionen. */
export type BundleAggregateStatus = BundleVersionUiStatus | 'retired';

/**
 * Status einer BundleVersion zu einem Stichtag. Mapping:
 *   - draft     : publishedAt === null
 *   - superseded: supersededAt !== null  ODER  validUntil < today
 *   - scheduled : published, validFrom > today, supersededAt === null
 *   - live      : sonst (published, validFrom ≤ today ≤ validUntil)
 *
 * Wenn `validFrom` null ist (Bestand-Version ohne Lifecycle-Backfill),
 * wird die Version als „live" interpretiert — das ist das pragmatische
 * Übergangs-Verhalten bis zur Backfill-Migration.
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

/** UI-Meta-Daten für einen Status (Label, CSS-Klasse, Tooltip). */
export interface BundleStatusMeta {
    label: string;
    cls: 'draft' | 'live' | 'scheduled' | 'supersed';
    tooltip: string;
}

export const BUNDLE_STATUS_META: Record<BundleAggregateStatus, BundleStatusMeta> = {
    draft: {
        label: 'Draft',
        cls: 'draft',
        tooltip: 'Noch nicht veröffentlicht — frei editierbar',
    },
    live: {
        label: 'Live',
        cls: 'live',
        tooltip: 'Aktive Version · verkaufbar · read-only (laufende Verträge)',
    },
    scheduled: {
        label: 'Geplant',
        cls: 'scheduled',
        tooltip: 'Zukünftig aktiv · noch nicht verkaufbar · frei editierbar',
    },
    superseded: {
        label: 'Abgelöst',
        cls: 'supersed',
        tooltip: 'Durch neue Version ersetzt · Bestand bleibt',
    },
    retired: {
        label: 'Retired',
        cls: 'supersed',
        tooltip: 'Bundle-Stamm wurde soft-deleted',
    },
};

/**
 * Sortiert die Versionen einer Bundle-Linie aufsteigend nach
 * `validFrom` (Drafts ohne validFrom ans Ende).
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
 * Aktuell aktive (live) Bundle-Version oder `null`.
 * Im Gegensatz zu `bundleVersionStatus` bezogen auf den ganzen Bundle-
 * Stamm — wird im Card-Header für „Live · v3"-Anzeige genutzt.
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
 * Überschneidung zwischen einer BundleVersion und einer PlanVersion:
 * Features + Quotas, die der Plan bereits enthält. Doppelte Berechnung
 * → Warnung im Editor (Bundle würde im kombinierten Tarif Features
 * mehrfach zählen).
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

/** ISO-`YYYY-MM-DD` → `DD.MM.YYYY` für UI-Anzeige; null/leer → '—'. */
export function formatDateDE(iso: string | null | undefined): string {
    if (!iso) return '—';
    const day = iso.slice(0, 10);
    const [y, m, d] = day.split('-');
    if (!y || !m || !d) return iso;
    return `${d}.${m}.${y}`;
}
