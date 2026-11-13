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

/** The platform's role for the operator (`PlatformRole` in `@saasicat/core`). */
const OPERATOR_ROLE = 'SUPER_ADMIN';

const ADMIN_ROLES = new Set(['TENANT_ADMIN', OPERATOR_ROLE]);

/** Whether the request's user holds `TENANT_ADMIN` or `SUPER_ADMIN`; refuses a request without a user. */
export function holdsTenantAdminRole(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
        throw new ForbiddenException({
            code: AUTH_ERROR_CODES.NOT_AUTHENTICATED,
            message: 'Not authenticated',
        });
    }
    return isTenantAdministrator(request);
}

/**
 * Whether the user a request carries is the tenant's administrator — what a
 * preview answers as whether its reader may make the change, by the rule
 * `TenantAdminGuard` refuses the change by.
 */
export function mayChangeWhatTheTenantPays(request: unknown): boolean {
    return isTenantAdministrator(request);
}

/**
 * Whether a request is the operator's rather than one of the tenant's users:
 * its user holds `SUPER_ADMIN`, or the application's check let it through as
 * the operator acting as the tenant (`actingAsOperator`, `SC-ADM-005`).
 */
export function isTheOperator(request: unknown, actingAsOperator: boolean): boolean {
    return actingAsOperator || roleOf(request) === OPERATOR_ROLE;
}

/**
 * Whether the user a request carries may take the tenant's full export — what
 * the tenant's state answers as `mayExport` for its reader, by the rules the
 * download is refused by: the tenant's own administrator alone. The export
 * holds every user's data, which `TenantAdminGuard` keeps from the tenant's
 * other users, and each download is the tenant's acknowledgement
 * (`SC-PRIV-017`), which the operator acting as the tenant cannot give for it.
 */
export function mayTakeTheTenantsExport(request: unknown, actingAsOperator: boolean): boolean {
    return isTenantAdministrator(request) && !isTheOperator(request, actingAsOperator);
}

/** Whether the user a request carries holds `TENANT_ADMIN` or `SUPER_ADMIN`. */
function isTenantAdministrator(request: unknown): boolean {
    const role = roleOf(request);
    return role !== null && ADMIN_ROLES.has(role);
}

/** The role of the user a request carries: `platformRole`, or `role` where that is absent. */
function roleOf(request: unknown): string | null {
    if (typeof request !== 'object' || request === null || !('user' in request)) return null;
    const { user } = request;
    if (typeof user !== 'object' || user === null) return null;
    return (
        ('platformRole' in user && typeof user.platformRole === 'string'
            ? user.platformRole
            : null) ?? ('role' in user && typeof user.role === 'string' ? user.role : null)
    );
}
