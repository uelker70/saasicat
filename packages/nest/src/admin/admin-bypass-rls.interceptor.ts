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
// Without one bound the route runs as it is, as `readAcrossTenants` does.
// `SaaSiCatModule.forRoot` never gets there: it refuses to boot without a port
// (`core.adapters-bound`) and registers it globally, so every module of the
// application sees it, an integrator's own included. What is left is a module
// mounted without the platform — a test's, mostly — and a frame missing there
// fails closed: a policy that is not lifted hides rows, it shows none. No
// warning for the same reason: it would fire only where nothing is wrong.

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
