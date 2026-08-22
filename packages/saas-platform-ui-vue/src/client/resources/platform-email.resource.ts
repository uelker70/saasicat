// The SMTP providers the platform sends through, and the log of what it sent.
//
// Two descriptors for one path prefix, because they are two subjects with two
// lifetimes: a provider is configuration an operator edits, a sent mail is a
// record that only ever gets read, resent or removed.
//
// As with `pilots`, the platform ships the pages and the consuming app serves
// the routes. The paths are the ones the consumers already call —
// `/platform-email/providers` and `/platform-email/history`.

import type {
    EmailHistoryDetail,
    EmailHistoryResendResult,
    EmailHistoryFilter as HistoryFilter,
    EmailHistoryListResult as EmailHistoryPage,
} from './email-history.types.js';
import type {
    PlatformEmailProvider,
    PlatformEmailTestInput,
    PlatformEmailTestResult,
    PlatformEmailWriteInput,
} from './platform-email.types.js';

import { defineResource } from './define-resource.js';
import { filterQueryString } from './list-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

// The row, detail and result shapes are the ones the pages already declare —
// re-exported, not restated. A descriptor that invents a second spelling is how
// `auditResource` came to send parameters its endpoint ignores.
export type {
    PlatformEmailProvider,
    PlatformEmailWriteInput,
    PlatformEmailTestInput,
    PlatformEmailTestResult,
} from './platform-email.types.js';
export type {
    EmailHistoryRow,
    EmailHistoryDetail,
    EmailHistoryFilter,
    EmailHistoryListResult,
    EmailHistoryResendResult,
} from './email-history.types.js';

function providersUrl(base: string): string {
    return `${base}/platform-email/providers`;
}

function historyUrl(base: string): string {
    return `${base}/platform-email/history`;
}

export const platformEmailResource = defineResource('platformEmail', {
    list: async (http, ctx): Promise<PlatformEmailProvider[]> =>
        (await requestJson<PlatformEmailProvider[]>(http, providersUrl(ctx.apiBase))) ?? [],

    create: (
        http,
        ctx,
        payload: PlatformEmailWriteInput,
        mfaCode?: string,
    ): Promise<PlatformEmailProvider> =>
        requestJsonBody<PlatformEmailProvider>(
            http,
            providersUrl(ctx.apiBase),
            'Create returned no body',
            { method: 'POST', body: payload, headers: mfaHeader(mfaCode) },
        ),

    update: (
        http,
        ctx,
        id: string,
        payload: PlatformEmailWriteInput,
        mfaCode?: string,
    ): Promise<PlatformEmailProvider> =>
        requestJsonBody<PlatformEmailProvider>(
            http,
            `${providersUrl(ctx.apiBase)}/${encodeURIComponent(id)}`,
            'Update returned no body',
            { method: 'PATCH', body: payload, headers: mfaHeader(mfaCode) },
        ),

    remove: async (http, ctx, id: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${providersUrl(ctx.apiBase)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: mfaHeader(mfaCode),
        });
    },

    /** Sends one mail through the provider and reports what happened. */
    test: (
        http,
        ctx,
        id: string,
        payload: PlatformEmailTestInput,
    ): Promise<PlatformEmailTestResult> =>
        requestJsonBody<PlatformEmailTestResult>(
            http,
            `${providersUrl(ctx.apiBase)}/${encodeURIComponent(id)}/test`,
            'Test returned no body',
            { method: 'POST', body: payload },
        ),
});

export const emailHistoryResource = defineResource('emailHistory', {
    list: async (http, ctx, filter: HistoryFilter = {}): Promise<EmailHistoryPage> =>
        (await requestJson<EmailHistoryPage>(
            http,
            `${historyUrl(ctx.apiBase)}${filterQueryString({
                search: filter.search,
                status: filter.status,
                from: filter.from,
                to: filter.to,
                page: filter.page,
                limit: filter.limit,
            })}`,
        )) ?? { rows: [], total: 0 },

    /** The full record, including the body — too large for the list. */
    detail: async (http, ctx, id: string): Promise<EmailHistoryDetail | null> =>
        requestJson<EmailHistoryDetail>(
            http,
            `${historyUrl(ctx.apiBase)}/${encodeURIComponent(id)}`,
        ),

    remove: async (http, ctx, id: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${historyUrl(ctx.apiBase)}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: mfaHeader(mfaCode),
        });
    },

    /**
     * Sends the mail again and reports what happened.
     *
     * The result is the point: a resend that the SMTP server refuses is a
     * 200 with `success: false`, and a page that treated this as `void` would
     * have told the operator it worked.
     */
    resend: async (
        http,
        ctx,
        id: string,
        mfaCode?: string,
    ): Promise<EmailHistoryResendResult | null> =>
        requestJson<EmailHistoryResendResult>(
            http,
            `${historyUrl(ctx.apiBase)}/${encodeURIComponent(id)}/resend`,
            { method: 'POST', headers: mfaHeader(mfaCode) },
        ),
});

/**
 * The second-factor header, or nothing.
 *
 * An empty string is not a code: the flows pass `''` when MFA is off, and
 * sending `X-Mfa-Code:` empty made a backend that checks for the header's
 * presence reject a request that was never guarded.
 */
function mfaHeader(mfaCode?: string): Record<string, string> | undefined {
    return mfaCode ? { 'X-Mfa-Code': mfaCode } : undefined;
}
