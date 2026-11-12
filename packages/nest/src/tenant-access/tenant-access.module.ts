// TenantAccessModule — the store of the reasons a tenant is held back, and the
// service every tenant request is checked against (`SC-ADM-055`).
//
// Composed by `SaaSiCatModule` wherever tenants are served, which refuses to
// start without a store. Global, so that the application's own authentication
// guard and its scheduled jobs can inject `TenantAccessService` without
// importing anything, and so that the platform's tenant routes reach it from
// whichever feature module mounts them.

import { type DynamicModule, Module } from '@nestjs/common';
import type { TenantAccessHoldPort } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { TenantAccessService } from './tenant-access.service.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from './tenant-access.tokens.js';

export interface TenantAccessModuleOptions {
    /** Where the reasons are kept; the persistence bundle's `core.tenantAccessHolds`. */
    holds: ProviderSpec<TenantAccessHoldPort>;
}

@Module({})
export class TenantAccessModule {
    static forRoot(options: TenantAccessModuleOptions): DynamicModule {
        return {
            module: TenantAccessModule,
            global: true,
            providers: [asProvider(TENANT_ACCESS_HOLDS_TOKEN, options.holds), TenantAccessService],
            exports: [TenantAccessService, TENANT_ACCESS_HOLDS_TOKEN],
        };
    }
}
