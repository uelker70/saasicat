// Maintenance windows: the module, and the global guard that holds the lock.
//
// Two contributions rather than one. The module goes among the imports like
// every other feature's. The guard goes into the platform module's own
// providers, ahead of the feature guard: global guards run in the order they
// were registered, and a request refused for maintenance must not first have
// its entitlements read from the tables a migration is changing.

import type { DynamicModule, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { MaintenanceWindowPort } from '@saasicat/core';

import type { ProviderSpec } from '../../core/di.js';
import { MaintenanceGuard } from '../../maintenance/maintenance.guard.js';
import { MaintenanceModule } from '../../maintenance/maintenance.module.js';

import { operatorGuards, optionsOf, type CompositionContext } from './context.js';

export function composeMaintenance({ options, persistence }: CompositionContext): DynamicModule[] {
    if (!options.maintenance) return [];
    const config = optionsOf(options.maintenance);
    return [
        MaintenanceModule.forRoot({
            // `maintenance.requires-windows-port` has refused a configuration
            // that reaches here without one.
            windows: (config.windows ??
                persistence?.core.maintenanceWindows) as ProviderSpec<MaintenanceWindowPort>,
            notifications: config.notifications,
            controller: { guards: operatorGuards(options) },
            includeAdminController: config.includeAdminController,
            imports: options.imports,
        }),
    ];
}

/** The global guard, where maintenance is on; first among the platform's own. */
export function maintenanceGuardProviders({ options }: CompositionContext): Provider[] {
    return options.maintenance ? [{ provide: APP_GUARD, useExisting: MaintenanceGuard }] : [];
}
