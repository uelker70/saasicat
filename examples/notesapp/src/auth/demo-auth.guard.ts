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
 *     x-demo-role:   SUPER_ADMIN       (optional; for the admin endpoints)
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
            user?: { userId: string; tenantId: string; platformRole?: string };
        }>();
        const tenantId = firstHeader(request.headers['x-demo-tenant']);
        if (!tenantId) {
            throw new UnauthorizedException(
                'Demo auth: send the x-demo-tenant header (see examples/notesapp/README.md).',
            );
        }
        request.user = {
            userId: `demo-user-${tenantId}`,
            tenantId,
            platformRole: firstHeader(request.headers['x-demo-role']),
        };
        return true;
    }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
