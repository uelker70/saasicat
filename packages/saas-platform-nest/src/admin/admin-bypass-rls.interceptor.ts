// AdminBypassRlsInterceptor — wrappt die Request-Pipeline in einen
// RLS-Bypass-Kontext. Plattform-/Admin-Routen sind plattform-weit (kein
// Tenant-Scope), daher müssen RLS-Policies, die auf
// `tenantId = app_current_tenant()` filtern, explizit umgangen werden.
//
// Konsument liefert die `RlsBypassPort`-Implementation (z. B. AutohausPro'
// `tenantContext.run({bypassRls: true}, …)` AsyncLocalStorage,
// Django-`contextvars`-Pendant, …). Plattform-Code ruft nur den Port.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.3 (2.3).

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
        // `runWithBypass` setzt den Konsumenten-AsyncLocalStorage-Frame und
        // ruft die Callback-Funktion synchron innerhalb dieses Frames auf.
        // Wir rufen dort `next.handle().toPromise()` (via firstValueFrom) — der
        // Handler-Code läuft dann komplett im Bypass-Frame.
        return defer(() =>
            from(
                this.port.runWithBypass(async () => {
                    // toPromise() würde alle Werte sammeln; wir wollen den
                    // Stream durchreichen. Daher als Observable wieder rauspipen.
                    return next.handle();
                }),
            ).pipe(switchAll()),
        );
    }
}
