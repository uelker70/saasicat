// AdminBypassRlsInterceptor — wraps the request pipeline in an
// RLS-bypass context. Platform/admin routes are platform-wide (no
// tenant scope), so RLS policies that filter on
// `tenantId = app_current_tenant()` must be explicitly bypassed.
//
// The consumer supplies the `RlsBypassPort` implementation (e.g. an
// `tenantContext.run({bypassRls: true}, …)` AsyncLocalStorage,
// a Django `contextvars` equivalent, …). Platform code only calls the port.

import {
    type CallHandler,
    type ExecutionContext,
    Inject,
    Injectable,
    type NestInterceptor,
} from '@nestjs/common';
import { Observable, defer, from } from 'rxjs';
import { switchAll } from 'rxjs/operators';
import type { RlsBypassPort } from '@saasicat/types';
import { RLS_BYPASS_PORT_TOKEN } from './tokens.js';

@Injectable()
export class AdminBypassRlsInterceptor implements NestInterceptor {
    constructor(@Inject(RLS_BYPASS_PORT_TOKEN) private readonly port: RlsBypassPort) {}

    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
        // `runWithBypass` sets up the consumer AsyncLocalStorage frame and
        // calls the callback function synchronously inside that frame.
        // There we call `next.handle().toPromise()` (via firstValueFrom) — the
        // handler code then runs entirely inside the bypass frame.
        return defer(() =>
            from(
                this.port.runWithBypass(async () => {
                    // toPromise() would collect all values; we want to pass the
                    // stream through. So we pipe it back out as an Observable.
                    return next.handle();
                }),
            ).pipe(switchAll()),
        );
    }
}
