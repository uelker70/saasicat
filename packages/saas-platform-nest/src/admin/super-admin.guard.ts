// SuperAdminGuard — schützt Plattform-/Admin-Routen auf `role === 'SUPER_ADMIN'`.
//
// Erwartet ein `request.user.role`-Feld (NestJS-Passport-Konvention). Die
// Auth-Pipeline (JwtAuthGuard) muss vor diesem Guard laufen.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.3 (2.1).

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
