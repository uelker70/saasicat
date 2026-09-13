// Pilot tenants: who is on a trial, until when, and the four transitions.
//
// ── Why this is a descriptor and not seven page props ───────────────────────
//
// The platform ships `PilotsPage` but serves no pilot route — the data belongs
// to the consuming app, whose own backend answers it. That used to mean the
// page took seven callbacks and every app wrote them again.
//
// The paths below are not invented. They are the ones the consumers already
// call: `/pilots`, `/pilots/review`, `/pilots/create`, `/pilots/:slug`,
// `/pilots/:slug/extend`, `/pilots/:slug/revoke`. Writing them down turns a
// convention three apps happened to share into a contract one of them can read.
//
// An app whose backend differs overrides the operation rather than the page —
// see `createSuperAdminApp({ resources: { overrides: { pilots: … } } })`.

import type {
    PilotRow,
    PilotCreatePayload,
    PilotCreateResult,
    PilotEditPayload,
    PilotEditResult,
} from './pilots.types.js';

import { mfaHeader } from '../mfa-header.js';
import { defineResource } from './define-resource.js';
import { requestJson, requestJsonBody } from './resource-request.js';

export type {
    PilotRow,
    PilotCreatePayload,
    PilotCreateResult,
    PilotEditPayload,
    PilotEditResult,
} from './pilots.types.js';

function pilotsUrl(base: string): string {
    return `${base}/pilots`;
}

export const pilotsResource = defineResource('pilots', {
    list: async (http, ctx): Promise<PilotRow[]> =>
        (await requestJson<PilotRow[]>(http, pilotsUrl(ctx.apiBase))) ?? [],

    /** The pilots whose end date is close enough to need a decision. */
    reviewSoon: async (http, ctx): Promise<PilotRow[]> =>
        (await requestJson<PilotRow[]>(http, `${pilotsUrl(ctx.apiBase)}/review`)) ?? [],

    create: (
        http,
        ctx,
        payload: PilotCreatePayload,
        mfaCode?: string,
    ): Promise<PilotCreateResult> =>
        requestJsonBody<PilotCreateResult>(
            http,
            `${pilotsUrl(ctx.apiBase)}/create`,
            'Create returned no body',
            { method: 'POST', body: payload, headers: mfaHeader(mfaCode) },
        ),

    update: (
        http,
        ctx,
        slug: string,
        payload: PilotEditPayload,
        mfaCode?: string,
    ): Promise<PilotEditResult> =>
        requestJsonBody<PilotEditResult>(
            http,
            `${pilotsUrl(ctx.apiBase)}/${encodeURIComponent(slug)}`,
            'Update returned no body',
            { method: 'PATCH', body: payload, headers: mfaHeader(mfaCode) },
        ),

    /** Moves the end date. `until` is a date string, not a duration. */
    extend: async (http, ctx, slug: string, until: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${pilotsUrl(ctx.apiBase)}/${encodeURIComponent(slug)}/extend`, {
            method: 'POST',
            body: { until },
            headers: mfaHeader(mfaCode),
        });
    },

    revoke: async (http, ctx, slug: string, mfaCode?: string): Promise<void> => {
        await requestJson(http, `${pilotsUrl(ctx.apiBase)}/${encodeURIComponent(slug)}/revoke`, {
            method: 'POST',
            headers: mfaHeader(mfaCode),
        });
    },
});
