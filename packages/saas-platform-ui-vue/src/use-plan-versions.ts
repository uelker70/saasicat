// usePlanVersionsCatalog — Composable für die Plan-Versions-Page
// (`<app> /admin/plans`).
//
// **Endpoint ist Pflicht** und wird vom App-Konsumenten geliefert, weil
// Apps unterschiedliche `globalPrefix`-Konventionen haben (AutohausPro:
// `/api/admin/...`, vereinsfux: `/api/v1/admin/...`).
//
// Plattform-Pure-Functions (`assertDraftPublishable` etc. aus
// `@saasicat/nest/billing`) validieren die Drafts vor dem
// Publish-POST.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.6 (4.11).
//        autohauspro/handoff/saas/ROADMAP_PLANS_AND_ENTITLEMENT.md §4.

import { ref, type Ref } from 'vue';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

/**
 * Generic Filter-Form für Versions-Listen.
 * `state`: 'draft' (publishedAt null), 'live' (publishedAt set, supersededAt null),
 *          'superseded' (supersededAt set), 'all' (default).
 */
export interface PlanVersionListFilter {
    state?: 'draft' | 'live' | 'superseded' | 'all';
    /** PlanId (`'BASIC'`, `'STANDARD'`, …). */
    planId?: string;
}

/**
 * Generische Versions-Row-Form. Konsumenten-Backend liefert je nach Endpoint
 * leicht unterschiedliche Felder; Plattform-Composable nimmt die universellen.
 */
export interface PlanVersionRow {
    id: string;
    version: number;
    publishedAt: string | null;
    supersededAt: string | null;
    nonRegressive: boolean;
    changeNote?: string;
    [extra: string]: unknown;
}

export interface VersionsOptions {
    /**
     * Voll-qualifizierter Versions-Listen-Endpoint inkl. App-globalPrefix
     * (`/api/admin/plan-versions`, `/api/v1/admin/plan-versions`, …). Pflicht.
     */
    endpoint: string;
    filter?: Ref<PlanVersionListFilter>;
    http?: UseApiListOptions<Record<string, unknown>>['http'];
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface VersionsResult extends UseApiListResult<PlanVersionRow> {
    filter: Ref<PlanVersionListFilter>;
}

function buildVersionsComposable(label: string) {
    return function (options: VersionsOptions): VersionsResult {
        if (!options?.endpoint) {
            throw new Error(
                `${label}: \`endpoint\` ist Pflicht (z. B. "/api/admin/${label}" ` +
                    `oder "/api/v1/admin/${label}"). Plattform hat keinen Default, ` +
                    `weil Apps unterschiedliche globalPrefix-Konventionen haben.`,
            );
        }
        const filter = options.filter ?? ref<PlanVersionListFilter>({});
        const list = useApiList<PlanVersionRow>({
            endpoint: options.endpoint,
            filter: filter as unknown as Ref<Record<string, unknown>>,
            http: options.http,
            getAuthToken: options.getAuthToken,
            autoLoad: options.autoLoad,
        });
        return { ...list, filter };
    };
}

/**
 * Read-only Catalog-View für PlanVersions (Lift-and-Shift AutohausPro).
 * Heißt seit M6 Pack 2a `usePlanVersionsCatalog`, weil `usePlanVersions`
 * aus `use-plans.ts` jetzt der Lifecycle-Editor (createDraft/publish) ist.
 */
export const usePlanVersionsCatalog = buildVersionsComposable('plan-versions');
