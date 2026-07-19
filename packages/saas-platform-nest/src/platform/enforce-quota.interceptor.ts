// EnforceQuotaInterceptor — Auto-Enforcement für `@EnforceQuota(key)`.
//
// Liest die Metadata, befragt den passenden `QuotaProvider` (via
// QuotaProviders-Registry) nach dem aktuellen Verbrauch des Tenants,
// vergleicht mit dem Plan-Limit aus `StaticEntitlementService` und wirft
// `LimitExceededError` (→ 429) bei Überschreitung.
//
// **Soft-Check.** Race zwischen Count und Insert ist möglich. Für strikt
// transaktionalen Enforce (z. B. Storage-GB bei großen Files) bleibt
// `EntitlementService.enforceLimit(...)` als imperative API der
// vorzuziehende Pfad.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7.

import {
    type CallHandler,
    type ExecutionContext,
    Inject,
    Injectable,
    type NestInterceptor,
    Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { QuotaProvider } from '@saasicat/types';
import { ENFORCE_QUOTA_KEY } from '../discovery/tokens.js';
import { LimitExceededError } from '../entitlement/limit-exceeded-error.js';
import { StaticEntitlementService } from './static-entitlement.service.js';

export const QUOTA_PROVIDERS_TOKEN = Symbol.for('saas-platform-nest/QuotaProviders');

interface RequestWithUser {
    user?: { role?: string; platformRole?: string; tenantId?: string };
    tenantId?: string;
}

interface EnforceQuotaMetadataShape {
    quotaKey: string;
    incrementBy?: number;
}

@Injectable()
export class EnforceQuotaInterceptor implements NestInterceptor {
    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        @Inject(StaticEntitlementService)
        private readonly entitlements: StaticEntitlementService,
        @Optional()
        @Inject(QUOTA_PROVIDERS_TOKEN)
        private readonly providers: ReadonlyArray<QuotaProvider> | null = null,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const meta = this.reflector.getAllAndOverride<EnforceQuotaMetadataShape | undefined>(
            ENFORCE_QUOTA_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!meta?.quotaKey) return next.handle();

        return from(this.check(context, meta)).pipe(switchMap(() => next.handle()));
    }

    private async check(
        context: ExecutionContext,
        meta: EnforceQuotaMetadataShape,
    ): Promise<void> {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user;
        if (!user) return; // ohne User: kein Tenant, kein Limit-Check (Auth-Guard sollte vorher 401)
        const role = user.role ?? user.platformRole;
        if (role === 'SUPER_ADMIN') return;
        const tenantId = request.tenantId ?? user.tenantId;
        if (!tenantId) return;

        const provider = (this.providers ?? []).find((p) => p.key === meta.quotaKey);
        if (!provider) {
            // Kein Provider registriert → Plattform kann nicht enforcen,
            // also durchlassen. Discovery zeigt die Lücke separat an.
            return;
        }

        const limit = await this.entitlements.quotaLimit(tenantId, meta.quotaKey);
        if (limit === null || limit === -1) return; // -1 = unbegrenzt, null = keine Quota im Plan
        const current = await provider.count(tenantId);
        const delta = meta.incrementBy ?? 1;
        if (current + delta > limit) {
            throw new LimitExceededError(meta.quotaKey, limit, current);
        }
    }
}
