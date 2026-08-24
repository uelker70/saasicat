import {
    type CanActivate,
    type ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';

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
 */
@Injectable()
export class DemoAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
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
        return true;
    }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
