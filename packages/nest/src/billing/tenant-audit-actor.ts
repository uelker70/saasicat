// Who made a tenant's write, as the audit log records it: the user the request
// carries, their email, and the session it came from — read where every route
// reads them (`core/request-user.ts`), with the tenant's own context where no
// session names one. A tenant's write refuses a request that names nobody.

import { NotFoundException } from '@nestjs/common';
import { AUTH_ERROR_CODES, type AdminActor } from '@saasicat/core';

import {
    actorFromRequest,
    requestUserEmailOf,
    requestUserIdOf,
    type RequestActorResolvers,
} from '../core/request-user.js';
import { TENANT_SELF_SERVICE_CONTEXT } from './tenant-billing.tokens.js';

/** The resolvers the application configured; an absent one reads the platform's default. */
export type TenantAuditResolvers = RequestActorResolvers;

/** The user the request carries, refused where it carries none. */
export function requireTenantUserId(req: unknown, resolvers: TenantAuditResolvers): string {
    const userId = requestUserIdOf(req, resolvers.userId);
    if (!userId) {
        throw new NotFoundException({
            code: AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING,
            message: 'No user ID found on the request',
        });
    }
    return userId;
}

/** The email of the user the request carries, or null where none is known. */
export function tenantUserEmailOf(req: unknown, resolvers: TenantAuditResolvers): string | null {
    return requestUserEmailOf(req, resolvers.email);
}

/** The audit actor of a tenant's write made by `userId` through `req`. */
export function tenantActorOf(
    req: unknown,
    userId: string,
    resolvers: TenantAuditResolvers,
): AdminActor {
    return {
        ...actorFromRequest(req, resolvers, TENANT_SELF_SERVICE_CONTEXT),
        userId,
    };
}
