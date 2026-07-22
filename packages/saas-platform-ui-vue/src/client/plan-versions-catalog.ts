// Catalog snapshot builder — projects PlanVersion rows onto synthetic
// catalog snapshots that the plan-versions UI renders.
//
// The backend knows no catalog snapshots; we derive them from the real
// `publishedAt` / `supersededAt` events. Three snapshot kinds:
//
//   - `drafts`     : Hypothetical "after publishing all open drafts" state
//   - `active`     : Currently live (publishedAt set, supersededAt null)
//   - `historical` : One snapshot per publish event, before `active`
//
// Plan IDs are sorted alphabetically; consumers may enforce a preferred
// order via `planSortOrder` (e.g.
// BASIC < STANDARD < PROFESSIONAL < BUSINESS < ENTERPRISE).
//
// Phase 2b: ported from a consumer admin,
// app-specific fields kept open via generics.

import type { PlanVersionRow } from '@saasicat/types';

import { formatMessage } from './i18n/format.js';
import { DEFAULT_SA_LOCALE, SA_INTL_LOCALES, type SaLocale } from './i18n/locale.js';
import { planVersionsMessages } from './i18n/messages/plan-versions.js';

export type SnapshotKind = 'drafts' | 'active' | 'historical';

export interface CatalogSnapshot<P extends PlanVersionRow = PlanVersionRow> {
    id: string;
    kind: SnapshotKind;
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    label: string;
    title: string;
    description: string;

    asOf: string | null;
    createdAt: string | null;
    publishedAt: string | null;
    authorEmail: string | null;

    plans: ResolvedPlan<P>[];

    /** Number of open drafts for the `drafts` snapshot, otherwise 0. */
    draftCount: number;
    /** Number of entities in this snapshot whose publication flagged at least
     *  one regression (`nonRegressive === false`). */
    regressionCount: number;
}

export interface ResolvedPlan<P extends PlanVersionRow = PlanVersionRow> {
    /** Which PlanVersionRow was selected to represent this slot. */
    source: P;
    /** Live predecessor (only set when `source` is a DRAFT; otherwise null). */
    liveBase: P | null;
    isDraft: boolean;
    planId: string;
    features: string[];
    /** Quota map (from `source.quotas` or legacy fields; empty if none). */
    quotas: Record<string, number>;
    monthlyNet: number;
    yearlyNet: number;
    marketed: boolean;
    version: number;

    // Legacy quota mirrors for UI components that have not yet switched to
    // `quotas[key]`. Mirrored from `quotas['users'] / 'vehicles' / 'storageGb'`;
    // for apps without these quotas they stay undefined.
    /** @deprecated Read from `quotas['users']`. */
    maxUsers?: number;
    /** @deprecated Legacy field; read from `quotas['vehicles']`. */
    maxVehicles?: number;
    /** @deprecated Read from `quotas['storageGb']`. */
    maxStorageGb?: number;
}

export interface RawCatalogData<P extends PlanVersionRow = PlanVersionRow> {
    planVersions: P[];
}

export interface BuildSnapshotsOptions {
    /**
     * App-specific plan order, e.g. `['BASIC', 'STANDARD',
     * 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']`. Plan IDs outside the list
     * end up sorted alphabetically at the back.
     */
    planSortOrder?: readonly string[];
    /** UI locale for the generated snapshot labels/titles/descriptions. */
    locale?: SaLocale;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const dec = (s: string): number => Number(s);

function extractQuotas(p: PlanVersionRow): Record<string, number> {
    if (p.quotas && Object.keys(p.quotas).length > 0) {
        return { ...p.quotas };
    }
    // Legacy fallback: collect the flat fields.
    const out: Record<string, number> = {};
    if (typeof p.maxUsers === 'number') out.users = p.maxUsers;
    if (typeof p.maxVehicles === 'number') out.vehicles = p.maxVehicles;
    if (typeof p.maxStorageGb === 'number') out.storageGb = p.maxStorageGb;
    return out;
}

const sortByPublishedDesc = <T extends { publishedAt: string | null; version: number }>(
    rows: T[],
): T[] =>
    [...rows].sort((a, b) => {
        const at = a.publishedAt ? Date.parse(a.publishedAt) : Number.POSITIVE_INFINITY;
        const bt = b.publishedAt ? Date.parse(b.publishedAt) : Number.POSITIVE_INFINITY;
        if (at !== bt) return bt - at;
        return b.version - a.version;
    });

/**
 * Finds the live version valid for an entity slot at the point in time `asOf`.
 * A version was live when `publishedAt <= asOf` and (`supersededAt == null`
 * or `supersededAt > asOf`) held.
 */
function findLiveAt<
    T extends { publishedAt: string | null; supersededAt: string | null; version: number },
>(rows: T[], asOfMs: number): T | null {
    const candidates = rows.filter((r) => {
        if (r.publishedAt === null) return false;
        if (Date.parse(r.publishedAt) > asOfMs) return false;
        if (r.supersededAt !== null && Date.parse(r.supersededAt) <= asOfMs) return false;
        return true;
    });
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => b.version - a.version)[0] ?? null;
}

