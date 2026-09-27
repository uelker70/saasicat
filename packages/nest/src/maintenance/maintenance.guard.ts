// MaintenanceGuard — refuses every request while the application is locked for
// maintenance, except the ones that have to get through.
//
// Registered as a global guard, before the platform's feature guard, so that a
// refused request reads nothing but the lock: a guard that asked for a tenant's
// entitlements first would read the tables a migration is changing, and answer
// with whatever that migration left half done (`SC-OPS-013`).
//
// What passes:
//
//   - a route marked `@AllowDuringMaintenance()` — the administration, the
//     status a tenant's page reads, and the application's own probes;
//   - a platform administrator whose sign-in the application has already
//     established, so the operator can try the new version before unlocking.
//     Only where authentication ran before this guard: with authentication on
//     the controller, the user is not known here, and the operator's way in is
//     the administration, which is marked.
//
// A payment provider's callback is not among them. It is refused like any
// other request, and the provider retries it once the lock is gone.

import {
    type CanActivate,
    type ExecutionContext,
    Inject,
    Injectable,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    MAINTENANCE_ERROR_CODES,
    maintenanceRetryAfterSeconds,
    maintenanceStatusOf,
    maintenanceWindowStatusOf,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { isAllowedDuringMaintenance } from './allow-during-maintenance.js';
import { MaintenanceService } from './maintenance.service.js';

interface RequestWithUser {
    user?: { platformRole?: string; role?: string };
}

/** Express's response and Fastify's reply both say `header(name, value)`. */
interface ResponseLike {
    header?: (name: string, value: string) => unknown;
    setHeader?: (name: string, value: string) => unknown;
}

/** The same pair, in the same order, as `SuperAdminGuard` reads it. */
function isPlatformAdministrator(user: RequestWithUser['user']): boolean {
    return (user?.platformRole ?? user?.role) === 'SUPER_ADMIN';
}

function setHeader(response: ResponseLike, name: string, value: string): void {
    if (typeof response.header === 'function') response.header(name, value);
    else if (typeof response.setHeader === 'function') response.setHeader(name, value);
}

@Injectable()
export class MaintenanceGuard implements CanActivate {
    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') return true;
        if (isAllowedDuringMaintenance(this.reflector, context)) return true;

        const open = await this.maintenance.openWindow();
        if (!open || maintenanceWindowStatusOf(open) !== 'locked') return true;

        const http = context.switchToHttp();
        if (isPlatformAdministrator(http.getRequest<RequestWithUser>().user)) return true;

        const now = new Date();
        setHeader(
            http.getResponse<ResponseLike>(),
            'Retry-After',
            String(maintenanceRetryAfterSeconds(open, now)),
        );
        throw new ServiceUnavailableException({
            ...codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE, {
                endsAt: open.endsAt?.toISOString() ?? null,
            }),
            maintenance: maintenanceStatusOf(open, now),
        });
    }
}
