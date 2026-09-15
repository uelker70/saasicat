import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { holdsTenantAdminRole } from './tenant-roles.js';

// TenantAdminGuard — verifies that the logged-in user has the `TENANT_ADMIN`
// role (or `SUPER_ADMIN`). Used in addition to `ComposedTenantAuthGuard` for
// cost-relevant plan/add-on mutations.
//
// Expects `request.user.platformRole` or, as a fallback, `request.user.role`
// — both conventions are documented as equivalent in the platform codebase
// (`packages/core/src/ports/core-ports.types.ts` PlatformRole).

@Injectable()
export class TenantAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        if (!holdsTenantAdminRole(context)) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.TENANT_ADMIN_REQUIRED,
                message: 'This action requires the TENANT_ADMIN role.',
            });
        }
        return true;
    }
}
