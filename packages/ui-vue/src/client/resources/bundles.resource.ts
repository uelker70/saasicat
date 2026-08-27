// The bundle catalogue.
//
// Same two-stem shape as the plan catalogue, and for the same reason: a
// version is read and created through its bundle
// (`catalog/bundles/:bundleId/versions`), while every mutation of an existing
// version addresses the version directly (`catalog/bundle-versions/:id`).
//
// Path parameters are interpolated without encoding, matching `useBundles` and
// `useBundleVersions`. Encoding them would send ids containing `/`, `#` or `?`
// to a different URL than they reach today — a behaviour change, and one that
// belongs in a change that says so. The same note stands on `plans.resource`.

import type {
    BundleRow,
    BundleVersionMutationResult,
    BundleVersionRow,
    CreateBundleData,
    CreateBundleVersionDraftData,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
} from '@saasicat/core';

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

/** What `publish` may override at the moment a bundle version goes live. */
export interface PublishBundleVersionOptions {
    forceRegressive?: boolean;
    allowZeroPrice?: boolean;
    validFrom?: string | null;
    validUntil?: string | null;
}

function bundlesUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/bundles`;
}

function bundleVersionsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/catalog/bundle-versions`;
}

/** The bundle catalogue: the stem list and the stem CRUD. */
export const bundlesResource = defineResource('bundles', {
    list: async (http, ctx): Promise<BundleRow[]> =>
        (await requestJson<BundleRow[]>(http, bundlesUrl(ctx))) ?? [],

    create: (http, ctx, data: CreateBundleData): Promise<BundleRow> =>
        requestJsonBody<BundleRow>(http, bundlesUrl(ctx), 'Create returned no body', {
            method: 'POST',
            body: data,
        }),

    update: (http, ctx, bundleId: string, data: UpdateBundleData): Promise<BundleRow> =>
        requestJsonBody<BundleRow>(
            http,
            `${bundlesUrl(ctx)}/${bundleId}`,
            'Update returned no body',
            { method: 'PATCH', body: data },
        ),

    /** Marks the bundle deleted. */
    softDelete: async (http, ctx, bundleId: string): Promise<void> => {
        await requestJson(http, `${bundlesUrl(ctx)}/${bundleId}`, { method: 'DELETE' });
    },
});

/**
 * Bundle version lifecycle.
 *
 * `publish` is the request only. `useBundleVersions.publish` reloads the list
 * afterwards, because publishing may supersede another version — but that is
 * the composable keeping its own refs consistent, not part of the call. A
 * descriptor operation that issued a second request would make every override
 * inherit a reload it cannot see, and a page holding no list would pay for one
 * it does not read.
 */
export const bundleVersionsResource = defineResource('bundleVersions', {
    listForBundle: async (http, ctx, bundleId: string): Promise<BundleVersionRow[]> =>
        (await requestJson<BundleVersionRow[]>(http, `${bundlesUrl(ctx)}/${bundleId}/versions`)) ??
        [],

    createDraft: (
        http,
        ctx,
        bundleId: string,
        data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
    ): Promise<BundleVersionMutationResult> =>
        requestJsonBody<BundleVersionMutationResult>(
            http,
            `${bundlesUrl(ctx)}/${bundleId}/versions`,
            'CreateDraft returned no body',
            { method: 'POST', body: data },
        ),

    updateDraft: (
        http,
        ctx,
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> =>
        requestJsonBody<BundleVersionMutationResult>(
            http,
            `${bundleVersionsUrl(ctx)}/${versionId}`,
            'UpdateDraft returned no body',
            { method: 'PATCH', body: data },
        ),

    publish: (
        http,
        ctx,
        versionId: string,
        options: PublishBundleVersionOptions = {},
    ): Promise<BundleVersionMutationResult> =>
        requestJsonBody<BundleVersionMutationResult>(
            http,
            `${bundleVersionsUrl(ctx)}/${versionId}/publish`,
            'Publish returned no body',
            { method: 'POST', body: options },
        ),

    /**
     * Discards a draft. A published version cannot be discarded — the API
     * answers 422 `BUNDLE_VERSION_ALREADY_PUBLISHED`.
     */
    discardDraft: async (http, ctx, versionId: string): Promise<void> => {
        await requestJson(http, `${bundleVersionsUrl(ctx)}/${versionId}`, { method: 'DELETE' });
    },
});
