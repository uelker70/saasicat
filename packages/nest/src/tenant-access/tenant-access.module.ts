// TenantAccessModule — the store of the reasons a tenant is held back, and the
// service every tenant request is checked against (`SC-ADM-055`).
//
// Composed by `SaaSiCatModule` wherever tenants are served, which refuses to
// start without a store. Global, so that the application's own authentication
// guard and its scheduled jobs can inject `TenantAccessService` without
// importing anything, and so that the platform's tenant routes reach it from
// whichever feature module mounts them.
//
// The service reads through `RlsBypassPort` where one is in scope.
// `SaaSiCatModule` provides it globally; a module wired by hand brings it in
// through `imports`, or the reasons are read in the caller's frame.

import { type DynamicModule, type ForwardReference, Module, type Type } from '@nestjs/common';
import type { TenantAccessHoldPort } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { TenantAccessService } from './tenant-access.service.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from './tenant-access.tokens.js';

export interface TenantAccessModuleOptions {
    /** Where the reasons are kept; the persistence bundle's `core.tenantAccessHolds`. */
    holds: ProviderSpec<TenantAccessHoldPort>;
    /**
     * Modules whose providers must be visible here: those a `holds` factory
     * injects, and — under row-level security, where nothing provides it
     * globally — the one that provides `RlsBypassPort`, such as the
     * application's `AdminModule.forRoot(...)`. `SaaSiCatModule` needs none.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

@Module({})
export class TenantAccessModule {
    static forRoot(options: TenantAccessModuleOptions): DynamicModule {
        return {
            module: TenantAccessModule,
            global: true,
            imports: options.imports ?? [],
            providers: [asProvider(TENANT_ACCESS_HOLDS_TOKEN, options.holds), TenantAccessService],
            exports: [TenantAccessService, TENANT_ACCESS_HOLDS_TOKEN],
        };
    }
}
