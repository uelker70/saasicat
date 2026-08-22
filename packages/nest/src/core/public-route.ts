import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

/**
 * Shared metadata key for endpoints that intentionally run without application
 * authentication. `Symbol.for` keeps the marker stable across package entries.
 */
export const SAASICAT_PUBLIC_ROUTE_KEY = Symbol.for('saasicat/nest/public-route');

/** Marks a SaaSiCat controller or handler as intentionally public. */
export const SaaSiCatPublicRoute = () => SetMetadata(SAASICAT_PUBLIC_ROUTE_KEY, true);

/** Returns whether the current endpoint is marked as a public SaaSiCat route. */
export function isSaaSiCatPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
    return (
        reflector.getAllAndOverride<boolean>(SAASICAT_PUBLIC_ROUTE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) === true
    );
}
