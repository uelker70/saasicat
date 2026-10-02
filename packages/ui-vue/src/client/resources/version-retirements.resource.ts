// Retiring a plan version for the subscriptions on it: the announcements made,
// the preview an operator reads, and the announcement. Served where the manifest carries
// `VERSION_RETIREMENT_CAPABILITY`; elsewhere both answer 404.

import type { RetirementAnnounced, RetirementPreview, VersionRetirementView } from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

function retirementUrl(ctx: ResourceContext, versionId: string): string {
    return `${ctx.apiBase}/catalog/plan-versions/${encodeURIComponent(versionId)}/retirement`;
}

/** What an announcement names: the version they continue on, and whom the operator was shown. */
export interface RetirementAnnouncement {
    replacementPlanVersionId: string;
    subscriptionIds: readonly string[];
}

export const versionRetirementsResource = defineResource('versionRetirements', {
    /** Every retirement announced, the most recent first. */
    list: async (http, ctx): Promise<VersionRetirementView[]> =>
        (await requestJson<VersionRetirementView[]>(
            http,
            `${ctx.apiBase}/catalog/version-retirements`,
        )) ?? [],

    /**
     * What retiring the version for `replacementId` would do now: whom it
     * reaches and when, whom it does not and why, and what refuses it.
     */
    preview: (http, ctx, versionId: string, replacementId: string): Promise<RetirementPreview> =>
        requestJsonBody<RetirementPreview>(
            http,
            `${retirementUrl(ctx, versionId)}?replacement=${encodeURIComponent(replacementId)}`,
            'Retirement preview returned no body',
        ),

    /**
     * Announces the retirement. 409 `RETIREMENT_PREVIEW_CHANGED`, carrying the
     * preview as it stands, where the subscriptions named are no longer the
     * ones it reaches. The route requires the second factor.
     */
    announce: (
        http,
        ctx,
        versionId: string,
        announcement: RetirementAnnouncement,
        mfaCode?: string,
    ): Promise<RetirementAnnounced> =>
        requestJsonBody<RetirementAnnounced>(
            http,
            retirementUrl(ctx, versionId),
            'Retirement announcement returned no body',
            { method: 'POST', body: announcement, headers: mfaHeader(mfaCode) },
        ),
});
