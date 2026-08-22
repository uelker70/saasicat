// The discovery snapshot — what a code scan found, before anyone reviewed it.
//
// The one family that does not go through `requestJson`, and the reason is the
// ETag. `requestJson` collapses "204", "unparsable 2xx" and — since 304 is
// neither `>= 400` nor 204 — "not modified" into the same `null`, which is
// right for the catalogue family and wrong here: a caller that cannot tell a
// cache hit from an empty answer either re-parses a body it does not have or
// throws away the snapshot it already holds.
//
// So these two operations read the status themselves and answer with a
// discriminated result. The conditional request stays the caller's decision —
// the descriptor is given the tag it should revalidate against, rather than
// holding one, because a descriptor is bound once and shared by every page
// that asks for it.

import { AdminError } from '../admin-error.js';
import { requireServerAnswer } from '../http-json.js';
import type { DiscoverySnapshot } from '@saasicat/types';

import { defineResource, type ResourceContext } from './define-resource.js';

/**
 * The answer to a conditional read.
 *
 * `unchanged` carries no snapshot on purpose: the server said the caller's copy
 * is current, and returning a re-fetched one would defeat the request.
 */
export type DiscoveryRead =
    | { readonly status: 'unchanged' }
    | {
          readonly status: 'loaded';
          readonly snapshot: DiscoverySnapshot;
          /** `null` when the server sent none — revalidation is then a full read. */
          readonly etag: string | null;
      };

function discoveryUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/discovery`;
}

function fail(status: number, method: string, url: string, message: string): AdminError {
    return new AdminError({ status, url, method, message });
}

export const discoveryResource = defineResource('discovery', {
    /**
     * Reads the snapshot, revalidating against `etag` when one is passed.
     *
     * Pass `null` (or nothing) to force a full read — that is what
     * `useDiscovery.reload()` does when the operator asks for fresh data.
     */
    read: async (http, ctx, etag: string | null = null): Promise<DiscoveryRead> => {
        const url = discoveryUrl(ctx);
        const headers: Record<string, string> = {};
        if (etag) headers['If-None-Match'] = etag;

        const response = await http(url, { method: 'GET', headers });
        requireServerAnswer(response.status, 'GET', url, (diagnostic) =>
            fail(response.status, 'GET', url, diagnostic),
        );

        if (response.status === 304) return { status: 'unchanged' };
        if (response.status !== 200) {
            throw fail(
                response.status,
                'GET',
                url,
                `Discovery endpoint responded with HTTP ${response.status}`,
            );
        }
        return {
            status: 'loaded',
            snapshot: (await response.json()) as DiscoverySnapshot,
            etag: response.headers.get('ETag'),
        };
    },

    /**
     * Re-runs the scan and returns what it found.
     *
     * Unconditional by construction: a rescan asks the server to look again,
     * so revalidating against a tag the previous scan produced would answer
     * with the snapshot the rescan was meant to replace.
     */
    rescan: async (http, ctx): Promise<{ snapshot: DiscoverySnapshot; etag: string | null }> => {
        const url = `${discoveryUrl(ctx)}/rescan`;
        const response = await http(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        });
        requireServerAnswer(response.status, 'POST', url, (diagnostic) =>
            fail(response.status, 'POST', url, diagnostic),
        );

        if (response.status !== 200 && response.status !== 201) {
            throw fail(
                response.status,
                'POST',
                url,
                `Discovery rescan responded with HTTP ${response.status}`,
            );
        }
        return {
            snapshot: (await response.json()) as DiscoverySnapshot,
            etag: response.headers.get('ETag'),
        };
    },
});
