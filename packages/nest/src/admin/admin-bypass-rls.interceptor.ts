// AdminBypassRlsInterceptor — runs a route inside the RLS bypass. A route
// that acts for the platform rather than for a tenant reads and writes across
// tenants, and a policy filtering on the tenant would hide what it looks for.
// The platform puts it on every route its operator chain guards
// (`UseRouteGuards`); an integrator's own operator controller puts it there
// by hand.
//
// The consumer supplies the `RlsBypassPort` implementation (e.g. an
// AsyncLocalStorage `run({ ...getStore(), bypassRls: true }, …)`, a Django
// `contextvars` equivalent, …). Platform code only calls the port. The frame
// it opens is the innermost one of the request, so it carries over what the
// installation's own frame holds — the user, the tenant — rather than
// replacing it.
// Without one bound — an installation wiring modules by hand and no row
// policy to lift — the route runs as it is, as `readAcrossTenants` does. An
// integrator's own controller that puts this interceptor on a route therefore
// sits in a module that sees the port; where it does not, nothing says so and
// the route runs in the tenant's frame. No warning either: an installation
// without row policies binds no port on purpose, and a warning it cannot
// silence teaches everyone to skip warnings.

import {
    type CallHandler,
    type ExecutionContext,
    Inject,
    Injectable,
    type NestInterceptor,
    Optional,
} from '@nestjs/common';
import { Observable, defer, from } from 'rxjs';
import { switchAll } from 'rxjs/operators';
import type { RlsBypassPort } from '@saasicat/core';
import { RLS_BYPASS_PORT_TOKEN } from './admin.tokens.js';

@Injectable()
export class AdminBypassRlsInterceptor implements NestInterceptor {
    constructor(
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly port: RlsBypassPort | null = null,
    ) {}

    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const port = this.port;
        if (!port) return next.handle();
        // `next.handle()` is called inside the frame, and that is what puts the
        // handler there: Nest binds the handler to the async context it is
        // asked for in (`AsyncResource.bind`), so it runs in the frame even
        // though the stream it returns is subscribed to after the frame's
        // callback has returned. The stream itself is passed through, not
        // collected.
        return defer(() => from(port.runWithBypass(async () => next.handle())).pipe(switchAll()));
    }
}
