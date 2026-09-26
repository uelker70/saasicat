import type { CanActivate, DynamicModule, Type } from '@nestjs/common';
import type { AdminResourcesPort } from '@saasicat/core';

import { AdminResourcesModule } from '../../admin/admin-resources.module.js';
import type { ProviderSpec } from '../../core/di.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { operatorGuards, optionsOf, type CompositionContext } from './context.js';

/** Tenants, users, audit and subscriptions for the SuperAdmin pages. */
export function composeAdminResources({
    options,
    persistence,
    shared,
}: CompositionContext): DynamicModule[] {
    if (!options.adminResources) return [];
    const config = optionsOf(options.adminResources);
    shared.adminResourcesModule = AdminResourcesModule.forRoot({
        resources:
            config.resources ??
            (persistence?.adminResources?.resources as ProviderSpec<AdminResourcesPort>),
        guards: adminResourceGuards(options),
        imports: config.imports ?? options.imports,
    });
    return [shared.adminResourcesModule];
}

/** The guards the administration's tenant routes run behind. */
export function adminResourceGuards(options: SaaSiCatModuleOptions): Array<Type<CanActivate>> {
    return optionsOf(options.adminResources).guards ?? operatorGuards(options);
}
