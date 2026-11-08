import {
    type CanActivate,
    type ExecutionContext,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantAccessService } from '@saasicat/nest';
import { isSaaSiCatPublicRoute } from '@saasicat/nest/platform';

/**
 * DEMO ONLY — identifies the caller from two plain headers instead of real
 * authentication, so the example can be driven with curl:
 *
 *     x-demo-tenant: tenant-a          (required)
 *     x-demo-role:   SUPER_ADMIN       (the admin app)
 *                    TENANT_ADMIN      (the tenant app's own billing actions)
 *
 * The role is NOT only for the admin endpoints, and describing it that way is
 * what let the web app ship without it: `TenantAdminGuard` guards the five
 * cost-relevant tenant routes and reads the same field, so a caller without a
 * role gets 403 on every one of them.
 *
 * It fills `request.user` with the shape the platform guards read by
 * default (`request.tenantId ?? request.user?.tenantId` + `platformRole`).
 * A real app replaces this with its JWT guard — nothing else changes.
 *
 * Registered as a global guard, it lets the routes SaaSiCat marks public
 * through: a payment gateway's callback carries no session, and its signature
 * is what the webhook route checks instead. A JWT guard in the same position
 * does the same.
 *
 * Once the user is known, the tenant's access state is asked (`SC-ADM-024`):
 * a suspended tenant's users are refused, a read-only tenant's writes are. This
 * is the line a real app adds at the end of its own authentication guard. The
 * operator's requests are the administration's, not a tenant's, and are not
 * held to it.
 */
@Injectable()
export class DemoAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @Inject(TenantAccessService) private readonly access: TenantAccessService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (isSaaSiCatPublicRoute(this.reflector, context)) return true;
        const request = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
            user?: {
                userId: string;
                tenantId: string;
                platformRole?: string;
                email: string;
                sessionId: string;
            };
        }>();
        const tenantId = firstHeader(request.headers['x-demo-tenant']);
        if (!tenantId) {
            throw new UnauthorizedException(
                'Demo auth: send the x-demo-tenant header (see examples/notesapp/README.md).',
            );
        }
        const platformRole = firstHeader(request.headers['x-demo-role']);
        request.user = {
            userId: `demo-user-${tenantId}`,
            tenantId,
            platformRole,
            email:
                platformRole === 'SUPER_ADMIN'
                    ? 'admin@notesapp.example'
                    : `demo-user-${tenantId}@notesapp.example`,
            sessionId: 'notesapp-demo',
        };
        if (platformRole !== 'SUPER_ADMIN') await this.access.enforce(context, tenantId);
        return true;
    }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
