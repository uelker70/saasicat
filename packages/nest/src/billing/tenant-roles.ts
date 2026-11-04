// Whether a request's user is the tenant's administrator. Shared by the guard
// that requires the role and the billing permission, which the administrator
// holds unless the application says otherwise — one list of roles for both.
//
// Expects `request.user.platformRole` or, as a fallback, `request.user.role`
// (`PlatformRole` in `@saasicat/core`).

import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

interface RequestWithUser {
    user?: {
        platformRole?: string;
        role?: string;
    };
}

const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'SUPER_ADMIN']);

/** Whether the request's user holds `TENANT_ADMIN` or `SUPER_ADMIN`; refuses a request without a user. */
export function holdsTenantAdminRole(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
        throw new ForbiddenException({
            code: AUTH_ERROR_CODES.NOT_AUTHENTICATED,
            message: 'Not authenticated',
        });
    }
    return mayChangeWhatTheTenantPays(request);
}

/**
 * Whether the user a request carries is the tenant's administrator — what a
 * preview answers as whether its reader may make the change, by the rule
 * `TenantAdminGuard` refuses the change by.
 */
export function mayChangeWhatTheTenantPays(request: unknown): boolean {
    if (typeof request !== 'object' || request === null || !('user' in request)) return false;
    const { user } = request;
    if (typeof user !== 'object' || user === null) return false;
    const role =
        ('platformRole' in user && typeof user.platformRole === 'string'
            ? user.platformRole
            : null) ?? ('role' in user && typeof user.role === 'string' ? user.role : null);
    return role !== null && ADMIN_ROLES.has(role);
}
