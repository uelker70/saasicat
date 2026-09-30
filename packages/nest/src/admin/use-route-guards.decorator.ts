// The guards of a route the platform mounts, and the frame the route runs in.
//
// A route whose chain holds `SuperAdminGuard` admits only the platform's
// administrator — every chain the platform composes for an operator route says
// so that way (`operatorGuards`). Such a route acts on behalf of the platform
// rather than of a tenant (`SC-SEC-003`), so under row-level security it runs
// in the bypass: inside a tenant's policy its lists come back empty and its
// counts as 0, which reads exactly like nothing.
//
// The frame follows from the chain, here, rather than from a list of routes
// somebody keeps: a controller built with an operator chain runs in the
// bypass, and one built with any other chain does not. The interceptor is
// scoped to the controller, so it runs inside every global one — an
// installation's own interceptor that opens the tenant's frame for the request
// included — and its frame is the innermost.

import {
    applyDecorators,
    type CanActivate,
    type Type,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';

import { AdminBypassRlsInterceptor } from './admin-bypass-rls.interceptor.js';
import { SuperAdminGuard } from './super-admin.guard.js';

/** `@UseGuards(...guards)`, and the bypass where the chain admits only the platform's administrator. */
export function UseRouteGuards(
    ...guards: Array<Type<CanActivate> | CanActivate>
): ClassDecorator & MethodDecorator {
    return guards.includes(SuperAdminGuard)
        ? applyDecorators(UseGuards(...guards), UseInterceptors(AdminBypassRlsInterceptor))
        : applyDecorators(UseGuards(...guards));
}
