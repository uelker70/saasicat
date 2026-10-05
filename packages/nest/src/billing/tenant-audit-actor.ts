// Who made a tenant's write, as the audit log records it: the user the request
// carries, their email, and the session it came from — each read through the
// resolver the application configured, or else the platform's default. One
// reading for every tenant route that audits, so an entry says the same thing
// whichever controller wrote it.

import { NotFoundException } from '@nestjs/common';
import { AUTH_ERROR_CODES, type AdminActor } from '@saasicat/core';

import {
    TENANT_SELF_SERVICE_CONTEXT,
    type AuditContextResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from './tenant-billing.tokens.js';

/** The resolvers the application configured; an absent one reads the platform's default. */
export interface TenantAuditResolvers {
    readonly userId?: UserIdResolver | null;
    readonly email?: UserEmailResolver | null;
    readonly context?: AuditContextResolver | null;
}

interface AuthenticatedRequest {
    user?: { sub?: string; id?: string; email?: string } | null;
    headers?: Record<string, string | string[] | undefined>;
}

/** The user the request carries, refused where it carries none. */
export function requireTenantUserId(req: unknown, resolvers: TenantAuditResolvers): string {
    const resolver: UserIdResolver =
        resolvers.userId ??
        ((r: unknown) =>
            (r as AuthenticatedRequest).user?.sub ?? (r as AuthenticatedRequest).user?.id ?? null);
    const userId = resolver(req);
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
    const resolver: UserEmailResolver =
        resolvers.email ?? ((r: unknown) => (r as AuthenticatedRequest).user?.email ?? null);
    return resolver(req) ?? null;
}

/** The audit actor of a tenant's write made by `userId` through `req`. */
export function tenantActorOf(
    req: unknown,
    userId: string,
    resolvers: TenantAuditResolvers,
): AdminActor {
    const contextResolver: AuditContextResolver =
        resolvers.context ??
        ((r: unknown) => {
            const sid = (r as AuthenticatedRequest).headers?.['x-session-id'];
            if (Array.isArray(sid)) return sid[0] ?? null;
            return sid ?? null;
        });
    return {
        userId,
        email: tenantUserEmailOf(req, resolvers) ?? 'unknown',
        source: 'web',
        context: contextResolver(req) ?? TENANT_SELF_SERVICE_CONTEXT,
    };
}
