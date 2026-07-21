// EnforceQuotaInterceptor — auto-enforcement for `@EnforceQuota(key)`.
//
// Reads the metadata, asks the matching `QuotaProvider` (via the
// QuotaProviders registry) for the tenant's current usage, compares it with
// the plan limit from `StaticEntitlementService`, and throws
// `LimitExceededError` (→ 429) on overrun.
//
// **Soft check.** A race between count and insert is possible. For strictly
// transactional enforcement (e.g. storage GB for large files),
// `EntitlementService.enforceLimit(...)` remains the preferable path as an
// imperative API.
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
        if (!user) return; // without a user: no tenant, no limit check (auth guard should 401 first)
        const role = user.role ?? user.platformRole;
        if (role === 'SUPER_ADMIN') return;
        const tenantId = request.tenantId ?? user.tenantId;
        if (!tenantId) return;

        const provider = (this.providers ?? []).find((p) => p.key === meta.quotaKey);
        if (!provider) {
            // No provider registered → the platform cannot enforce, so let it
            // through. Discovery flags the gap separately.
            return;
        }

        const limit = await this.entitlements.quotaLimit(tenantId, meta.quotaKey);
        if (limit === null || limit === -1) return; // -1 = unlimited, null = no quota in the plan
        const current = await provider.count(tenantId);
        const delta = meta.incrementBy ?? 1;
        if (current + delta > limit) {
            throw new LimitExceededError(meta.quotaKey, limit, current);
        }
    }
}
