// SuperAdminGuard — protects platform/admin routes on `role === 'SUPER_ADMIN'`.
//
// Expects a `request.user.role` field (NestJS/Passport convention). The
// auth pipeline (JwtAuthGuard) must run before this guard.

import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

interface RequestWithUser {
    user?: { role?: string };
}

@Injectable()
export class SuperAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        if (!request.user) throw new ForbiddenException('Nicht authentifiziert');
        if (request.user.role !== 'SUPER_ADMIN') {
            throw new ForbiddenException('Nur SUPER_ADMIN-Rolle erlaubt');
        }
        return true;
    }
}
