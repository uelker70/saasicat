// The plan catalogue endpoints.
//
// Two path stems, and the asymmetry is the server's, not a mistake here:
// reading and creating versions goes through the plan
// (`catalog/plans/:planId/versions`), while every mutation of an existing
// version addresses the version directly (`catalog/plan-versions/:id`).
//
// Path parameters are interpolated without encoding, which is what the
// composables do today. Encoding them would be the safer default — but ids
// containing `/`, `#` or `?` would then reach a different URL than they reach
// now, and that is a behaviour change, not a fix. It belongs in a change that
// says so.

import type {
    CreatePlanData,
    CreatePlanVersionDraftData,
    PlanRow,
    PlanVersionMutationResult,
    PlanVersionRow,
    UpdatePlanData,
    UpdatePlanVersionDraftData,
} from '@saasicat/types';

import { defineResource, type ResourceContext } from './define-resource.js';

import { requestJson, requestJsonBody } from './resource-request.js';

/** What `publish` may override at the moment a version goes live. */
export interface PublishPlanVersionOptions {
    forceRegressive?: boolean;
    allowZeroPrice?: boolean;
    validFrom?: string | null;
    validUntil?: string | null;
}

function plansUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/plans`;
}

function versionsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/plan-versions`;
}

/** `?projectKey=…` — the key is a literal, only the value is encoded. */
function scoped(url: string, ctx: ResourceContext): string {
    return `${url}?projectKey=${encodeURIComponent(ctx.projectKey)}`;
}

export const plansResource = defineResource('plans', {
    list: async (http, ctx): Promise<PlanRow[]> =>
        (await requestJson<PlanRow[]>(http, scoped(plansUrl(ctx), ctx))) ?? [],

    tenantCounts: async (http, ctx): Promise<Record<string, number>> =>
        (await requestJson<Record<string, number>>(
            http,
            scoped(`${plansUrl(ctx)}/tenant-counts`, ctx),
        )) ?? {},

    create: (http, ctx, data: CreatePlanData): Promise<PlanRow> =>
        requestJsonBody<PlanRow>(http, plansUrl(ctx), 'Create returned no body', {
            method: 'POST',
            body: data,
        }),

    update: (http, ctx, planId: string, data: UpdatePlanData): Promise<PlanRow> =>
        requestJsonBody<PlanRow>(http, `${plansUrl(ctx)}/${planId}`, 'Update returned no body', {
            method: 'PATCH',
            body: data,
        }),

    /** Marks the plan deleted. Fails while it still has versions. */
    softDelete: async (http, ctx, planId: string): Promise<void> => {
        await requestJson(http, `${plansUrl(ctx)}/${planId}`, { method: 'DELETE' });
    },

    /** Removes the plan for good. 422 `PLAN_HAS_VERSIONS` when it cannot. */
    hardDelete: async (http, ctx, planId: string): Promise<void> => {
        await requestJson(http, `${plansUrl(ctx)}/${planId}/purge`, { method: 'DELETE' });
    },
});

export const planVersionsResource = defineResource('planVersions', {
    listForPlan: async (http, ctx, planId: string): Promise<PlanVersionRow[]> =>
        (await requestJson<PlanVersionRow[]>(http, `${plansUrl(ctx)}/${planId}/versions`)) ?? [],

    createDraft: (
        http,
        ctx,
        planId: string,
        data: Omit<CreatePlanVersionDraftData, 'planId'>,
    ): Promise<PlanVersionMutationResult> =>
        requestJsonBody<PlanVersionMutationResult>(
            http,
            `${plansUrl(ctx)}/${planId}/versions`,
            'CreateDraft returned no body',
            { method: 'POST', body: data },
        ),

    updateDraft: (
        http,
        ctx,
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionMutationResult> =>
        requestJsonBody<PlanVersionMutationResult>(
            http,
            `${versionsUrl(ctx)}/${versionId}`,
            'UpdateDraft returned no body',
            { method: 'PATCH', body: data },
        ),

    publish: (
        http,
        ctx,
        versionId: string,
        options: PublishPlanVersionOptions = {},
    ): Promise<PlanVersionMutationResult> =>
        requestJsonBody<PlanVersionMutationResult>(
            http,
            `${versionsUrl(ctx)}/${versionId}/publish`,
            'Publish returned no body',
            { method: 'POST', body: options },
        ),

    discardDraft: async (http, ctx, versionId: string): Promise<void> => {
        await requestJson(http, `${versionsUrl(ctx)}/${versionId}`, { method: 'DELETE' });
    },

    /**
     * Ends a live version on `endsAt`, with no successor. Idempotent — a
     * second call with another date overwrites the first.
     *
     * `endsAt` is the date itself, not a payload: the endpoint's body is
     * `{ endsAt }` and wrapping it is this operation's job, not the caller's.
     */
    terminate: (http, ctx, versionId: string, endsAt: string): Promise<PlanVersionRow> =>
        requestJsonBody<PlanVersionRow>(
            http,
            `${versionsUrl(ctx)}/${versionId}/terminate`,
            'Terminate returned no body',
            { method: 'POST', body: { endsAt } },
        ),
});
