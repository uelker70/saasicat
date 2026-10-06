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
// encoded on the way into the path there, so they are encoded here. `charges`,
// `subscriber` and `subscriberAttention` have no twin there: the pages read
// them through this descriptor alone.

import {
    SUBSCRIBER_ATTENTION_PAGE_SIZE,
    type AdminSubscriberAccount,
    type AdminSubscriberAttention,
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
