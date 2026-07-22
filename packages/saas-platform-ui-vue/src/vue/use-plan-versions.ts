// usePlanVersionsCatalog — composable for the plan-versions page
// (`<app> /admin/plans`).
//
// **Endpoint is mandatory** and is supplied by the app consumer, because
// apps have different `globalPrefix` conventions
// (e.g. `/api/admin/...` or `/api/v1/admin/...`).
//
// Platform pure functions (`assertDraftPublishable` etc. from
// `@saasicat/nest/billing`) validate the drafts before the
// publish POST.

import { ref, type Ref } from 'vue';
import { useApiList, type UseApiListOptions, type UseApiListResult } from './use-api-list.js';

/**
 * Generic filter shape for versions lists.
 * `state`: 'draft' (publishedAt null), 'live' (publishedAt set, supersededAt null),
 *          'superseded' (supersededAt set), 'all' (default).
 */
export interface PlanVersionListFilter {
    state?: 'draft' | 'live' | 'superseded' | 'all';
    /** PlanId (`'BASIC'`, `'STANDARD'`, …). */
    planId?: string;
}

/**
 * Generic versions row shape. Depending on the endpoint, the consumer backend
 * returns slightly different fields; the platform composable takes the universal ones.
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
     * Fully qualified versions-list endpoint including the app globalPrefix
     * (`/api/admin/plan-versions`, `/api/v1/admin/plan-versions`, …). Mandatory.
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
                `${label}: \`endpoint\` is required (e.g. "/api/admin/${label}" ` +
                    `or "/api/v1/admin/${label}"). The platform has no default ` +
                    `because apps use different globalPrefix conventions.`,
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
 * Read-only catalog view for PlanVersions (lift-and-shift from a
 * consumer admin).
 * Called `usePlanVersionsCatalog` since M6 Pack 2a, because `usePlanVersions`
 * from `use-plans.ts` is now the lifecycle editor (createDraft/publish).
 */
export const usePlanVersionsCatalog = buildVersionsComposable('plan-versions');
