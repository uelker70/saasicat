import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

// TenantAdminGuard — prüft, dass der eingeloggte User die `TENANT_ADMIN`-Rolle
// (oder `SUPER_ADMIN`) hat. Wird zusätzlich zum `ComposedTenantAuthGuard` für
// kostenwirksame Plan-/Add-on-Mutationen verwendet.
//
// Erwartet `request.user.platformRole` oder als Fallback `request.user.role`
// — beide Konventionen sind in der Plattform-Codebase gleichwertig
// dokumentiert (`saas-platform-types/src/ports.types.ts` PlatformRole).

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
