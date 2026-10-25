// What the gateway reported and nothing matched: the cases to reconcile, open
// or closed, and closing one with a note. Served where the manifest carries
// `RECONCILIATION_READ_CAPABILITY`; elsewhere every route answers 404.
//
// Closing carries the second factor: it declares a mismatch of money
// reconciled for good (`SC-ADM-039`).

import type {
    AdminReconciliationCase,
    AdminReconciliationCases,
    ReconciliationCaseState,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJsonBody } from './resource-request.js';

function casesUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/reconciliation`;
}

export const reconciliationResource = defineResource('reconciliation', {
    /** One page of the cases in `state`, the oldest first, after the case `after` names. */
    cases: (
        http,
        ctx,
        state: ReconciliationCaseState,
        after?: string,
    ): Promise<AdminReconciliationCases> => {
        const query = new URLSearchParams({ state });
        if (after) query.set('after', after);
        return requestJsonBody<AdminReconciliationCases>(
            http,
            `${casesUrl(ctx)}?${query.toString()}`,
            'GET /reconciliation answered with no body',
        );
    },

    /**
     * Closes the case `caseId` with the operator's note. 409
     * `SUBSCRIBER_RECONCILIATION_CASE_CLOSED` where it was closed meanwhile.
     */
    close: (
        http,
        ctx,
        caseId: string,
        note: string,
        mfaCode?: string,
    ): Promise<AdminReconciliationCase> =>
        requestJsonBody<AdminReconciliationCase>(
            http,
            `${casesUrl(ctx)}/${encodeURIComponent(caseId)}/close`,
            'POST /reconciliation/{caseId}/close answered with no body',
            { method: 'POST', body: { note }, headers: mfaHeader(mfaCode) },
        ),
});
