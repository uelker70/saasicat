// Withdrawing a feature for a reason outside the platform: the withdrawals
// announced, the preview an operator reads, the announcement and the lift.
// Served where the manifest carries `FEATURE_WITHDRAWAL_CAPABILITY`; elsewhere
// every route answers 404.
//
// Announcing and lifting carry the second factor: each changes what every
// subscription holding the feature is granted and charged.

import type {
    FeatureWithdrawalAnnounced,
    FeatureWithdrawalLifted,
    FeatureWithdrawalPreview,
    FeatureWithdrawalReduction,
    FeatureWithdrawalView,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

/**
 * What an announcement names: the feature, why, from when — now where left
 * out — the reductions, and the subscriptions the operator was shown.
 */
export interface FeatureWithdrawalAnnouncementInput {
    featureKey: string;
    reason: string;
    /** ISO 8601 with its zone. */
    effectiveFrom?: string;
    reductions: readonly FeatureWithdrawalReduction[];
    subscriptionIds: readonly string[];
}

function withdrawalsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/feature-withdrawals`;
}

export const featureWithdrawalsResource = defineResource('featureWithdrawals', {
    /**
     * Every withdrawal, the most recently announced first. A body that is not
     * a list is refused here rather than handed to the page (`SC-UI-020`).
     */
    list: async (http, ctx): Promise<FeatureWithdrawalView[]> => {
        const body = await requestJson<unknown>(http, withdrawalsUrl(ctx));
        if (body === null) return [];
        if (!Array.isArray(body)) {
            throw new Error('GET /feature-withdrawals answered with a body that is not a list');
        }
        return body as FeatureWithdrawalView[];
    },

    /**
     * What withdrawing `featureKey` from `effectiveFrom` — now where null —
     * would do: whom it reaches with which lines, whom it does not, what a
     * reduction may be named for, and what refuses it.
     */
    preview: (
        http,
        ctx,
        featureKey: string,
        effectiveFrom: string | null,
    ): Promise<FeatureWithdrawalPreview> => {
        const query = new URLSearchParams({ featureKey });
        if (effectiveFrom) query.set('effectiveFrom', effectiveFrom);
        return requestJsonBody<FeatureWithdrawalPreview>(
            http,
            `${withdrawalsUrl(ctx)}/preview?${query.toString()}`,
            'GET /feature-withdrawals/preview answered with no body',
        );
    },

    /**
     * Announces the withdrawal. 409 `FEATURE_WITHDRAWAL_PREVIEW_CHANGED`,
     * carrying the preview as it stands, where the subscriptions named are no
     * longer the ones it reaches.
     */
    announce: (
        http,
        ctx,
        input: FeatureWithdrawalAnnouncementInput,
        mfaCode?: string,
    ): Promise<FeatureWithdrawalAnnounced> =>
        requestJsonBody<FeatureWithdrawalAnnounced>(
            http,
            withdrawalsUrl(ctx),
            'POST /feature-withdrawals answered with no body',
            { method: 'POST', body: input, headers: mfaHeader(mfaCode) },
        ),

    /** Lifts the withdrawal `id` from `liftedFrom` — now where null. */
    lift: (
        http,
        ctx,
        id: string,
        liftedFrom: string | null,
        mfaCode?: string,
    ): Promise<FeatureWithdrawalLifted> =>
        requestJsonBody<FeatureWithdrawalLifted>(
            http,
            `${withdrawalsUrl(ctx)}/${encodeURIComponent(id)}/lift`,
            'POST /feature-withdrawals/{id}/lift answered with no body',
            {
                method: 'POST',
                body: liftedFrom ? { liftedFrom } : {},
                headers: mfaHeader(mfaCode),
            },
        ),
});
