// The reasons a tenant is held back, and the check every tenant request passes
// (`SC-ADM-024`). Composed wherever tenants are served or the administration
// suspends them; the rule `tenant-access.requires-holds-port` has refused a
// configuration that reaches here without a store.

import type { DynamicModule } from '@nestjs/common';
import type { TenantAccessHoldPort } from '@saasicat/core';

import type { ProviderSpec } from '../../core/di.js';
import { TenantAccessModule } from '../../tenant-access/tenant-access.module.js';

import type { CompositionContext } from './context.js';

export function composeTenantAccess({ options, persistence }: CompositionContext): DynamicModule[] {
    if (!servesTenantAccess(options)) return [];
    // SAFETY: `tenant-access.requires-holds-port` refuses to start where tenant
    // access is served and the bundle provides no store, so it is defined here.
    const holds = persistence?.core.tenantAccessHolds as ProviderSpec<TenantAccessHoldPort>;
    return [TenantAccessModule.forRoot({ holds })];
}

/** Whether an installation keeps tenants' states: it serves tenants, or the administration suspends them. */
export function servesTenantAccess(options: {
    tenantBilling?: unknown;
    adminResources?: unknown;
}): boolean {
    return Boolean(options.tenantBilling || options.adminResources);
}