function findCurrentLive<T extends { publishedAt: string | null; supersededAt: string | null }>(
    rows: T[],
): T | null {
    return rows.find((r) => r.publishedAt !== null && r.supersededAt === null) ?? null;
}

function findDraft<T extends { publishedAt: string | null }>(rows: T[]): T | null {
    return rows.find((r) => r.publishedAt === null) ?? null;
}

function groupBy<T, K extends string>(rows: T[], keyOf: (r: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const r of rows) {
        const k = keyOf(r);
        const list = out.get(k) ?? [];
        list.push(r);
        out.set(k, list);
    }
    return out;
}

// ─── Resolver ────────────────────────────────────────────────────────────

function resolvePlan<P extends PlanVersionRow>(source: P, liveBase: P | null): ResolvedPlan<P> {
    const quotas = extractQuotas(source);
    return {
        source,
        liveBase,
        isDraft: source.publishedAt === null,
        planId: source.planId,
        features: source.features,
        quotas,
        monthlyNet: dec(source.monthlyNet),
        yearlyNet: dec(source.yearlyNet),
        marketed: source.marketed,
        version: source.version,
        maxUsers: quotas.users,
        maxVehicles: quotas.vehicles,
        maxStorageGb: quotas.storageGb,
    };
}

// ─── Snapshot constructors ───────────────────────────────────────────────

type CatalogMessages = (typeof planVersionsMessages)['de']['catalog'];

function draftsTitle(draftCount: number, msg: CatalogMessages): string {
    if (draftCount === 0) return msg.draftsTitleEmpty;
    const template = draftCount === 1 ? msg.draftsTitleOne : msg.draftsTitleMany;
    return formatMessage(template, { count: draftCount });
}

function dateLabel(iso: string, locale: SaLocale): string {
    return new Date(iso).toLocaleDateString(SA_INTL_LOCALES[locale], {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function buildDraftsSnapshot<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
    sortPlansFn: (rows: ResolvedPlan<P>[]) => ResolvedPlan<P>[],
    locale: SaLocale,
): CatalogSnapshot<P> {
    const msg = planVersionsMessages[locale].catalog;
    const planByKey = groupBy(data.planVersions, (r) => r.planId);

    const plans: ResolvedPlan<P>[] = [];
    for (const [, rows] of planByKey) {
        const draft = findDraft(rows);
        const live = findCurrentLive(rows);
        if (draft) plans.push(resolvePlan(draft, live));
        else if (live) plans.push(resolvePlan(live, null));
    }

    const draftCount = plans.filter((p) => p.isDraft).length;

    return {
        id: 'drafts',
        kind: 'drafts',
        status: 'DRAFT',
        label: msg.draftsLabel,
        title: draftsTitle(draftCount, msg),
        description: draftCount === 0 ? msg.draftsDescriptionEmpty : msg.draftsDescription,
        asOf: null,
        createdAt: null,
        publishedAt: null,
        authorEmail: null,
        plans: sortPlansFn(plans),
        draftCount,
        regressionCount: 0,
    };
}

function buildActiveSnapshot<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
    sortPlansFn: (rows: ResolvedPlan<P>[]) => ResolvedPlan<P>[],
    locale: SaLocale,
): CatalogSnapshot<P> | null {
    const msg = planVersionsMessages[locale].catalog;
    const planByKey = groupBy(data.planVersions, (r) => r.planId);

    const plans: ResolvedPlan<P>[] = [];
    for (const [, rows] of planByKey) {
        const live = findCurrentLive(rows);
        if (live) plans.push(resolvePlan(live, null));
    }
    if (plans.length === 0) return null;

    const publishedDates = plans
        .map((p) => p.source.publishedAt)
        .filter((t): t is string => t !== null)
        .sort();
    const latestPublished = publishedDates[publishedDates.length - 1];

    return {
        id: 'active',
        kind: 'active',
        status: 'ACTIVE',
        label: msg.activeLabel,
        title: msg.activeTitle,
        description: msg.activeDescription,
        asOf: latestPublished ?? null,
        createdAt: null,
        publishedAt: latestPublished ?? null,
        authorEmail: null,
        plans: sortPlansFn(plans),
        draftCount: 0,
        regressionCount: 0,
    };
}

function buildHistoricalSnapshots<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
    sortPlansFn: (rows: ResolvedPlan<P>[]) => ResolvedPlan<P>[],
    locale: SaLocale,
): CatalogSnapshot<P>[] {
    const msg = planVersionsMessages[locale].catalog;
    const allPublishedAt = new Set<string>();
    for (const r of data.planVersions) if (r.publishedAt) allPublishedAt.add(r.publishedAt);
    if (allPublishedAt.size === 0) return [];

    const planByKey = groupBy(data.planVersions, (r) => r.planId);

    // The active snapshot overlaps with the last publish event. We take the
    // latest one in `active`, and map only the events *before* it here.
    const liveTimestamps = new Set<string>();
    for (const rows of planByKey.values()) {
        const live = findCurrentLive(rows);
        if (live?.publishedAt) liveTimestamps.add(live.publishedAt);
    }
    const liveSorted = [...liveTimestamps].sort();
    const latestLive = liveSorted[liveSorted.length - 1];

    const sortedDesc = [...allPublishedAt].sort((a, b) => Date.parse(b) - Date.parse(a));

    const out: CatalogSnapshot<P>[] = [];
    for (const ts of sortedDesc) {
        if (latestLive && Date.parse(ts) >= Date.parse(latestLive)) continue;
        const tMs = Date.parse(ts) + 1; // *after* the event
        const plans: ResolvedPlan<P>[] = [];
        for (const [, rows] of planByKey) {
            const live = findLiveAt(rows, tMs);
            if (live) plans.push(resolvePlan(live, null));
        }
        if (plans.length === 0) continue;

        const publishedAtThisEvent: P[] = data.planVersions.filter((r) => r.publishedAt === ts);
        const regressionCount = publishedAtThisEvent.filter((r) => !r.nonRegressive).length;
        const author = publishedAtThisEvent[0]?.publishedByUserId ?? null;

        out.push({
            id: `hist-${ts}`,
            kind: 'historical',
            status: 'ARCHIVED',
            label: dateLabel(ts, locale),
            title: summarizeEvent(publishedAtThisEvent, msg),
            description: detailEvent(publishedAtThisEvent, msg),
            asOf: ts,
            createdAt: ts,
            publishedAt: ts,
            authorEmail: author,
            plans: sortPlansFn(plans),
            draftCount: 0,
            regressionCount,
        });
    }
    return out;
}

