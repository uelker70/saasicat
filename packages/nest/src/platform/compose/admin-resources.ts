import type { DynamicModule } from '@nestjs/common';
import type { AdminResourcesPort } from '@saasicat/types';

import { AdminResourcesModule } from '../../admin/admin-resources.module.js';
import { SuperAdminGuard } from '../../admin/super-admin.guard.js';
import type { ProviderSpec } from '../../core/di.js';

import { optionsOf, type CompositionContext } from './context.js';

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
            guards: config.guards ?? [...options.controller.guards, SuperAdminGuard],
            imports: config.imports ?? options.imports,
        }),
    ];
}
