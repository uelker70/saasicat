// SuperAdminGuard — protects platform/admin routes on `role === 'SUPER_ADMIN'`.
//
// Reads `request.user.platformRole` with `request.user.role` as a fallback —
// the same pair every other platform guard accepts (see
// `billing/tenant-admin.guard.ts`). The auth pipeline (JwtAuthGuard) must run
// before this guard.

import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

interface RequestWithUser {
    user?: { role?: string; platformRole?: string };
}

@Injectable()
export class SuperAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        if (!request.user) throw new ForbiddenException('Nicht authentifiziert');
        const role = request.user.platformRole ?? request.user.role;
        if (role !== 'SUPER_ADMIN') {
            throw new ForbiddenException('Nur SUPER_ADMIN-Rolle erlaubt');
        }
        return true;
    }
}