function summarizeEvent(rows: PlanVersionRow[], msg: CatalogMessages): string {
    if (rows.length === 0) return msg.publishEvent;
    if (rows.length === 1) {
        const r = rows[0]!;
        return formatMessage(msg.publishEventSingle, { planId: r.planId, version: r.version });
    }
    return formatMessage(msg.publishEventMultiple, { count: rows.length });
}

function detailEvent(rows: PlanVersionRow[], msg: CatalogMessages): string {
    if (rows.length === 0) return '';
    const note = rows[0]?.changeNote ?? '';
    return note.length > 0 ? note : msg.reconstructedSnapshot;
}

// ─── Sorting ─────────────────────────────────────────────────────────────

function sortPlansBy<P extends PlanVersionRow>(
    order: readonly string[] | undefined,
): (rows: ResolvedPlan<P>[]) => ResolvedPlan<P>[] {
    if (!order || order.length === 0) {
        return (rows) => [...rows].sort((a, b) => a.planId.localeCompare(b.planId));
    }
    const idx: Record<string, number> = {};
    for (let i = 0; i < order.length; i++) idx[order[i]!] = i;
    return (rows) =>
        [...rows].sort((a, b) => {
            const ai = idx[a.planId] ?? Number.POSITIVE_INFINITY;
            const bi = idx[b.planId] ?? Number.POSITIVE_INFINITY;
            if (ai !== bi) return ai - bi;
            return a.planId.localeCompare(b.planId);
        });
}

// ─── Public API ──────────────────────────────────────────────────────────

export function buildSnapshots<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
    options: BuildSnapshotsOptions = {},
): CatalogSnapshot<P>[] {
    const locale = options.locale ?? DEFAULT_SA_LOCALE;
    const sortPlansFn = sortPlansBy<P>(options.planSortOrder);
    const drafts = buildDraftsSnapshot(data, sortPlansFn, locale);
    const active = buildActiveSnapshot(data, sortPlansFn, locale);
    const historical = buildHistoricalSnapshots(data, sortPlansFn, locale);

    const out: CatalogSnapshot<P>[] = [drafts];
    if (active) out.push(active);
    out.push(...historical);
    return out;
}

export function listOpenDrafts<P extends PlanVersionRow>(data: RawCatalogData<P>): { plans: P[] } {
    return {
        plans: sortByPublishedDesc(data.planVersions).filter((r) => r.publishedAt === null),
    };
}
