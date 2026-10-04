// Retiring an add-on version for the bookings on it: the announcements made,
// the preview an operator reads, and the announcement. Served where the manifest carries
// `BUNDLE_VERSION_RETIREMENT_CAPABILITY`; elsewhere the routes answer 404.

import type {
    BundleRetirementAnnounced,
    BundleRetirementPreview,
    BundleVersionRetirementView,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

function retirementUrl(ctx: ResourceContext, versionId: string): string {
    return `${ctx.apiBase}/catalog/bundle-versions/${encodeURIComponent(versionId)}/retirement`;
}

/** What an announcement names: the version of the same add-on, and the bookings the operator was shown. */
export interface BundleRetirementAnnouncement {
    replacementBundleVersionId: string;
    subscriptionBundleIds: readonly string[];
}

export const bundleVersionRetirementsResource = defineResource('bundleVersionRetirements', {
    /** Every add-on retirement announced, the most recent first, with how far each has come. */
    list: async (http, ctx): Promise<BundleVersionRetirementView[]> =>
        (await requestJson<BundleVersionRetirementView[]>(
            http,
            `${ctx.apiBase}/catalog/bundle-version-retirements`,
        )) ?? [],

    /**
     * What retiring the add-on version for `replacementId` would do now: which
     * bookings it reaches and when, which it does not and why, and what
     * refuses it.
     */
    preview: (
        http,
        ctx,
        versionId: string,
        replacementId: string,
    ): Promise<BundleRetirementPreview> =>
        requestJsonBody<BundleRetirementPreview>(
            http,
            `${retirementUrl(ctx, versionId)}?replacement=${encodeURIComponent(replacementId)}`,
            'Add-on retirement preview returned no body',
        ),

    /**
     * Announces the retirement. 409 `RETIREMENT_PREVIEW_CHANGED`, carrying the
     * preview as it stands, where the bookings named are no longer the ones it
     * reaches. The route requires the second factor.
     */
    announce: (
        http,
        ctx,
        versionId: string,
        announcement: BundleRetirementAnnouncement,
        mfaCode?: string,
    ): Promise<BundleRetirementAnnounced> =>
        requestJsonBody<BundleRetirementAnnounced>(
            http,
            retirementUrl(ctx, versionId),
            'Add-on retirement announcement returned no body',
            { method: 'POST', body: announcement, headers: mfaHeader(mfaCode) },
        ),
});
