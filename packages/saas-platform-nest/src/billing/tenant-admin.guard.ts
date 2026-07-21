import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

// TenantAdminGuard — verifies that the logged-in user has the `TENANT_ADMIN`
// role (or `SUPER_ADMIN`). Used in addition to `ComposedTenantAuthGuard` for
// cost-relevant plan/add-on mutations.
//
// Expects `request.user.platformRole` or, as a fallback, `request.user.role`
// — both conventions are documented as equivalent in the platform codebase
// (`saas-platform-types/src/ports.types.ts` PlatformRole).

interface RequestWithUser {
    user?: {
        platformRole?: string;
        role?: string;
    };
}

const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'SUPER_ADMIN']);

@Injectable()
export class TenantAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        if (!request.user) {
            throw new ForbiddenException('Nicht authentifiziert');
        }
        const role = request.user.platformRole ?? request.user.role;
        if (!role || !ADMIN_ROLES.has(role)) {
            throw new ForbiddenException('Diese Aktion erfordert die TENANT_ADMIN-Rolle.');
        }
        return true;
    }
}
