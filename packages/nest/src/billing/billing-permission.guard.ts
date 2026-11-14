import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { holdsTenantAdminRole } from './tenant-roles.js';
import { BILLING_PERMISSION_GUARDS_TOKEN, type AuthGuardList } from './tenant-billing.tokens.js';

/** The statuses a guard refuses with, which say the user does not hold the permission. */
const REFUSALS: ReadonlySet<number> = new Set([HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN]);

/**
 * The billing permission: who of a tenant's users may see and change what the
 * subscriber pays with, whom it is billed to, and its invoices and contract
 * confirmations. The plan, the usage and a change's preview are not behind it.
 *
 * The application decides who holds it by passing guards
 * (`tenantBilling.billingPermissionGuards`), so a role such as accounting can
 * hold it without being the tenant's administrator. Without guards the
 * tenant's administrator holds it. Runs after the tenant's authentication
 * guards, so a user is on the request.
 *
 * The same decision answers `GET billing/access` whether its reader is told
 * the invoices by number and may pay (`isHeldBy`), so the route every user
 * reads and the routes behind the permission cannot come to disagree about
 * who holds it.
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

    /**
     * Whether the request's user holds the permission, answered rather than
     * refused: a guard of the application's that refuses — returning `false`,
     * or throwing a 401 or 403 — says they do not. Any other failure is not an
     * answer about the user, and is thrown.
     */
    async isHeldBy(context: ExecutionContext): Promise<boolean> {
        try {
            return await this.holdsPermission(context);
        } catch (error) {
            if (error instanceof HttpException && REFUSALS.has(error.getStatus())) return false;
            throw error;
        }
    }

    private async holdsPermission(context: ExecutionContext): Promise<boolean> {
        if (!this.guards || this.guards.length === 0) return holdsTenantAdminRole(context);
        for (const guard of this.guards) {
            if (!(await Promise.resolve(guard.canActivate(context)))) return false;
        }
        return true;
    }
}
