import type { Provider } from '@nestjs/common';

import { BillingPermissionGuard } from '../billing/billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
import {
    BILLING_PERMISSION_GUARDS_TOKEN,
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
} from '../billing/tenant-billing.tokens.js';
import { userTenantIdOf } from '../billing/tenant-id.js';
import { asProvider } from '../core/di.js';
import type { PaymentsTenantRoutesOptions } from './payments.module.js';

/**
 * What a route of the tenant's billing area is guarded by: the application's
 * authentication, then the billing permission (`SC-UI-023`), and the tenant
 * a request belongs to, taken from its session.
 */
export function billingAreaRouteProviders(tenant: PaymentsTenantRoutesOptions): Provider[] {
    return [
        asProvider(TENANT_AUTH_GUARDS_TOKEN, tenant.authGuards),
        ComposedTenantAuthGuard,
        BillingPermissionGuard,
        { provide: TENANT_ID_RESOLVER_TOKEN, useValue: tenant.tenantIdResolver ?? userTenantIdOf },
        ...(tenant.billingPermissionGuards
            ? [asProvider(BILLING_PERMISSION_GUARDS_TOKEN, tenant.billingPermissionGuards)]
            : []),
    ];
}
