// Who takes a tenant's full export through a request: the tenant its session
// names and the user as the audit log records them, and whether the request
// can carry the file at all. The same answers for the platform's route and for
// a download the application delivers itself, since each download recorded is
// the tenant's acknowledgement (`SC-PRIV-017`) and only its own administrator
// can give it (`SC-PRIV-020`).

import { ForbiddenException } from '@nestjs/common';
import { AUTH_ERROR_CODES, TENANT_ACCESS_ERROR_CODES, type AdminActor } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import {
    requireTenantUserId,
    tenantActorOf,
    type TenantAuditResolvers,
} from './tenant-audit-actor.js';
import type { TenantIdResolver } from './tenant-billing.tokens.js';
import { tenantIdOf } from './tenant-id.js';
import { isTheOperator, mayTakeTheTenantsExport } from './tenant-roles.js';

/** The tenant whose export a request takes, and who takes it. */
export interface ExportTaker {
    tenantId: string;
    actor: AdminActor;
}

/** The resolvers the application configured; an absent one reads the platform's default. */
export interface ExportTakerResolvers extends TenantAuditResolvers {
    readonly tenantId?: TenantIdResolver | null;
}

/**
 * Who takes the tenant's export through `request`. Refused with
 * `TENANT_EXPORT_NOT_FOR_OPERATOR` for the operator — a user holding
 * `SUPER_ADMIN`, or one the application's check let through as acting as the
 * tenant (`actingAsOperator`) — with `TENANT_ADMIN_REQUIRED` for a user who is
 * not the tenant's administrator, and with `TENANT_CONTEXT_MISSING` where the
 * session names no tenant or no user.
 */
export function exportTakerOf(
    request: unknown,
    resolvers: ExportTakerResolvers,
    actingAsOperator: boolean,
): ExportTaker {
    if (isTheOperator(request, actingAsOperator)) {
        throw new ForbiddenException(
            codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_NOT_FOR_OPERATOR),
        );
    }
    if (!mayTakeTheTenantsExport(request, actingAsOperator)) {
        throw new ForbiddenException(codedError(AUTH_ERROR_CODES.TENANT_ADMIN_REQUIRED));
    }
    const tenantId = tenantIdOf(resolvers.tenantId ?? null, request);
    return {
        tenantId,
        actor: tenantActorOf(request, requireTenantUserId(request, resolvers), resolvers),
    };
}

/**
 * Whether `request` is a `HEAD`. Express and Fastify answer one with the `GET`
 * handler and drop the body, so a download served on it sends no file — and a
 * stream written to it is still accepted to the end, as if it had gone out.
 */
export function isHead(request: unknown): boolean {
    return (
        typeof request === 'object' &&
        request !== null &&
        'method' in request &&
        typeof request.method === 'string' &&
        request.method.toUpperCase() === 'HEAD'
    );
}
