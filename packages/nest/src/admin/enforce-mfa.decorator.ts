// The second factor on a route the platform itself mounts.
//
// `@RequireMfa()` only marks a handler; `MfaGuard` checks the mark wherever it
// runs. On an integrator's own controller the two meet because the integrator
// puts both there. On a controller the platform builds, the class-level chain
// comes from the integrator's options — `controller.guards`, an
// `adminResources.guards` override, or the whole chain of a module wired by
// hand — and a mark whose guard that chain leaves out checks nothing.
//
// So the guard is attached to the handler itself. Nest runs method-level guards
// after every class-level one, which keeps the order `MfaGuard` relies on: the
// caller is established and the role is checked before a code is asked for.
// The price is a dependency: a module carrying such a handler resolves
// `MfaService` at boot, which `SaaSiCatModule.forRoot` always provides and a
// module wired by hand has to import.

import { applyDecorators, UseGuards } from '@nestjs/common';

import { MfaGuard, RequireMfa } from './mfa.guard.js';

/** Requires the second factor on this handler, whatever guards its controller was built with. */
export function EnforceMfa(): MethodDecorator {
    return applyDecorators(RequireMfa(), UseGuards(MfaGuard));
}
