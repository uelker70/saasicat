import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { TENANT_AUTH_GUARDS_TOKEN, type AuthGuardList } from './tenant-billing.tokens.js';

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

@Injectable()
export class ComposedTenantAuthGuard implements CanActivate {
    constructor(
        @Optional()
        @Inject(TENANT_AUTH_GUARDS_TOKEN)
        private readonly guards: AuthGuardList | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.guards || this.guards.length === 0) {
            // No configured guard is a setup error — otherwise tenant-scoped
            // endpoints would have no auth protection. Better to fail loudly
            // than to wave requests through silently.
            throw new ForbiddenException(
                'TenantBillingModule.forRoot.authGuards ist nicht konfiguriert.',
            );
        }
        for (const guard of this.guards) {
            const result = await Promise.resolve(guard.canActivate(context));
            if (!result) return false;
        }
        return true;
    }
}
