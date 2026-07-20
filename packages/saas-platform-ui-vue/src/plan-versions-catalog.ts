// Catalog-Snapshot-Builder — projiziert PlanVersion-Rows auf synthetische
// Catalog-Snapshots, die die Plan-Versions-UI rendert.
//
// Das Backend kennt keine Catalog-Snapshots; wir leiten sie aus den realen
// `publishedAt` / `supersededAt`-Events ab. Drei Snapshot-Sorten:
//
//   - `drafts`     : Hypothetischer "nach Publish aller offenen Drafts"-Stand
//   - `active`     : Aktuell live (publishedAt set, supersededAt null)
//   - `historical` : Pro Publish-Event ein Snapshot, vor `active`
//
// Plan-IDs werden alphabetisch sortiert; Konsumenten dürfen via
// `planSortOrder` eine bevorzugte Reihenfolge erzwingen (z. B.
// BASIC < STANDARD < PROFESSIONAL < BUSINESS < ENTERPRISE).
//
// Phase 2b: Aus einem Konsumenten-Admin portiert,
// app-spezifische Felder via Generics offen gehalten.

import type { PlanVersionRow } from '@saasicat/types';

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

    /** Anzahl offener Drafts für `drafts`-Snapshot, sonst 0. */
    draftCount: number;
    /** Anzahl Entitäten in diesem Snapshot, deren Veröffentlichung mindestens
     *  eine Regression markierte (`nonRegressive === false`). */
    regressionCount: number;
}

export interface ResolvedPlan<P extends PlanVersionRow = PlanVersionRow> {
    /** Welcher PlanVersionRow ausgewählt wurde, um diesen Slot zu repräsentieren. */
    source: P;
    /** Live-Vorgänger (nur gesetzt, wenn `source` ein DRAFT ist; sonst null). */
    liveBase: P | null;
    isDraft: boolean;
    planId: string;
    features: string[];
    /** Quota-Map (aus `source.quotas` oder Legacy-Felder; leer wenn keins). */
    quotas: Record<string, number>;
    monthlyNet: number;
    yearlyNet: number;
    marketed: boolean;
    version: number;

    // Legacy-Quota-Mirrors für UI-Komponenten, die noch nicht auf `quotas[key]`
    // umgestellt sind. Werden aus `quotas['users'] / 'vehicles' / 'storageGb'`
    // gespiegelt; für Apps ohne diese Quotas bleiben sie undefined.
    /** @deprecated Aus `quotas['users']` lesen. */
    maxUsers?: number;
    /** @deprecated Legacy-Feld; aus `quotas['vehicles']` lesen. */
    maxVehicles?: number;
    /** @deprecated Aus `quotas['storageGb']` lesen. */
    maxStorageGb?: number;
}

export interface RawCatalogData<P extends PlanVersionRow = PlanVersionRow> {
    planVersions: P[];
}

export interface BuildSnapshotsOptions {
    /**
     * App-spezifische Plan-Reihenfolge, z. B. `['BASIC', 'STANDARD',
     * 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']`. Plan-IDs außerhalb der Liste
     * landen alphabetisch sortiert hinten.
     */
    planSortOrder?: readonly string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const dec = (s: string): number => Number(s);

function extractQuotas(p: PlanVersionRow): Record<string, number> {
    if (p.quotas && Object.keys(p.quotas).length > 0) {
        return { ...p.quotas };
    }
    // Legacy-Fallback: flache Felder einsammeln.
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
 * Findet die für einen Entity-Slot zum Zeitpunkt `asOf` gültige Live-Version.
 * Eine Version war live, wenn `publishedAt <= asOf` und (`supersededAt == null`
 * oder `supersededAt > asOf`) galten.
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

// ─── Snapshot-Konstruktoren ──────────────────────────────────────────────

function dateLabelDe(iso: string): string {
    return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function buildDraftsSnapshot<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
    sortPlansFn: (rows: ResolvedPlan<P>[]) => ResolvedPlan<P>[],
): CatalogSnapshot<P> {
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
        label: 'Arbeitsstand',
        title:
            draftCount === 0
                ? 'Keine offenen Drafts'
                : `${draftCount} offene${draftCount === 1 ? 'r' : ''} Draft${draftCount === 1 ? '' : 's'} bereit für Publish`,
        description:
            draftCount === 0
                ? 'Lege einen Draft an, um Limits, Preise oder Features zu ändern. Drafts sind ohne MFA editierbar und werden erst beim Publish wirksam.'
                : 'Diese Tabelle zeigt, wie der Catalog nach Publish aller Drafts aussehen würde. Bestehende Mandanten bleiben auf der vorherigen Version, bis sie aktiv migriert werden.',
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
): CatalogSnapshot<P> | null {
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
        label: 'Aktuell',
        title: 'Live-Catalog',
        description:
            'Diese Plan-Versionen sind aktuell für neue Onboardings und für Renewals nach Stichtag aktiv.',
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
): CatalogSnapshot<P>[] {
    const allPublishedAt = new Set<string>();
    for (const r of data.planVersions) if (r.publishedAt) allPublishedAt.add(r.publishedAt);
    if (allPublishedAt.size === 0) return [];

    const planByKey = groupBy(data.planVersions, (r) => r.planId);

    // Aktuell-Snapshot überlappt sich mit dem letzten Publish-Event. Wir nehmen
    // den letzten in `active`, und bilden hier nur die Events *davor* ab.
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
        const tMs = Date.parse(ts) + 1; // *nach* dem Event
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
            label: dateLabelDe(ts),
            title: summarizeEvent(publishedAtThisEvent),
            description: detailEvent(publishedAtThisEvent),
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

function summarizeEvent(rows: PlanVersionRow[]): string {
    if (rows.length === 0) return 'Publish-Event';
    if (rows.length === 1) {
        const r = rows[0]!;
        return `${r.planId} v${r.version} publiziert`;
    }
    return `${rows.length} Versionen publiziert`;
}

function detailEvent(rows: PlanVersionRow[]): string {
    if (rows.length === 0) return '';
    const note = rows[0]?.changeNote ?? '';
    return note.length > 0 ? note : 'Snapshot rekonstruiert aus per-Entity-Versionen.';
}

// ─── Sortierung ──────────────────────────────────────────────────────────

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
    const sortPlansFn = sortPlansBy<P>(options.planSortOrder);
    const drafts = buildDraftsSnapshot(data, sortPlansFn);
    const active = buildActiveSnapshot(data, sortPlansFn);
    const historical = buildHistoricalSnapshots(data, sortPlansFn);

    const out: CatalogSnapshot<P>[] = [drafts];
    if (active) out.push(active);
    out.push(...historical);
    return out;
}

export function listOpenDrafts<P extends PlanVersionRow>(
    data: RawCatalogData<P>,
): { plans: P[] } {
    return {
        plans: sortByPublishedDesc(data.planVersions).filter((r) => r.publishedAt === null),
    };
}
