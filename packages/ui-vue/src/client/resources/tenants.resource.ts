// The tenant list, one tenant, and the two states an operator can put it in.
//
// The request pages; the controller does not. `AdminResourcesPort.listTenants`
// takes `status`/`plan`/`search` and answers with a bare array — no `page`, no
// `total` — while the paginated `TenantPort.list` no controller exposes returns
// `Paginated<TenantDto>`. So `page` and `pageSize` go out on every request and
// today nothing on the far side reads them. That is exactly what `useApiList`
// has been sending, and reproducing it is the point: what the server does with
// the parameters is the server's to change, and a descriptor that quietly sent
// less would be a different request wearing the same name.
//
// `detail`, `suspend` and `reactivate` mirror `createAdminResourceClient`,
// which is what `TenantDetailPage` receives them through today. Slugs are
// encoded on the way into the path there, so they are encoded here. `charges`
// and the subscriber's operations have no twin there: the pages reach them
// through this descriptor alone.

import {
    SUBSCRIBER_ATTENTION_PAGE_SIZE,
    type AdminSubscriberAccount,
    type AdminSubscriberAttention,
    type AdminSubscriberCorrected,
    type AdminSubscriberHistoryEntry,
    type AdminTenantDetail,
    type AdminTenantSubscriber,
    type TenantDto,
    type TenantListFilter,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { defineListOp, type ListFilterOf } from './list-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

/** What the tenants list can be narrowed by. The page number is not a filter. */
export type TenantsListFilter = ListFilterOf<TenantListFilter>;

/**
 * A correction of a subscriber's legal identity, as the operator states it:
 * the fields that change — `null` clears a tax identifier — and why. It is
 * always a correction of the same legal entity; a takeover is not an edit.
 */
export interface SubscriberIdentityCorrectionInput {
    legalName?: string;
    vatId?: string | null;
    taxNumber?: string | null;
    reason: string;
}

/** Whether the subscriber acts as a business — `null` for not stated — and why. */
export interface SubscriberBusinessStatusInput {
    business: boolean | null;
    reason: string;
}

function tenantsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/tenants`;
}

function tenantUrl(ctx: ResourceContext, slug: string): string {
    return `${tenantsUrl(ctx)}/${encodeURIComponent(slug)}`;
}

/** The tenant ids in pages the server takes, each named once. */
function attentionPages(tenantIds: readonly string[]): string[][] {
    const unique = [...new Set(tenantIds)];
    const pages: string[][] = [];
    for (let start = 0; start < unique.length; start += SUBSCRIBER_ATTENTION_PAGE_SIZE) {
        pages.push(unique.slice(start, start + SUBSCRIBER_ATTENTION_PAGE_SIZE));
    }
    return pages;
}

export const tenantsResource = defineResource('tenants', {
    list: defineListOp<TenantDto, TenantsListFilter>((ctx) => tenantsUrl(ctx)),

    detail: async (http, ctx, slug: string): Promise<AdminTenantDetail | null> =>
        requestJson<AdminTenantDetail>(http, tenantUrl(ctx, slug)),

    /**
     * Suspends a tenant. The reason is recorded on the audit trail, so it is a
     * required argument rather than an option with a default. Suspending and
     * reactivating both require the second factor.
     */
    suspend: async (http, ctx, slug: string, reason: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${tenantUrl(ctx, slug)}/suspend`, {
            method: 'POST',
            body: { reason },
            headers: mfaHeader(mfaCode),
        });
    },

    reactivate: async (http, ctx, slug: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${tenantUrl(ctx, slug)}/reactivate`, {
            method: 'POST',
            headers: mfaHeader(mfaCode),
        });
    },

    /**
     * The charges of the tenant's subscriber, newest first. Served only where
     * the manifest announces `charges.read`.
     */
    charges: async (http, ctx, slug: string): Promise<AdminSubscriberAccount> =>
        requestJsonBody<AdminSubscriberAccount>(
            http,
            `${tenantUrl(ctx, slug)}/charges`,
            'The account returned no body',
        ),

    /**
     * The tenant's subscriber, its tax details and what holds its next
     * contract back. Served only where the manifest announces
     * `subscribers.read`.
     */
    subscriber: async (http, ctx, slug: string): Promise<AdminTenantSubscriber> =>
        requestJsonBody<AdminTenantSubscriber>(
            http,
            `${tenantUrl(ctx, slug)}/subscriber`,
            'The subscriber returned no body',
        ),

    /** The subscriber's corrections, changes of country or business status, and checks, the latest first. */
    subscriberHistory: async (http, ctx, slug: string): Promise<AdminSubscriberHistoryEntry[]> => {
        const answer = await requestJsonBody<{ entries: AdminSubscriberHistoryEntry[] }>(
            http,
            `${tenantUrl(ctx, slug)}/subscriber/history`,
            'The history returned no body',
        );
        return answer.entries;
    },

    /**
     * Corrects the subscriber's legal identity — the same legal entity, with a
     * reason. Requires the second factor. A VAT number it gives is checked
     * right after, where a tax adapter decides, and the answer says how.
     */
    correctSubscriberIdentity: async (
        http,
        ctx,
        slug: string,
        correction: SubscriberIdentityCorrectionInput,
        mfaCode?: string,
    ): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${tenantUrl(ctx, slug)}/subscriber/identity`,
            'The correction returned no body',
            {
                method: 'POST',
                body: { kind: 'correction', ...correction },
                headers: mfaHeader(mfaCode),
            },
        ),

    /** Records whether the subscriber acts as a business, and why. Requires the second factor. */
    changeSubscriberBusinessStatus: async (
        http,
        ctx,
        slug: string,
        change: SubscriberBusinessStatusInput,
        mfaCode?: string,
    ): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${tenantUrl(ctx, slug)}/subscriber/business-status`,
            'The change returned no body',
            { method: 'POST', body: change, headers: mfaHeader(mfaCode) },
        ),

    /** Checks the VAT number the subscriber holds again, without changing it. */
    checkSubscriberVatId: async (http, ctx, slug: string): Promise<AdminSubscriberCorrected> =>
        requestJsonBody<AdminSubscriberCorrected>(
            http,
            `${tenantUrl(ctx, slug)}/subscriber/vat-id-check`,
            'The check returned no body',
            { method: 'POST' },
        ),

    /**
     * Which of these tenants hold their subscriber back from its next
     * contract, and why. Asked in pages the server takes; served only where
     * the manifest announces `subscribers.attention`.
     */
    subscriberAttention: async (
        http,
        ctx,
        tenantIds: readonly string[],
    ): Promise<AdminSubscriberAttention[]> => {
        const answers = await Promise.all(
            attentionPages(tenantIds).map(async (page) => {
                const query = new URLSearchParams(page.map((id) => ['tenantId', id]));
                const answer = await requestJsonBody<{ attention: AdminSubscriberAttention[] }>(
                    http,
                    `${ctx.apiBase}/subscribers/attention?${query.toString()}`,
                    'The attention returned no body',
                );
                return answer.attention;
            }),
        );
        return answers.flat();
    },
});
