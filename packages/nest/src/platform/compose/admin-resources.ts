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
    const slot = options.adminResources;
    if (!slot) return [];
    const config = slot === true ? undefined : slot;
    // SAFETY: `admin-resources.requires-persistence` refuses to start where
    // the application names no `resources` and the bundle provides none, and
    // the bundle's member is a value or a factory with the tokens it injects —
    // what `asProvider` takes; only the factory's parameter list is typed
    // `never[]` where Nest's is `any[]`.
    const bundled = persistence?.adminResources?.resources as ProviderSpec<AdminResourcesPort>;
    const common = {
        guards: adminResourceGuards(options),
        imports: config?.imports ?? options.imports,
    };
    shared.adminResourcesModule = AdminResourcesModule.forRoot(
        config?.includeController === false
            ? { ...common, includeController: false, resources: config.resources ?? bundled }
            : { ...common, resources: config?.resources ?? bundled },
    );
    return [shared.adminResourcesModule];
}

/** The guards the administration's tenant routes run behind. */
export function adminResourceGuards(options: SaaSiCatModuleOptions): Array<Type<CanActivate>> {
    return optionsOf(options.adminResources).guards ?? operatorGuards(options);
}
