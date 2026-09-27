// Maintenance windows: announce one, move it, call it off, lock the application
// for a deploy and let tenants back in.
//
// Locking and unlocking carry the second factor, as suspending a tenant does:
// every tenant is locked out at once. The other three lock nobody out.

import type {
    MaintenanceLockView,
    MaintenanceOverview,
    MaintenanceUnlockView,
    MaintenanceWindowView,
} from '@saasicat/core';

import { mfaHeader } from '../mfa-header.js';
import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJsonBody } from './resource-request.js';

/** What an operator announces: both times as ISO strings with their zone. */
export interface MaintenanceAnnouncementInput {
    startsAt: string;
    endsAt: string;
    message?: string | null;
}

/** What an operator moves; what is left out stays, `message: null` takes it away. */
export interface MaintenanceRevisionInput {
    startsAt?: string;
    endsAt?: string;
    message?: string | null;
}

/** What an operator locks with; `windowId` is the window they are looking at. */
export interface MaintenanceLockInput {
    windowId?: string;
    endsAt?: string;
    message?: string | null;
}

function maintenanceUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/maintenance`;
}

function windowUrl(ctx: ResourceContext, id: string): string {
    return `${maintenanceUrl(ctx)}/${encodeURIComponent(id)}`;
}

export const maintenanceResource = defineResource('maintenance', {
    overview: async (http, ctx): Promise<MaintenanceOverview> =>
        requestJsonBody<MaintenanceOverview>(
            http,
            maintenanceUrl(ctx),
            'GET /maintenance answered with no body',
        ),

    announce: async (
        http,
        ctx,
        input: MaintenanceAnnouncementInput,
    ): Promise<MaintenanceWindowView> =>
        requestJsonBody<MaintenanceWindowView>(
            http,
            maintenanceUrl(ctx),
            'POST /maintenance answered with no body',
            { method: 'POST', body: input },
        ),

    reschedule: async (
        http,
        ctx,
        id: string,
        input: MaintenanceRevisionInput,
    ): Promise<MaintenanceWindowView> =>
        requestJsonBody<MaintenanceWindowView>(
            http,
            windowUrl(ctx, id),
            'PATCH /maintenance/{id} answered with no body',
            { method: 'PATCH', body: input },
        ),

    cancel: async (http, ctx, id: string): Promise<MaintenanceWindowView> =>
        requestJsonBody<MaintenanceWindowView>(
            http,
            `${windowUrl(ctx, id)}/cancel`,
            'POST /maintenance/{id}/cancel answered with no body',
            { method: 'POST' },
        ),

    lock: async (
        http,
        ctx,
        input: MaintenanceLockInput,
        mfaCode?: string,
    ): Promise<MaintenanceLockView> =>
        requestJsonBody<MaintenanceLockView>(
            http,
            `${maintenanceUrl(ctx)}/lock`,
            'POST /maintenance/lock answered with no body',
            { method: 'POST', body: input, headers: mfaHeader(mfaCode) },
        ),

    unlock: async (
        http,
        ctx,
        input: { windowId?: string },
        mfaCode?: string,
    ): Promise<MaintenanceUnlockView> =>
        requestJsonBody<MaintenanceUnlockView>(
            http,
            `${maintenanceUrl(ctx)}/unlock`,
            'POST /maintenance/unlock answered with no body',
            { method: 'POST', body: input, headers: mfaHeader(mfaCode) },
        ),
});
