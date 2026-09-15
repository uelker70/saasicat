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
    const role = request.user.platformRole ?? request.user.role;
    return Boolean(role && ADMIN_ROLES.has(role));
}
