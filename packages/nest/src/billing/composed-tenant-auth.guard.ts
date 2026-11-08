import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { tenantIdOf } from './tenant-id.js';
import {
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    type AuthGuardList,
    type TenantIdResolver,
} from './tenant-billing.tokens.js';

// ComposedTenantAuthGuard — bundles a list of consumer-specific guards
// (e.g. JwtAuthGuard + TenantGuard + RolesGuard) into a single
// `@UseGuards()` entry. Used by the `TenantBillingController` because the
// guards to check differ per app and `@UseGuards()` is resolved at
// compile time.
//
// The consumer registers the list via `TenantBillingModule.forRoot.authGuards`
// (either a direct array or a useFactory provider that pulls the guards from
// the DI container). Order is significant — the first denial blocks all
// subsequent guards.
//
// Once the application's guards have let a request through, its tenant is
// known, and the tenant's access state is checked last (`SC-ADM-024`): every
// tenant route of the platform passes through here, so this one check covers
// them all. Where the application's guard already checked the request for the
// same tenant — saying, where it was, that the operator is acting as the
// tenant — that check stands; otherwise the request is checked as a tenant
// user's. Where no `TenantAccessService` is in scope — a module wired by hand
// without `SaaSiCatModule` — nothing records a reason either, so there is
// nothing to enforce.

@Injectable()
export class ComposedTenantAuthGuard implements CanActivate {
    constructor(
        @Optional()
        @Inject(TENANT_AUTH_GUARDS_TOKEN)
        private readonly guards: AuthGuardList | null = null,
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.guards || this.guards.length === 0) {
            // No configured guard is a setup error — otherwise tenant-scoped
            // endpoints would have no auth protection. Better to fail loudly
            // than to wave requests through silently.
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.AUTH_GUARDS_NOT_CONFIGURED,
                message: 'TenantBillingModule.forRoot.authGuards is not configured.',
            });
        }
        for (const guard of this.guards) {
            const result = await Promise.resolve(guard.canActivate(context));
            if (!result) return false;
        }
        if (this.access) {
            const request: unknown = context.switchToHttp().getRequest();
            await this.access.enforceUnlessChecked(
                context,
                tenantIdOf(this.tenantIdResolver, request),
            );
        }
        return true;
    }
}
