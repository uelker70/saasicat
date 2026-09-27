// The routes a maintenance lock lets through.
//
// A mark rather than a list of paths: the platform does not know where an
// application mounts its health probe or under which prefix its routes live,
// and a path compared as a string breaks the day a global prefix is added.

import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

/**
 * Metadata key for a controller or handler that stays reachable while the
 * lock holds. `Symbol.for` keeps the mark stable across package entries.
 */
export const ALLOW_DURING_MAINTENANCE_KEY = Symbol.for('saasicat/nest/allow-during-maintenance');

/**
 * Keeps a controller or handler reachable while the application is locked for
 * maintenance: a health or readiness probe, which the deploy's health gate
 * asks before anybody unlocks, or an administrator's own sign-in.
 *
 * Marking a route a tenant uses defeats the lock for it — whatever it writes
 * then races the migration the lock is there to protect.
 */
export const AllowDuringMaintenance = (): ClassDecorator & MethodDecorator =>
    SetMetadata(ALLOW_DURING_MAINTENANCE_KEY, true);

/** Whether the current endpoint is marked as reachable during maintenance. */
export function isAllowedDuringMaintenance(
    reflector: Reflector,
    context: ExecutionContext,
): boolean {
    return (
        reflector.getAllAndOverride<boolean>(ALLOW_DURING_MAINTENANCE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) === true
    );
}
