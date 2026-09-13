import type { DynamicModule } from '@nestjs/common';
import type { AdminResourcesPort } from '@saasicat/core';

import { AdminResourcesModule } from '../../admin/admin-resources.module.js';
import type { ProviderSpec } from '../../core/di.js';

import { operatorGuards, optionsOf, type CompositionContext } from './context.js';

/** Tenants, users, audit and subscriptions for the SuperAdmin pages. */
export function composeAdminResources({
    options,
    persistence,
}: CompositionContext): DynamicModule[] {
    if (!options.adminResources) return [];
    const config = optionsOf(options.adminResources);
    return [
        AdminResourcesModule.forRoot({
            resources:
                config.resources ??
                (persistence?.adminResources?.resources as ProviderSpec<AdminResourcesPort>),
            guards: config.guards ?? operatorGuards(options),
            imports: config.imports ?? options.imports,
        }),
    ];
}
