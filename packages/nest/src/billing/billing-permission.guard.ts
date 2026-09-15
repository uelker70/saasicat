import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { holdsTenantAdminRole } from './tenant-roles.js';
import { BILLING_PERMISSION_GUARDS_TOKEN, type AuthGuardList } from './tenant-billing.tokens.js';

/**
 * The billing permission: who of a tenant's users may see and change what the
 * subscriber pays with — and, as they arrive, its invoices and its account.
 * The plan, the usage and a change's preview are not behind it.
 *
 * The application decides who holds it by passing guards
 * (`payments.billingPermissionGuards`), so a role such as accounting can hold
 * it without being the tenant's administrator. Without guards the tenant's
 * administrator holds it. Runs after the tenant's authentication guards, so a
 * user is on the request.
 */
@Injectable()
export class BillingPermissionGuard implements CanActivate {
    constructor(
        @Optional()
        @Inject(BILLING_PERMISSION_GUARDS_TOKEN)
        private readonly guards: AuthGuardList | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (await this.holdsPermission(context)) return true;
        throw new ForbiddenException(codedError(AUTH_ERROR_CODES.BILLING_PERMISSION_REQUIRED));
    }

    private async holdsPermission(context: ExecutionContext): Promise<boolean> {
        if (!this.guards || this.guards.length === 0) return holdsTenantAdminRole(context);
        for (const guard of this.guards) {
            if (!(await Promise.resolve(guard.canActivate(context)))) return false;
        }
        return true;
    }
}
