// MaintenanceModule — maintenance windows, the lock and the routes around it.
//
// Composed by `SaaSiCatModule` where `maintenance` is on, which also registers
// `MaintenanceGuard` globally, ahead of its own feature guard. An application
// wiring this module by hand registers the guard itself:
//
//     { provide: APP_GUARD, useExisting: MaintenanceGuard }
//
// Global, so that a scheduled job anywhere in the application can inject
// `MaintenanceService` and ask `isLocked()` before it runs.

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { MaintenanceNotificationPort, MaintenanceWindowPort } from '@saasicat/core';

import { AdminManifestService } from '../admin/admin-manifest.service.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { buildMaintenanceAdminController } from './maintenance-admin.controller.js';
import { MAINTENANCE_MANIFEST_CONTRIBUTION } from './maintenance-manifest.js';
import { MaintenanceStatusController } from './maintenance-status.controller.js';
import { MaintenanceGuard } from './maintenance.guard.js';
import { MaintenanceService } from './maintenance.service.js';
import {
    MAINTENANCE_NOTIFICATION_PORT_TOKEN,
    MAINTENANCE_WINDOW_PORT_TOKEN,
} from './maintenance.tokens.js';

/** Marks the provider that registers the module's manifest contribution. */
const MAINTENANCE_MANIFEST_REGISTRATION_TOKEN = Symbol.for(
    'saasicat/nest/MaintenanceManifestRegistration',
);

export interface MaintenanceModuleOptions {
    /** Where windows are kept — the application's own database. */
    windows: ProviderSpec<MaintenanceWindowPort>;
    /**
     * Hears of a window announced, moved or cancelled, so the application can
     * write to its users. Optional: without it tenants see the banner only.
     */
    notifications?: ProviderSpec<MaintenanceNotificationPort>;
    /** Class-level guards for the operator's routes under `/admin/maintenance`. */
    controller: { guards: Array<Type<CanActivate>> };
    /**
     * Mount the operator's routes. Default `true`; `false` for an application
     * that serves them itself. The lock and the status route are there either
     * way, and so is the command line.
     */
    includeAdminController?: boolean;
    /** Modules whose providers the guards or the port factories resolve from. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

@Module({})
export class MaintenanceModule {
    static forRoot(options: MaintenanceModuleOptions): DynamicModule {
        const withAdmin = options.includeAdminController !== false;
        const providers: Provider[] = [
            asProvider(MAINTENANCE_WINDOW_PORT_TOKEN, options.windows),
            options.notifications
                ? asProvider(MAINTENANCE_NOTIFICATION_PORT_TOKEN, options.notifications)
                : { provide: MAINTENANCE_NOTIFICATION_PORT_TOKEN, useValue: null },
            MaintenanceService,
            MaintenanceGuard,
            WebAuditLogger,
        ];
        if (withAdmin) {
            providers.push({
                provide: MAINTENANCE_MANIFEST_REGISTRATION_TOKEN,
                useFactory: (manifest: AdminManifestService | null) => {
                    manifest?.register(MAINTENANCE_MANIFEST_CONTRIBUTION);
                    return MAINTENANCE_MANIFEST_CONTRIBUTION;
                },
                inject: [{ token: AdminManifestService, optional: true }],
            });
        }
        return {
            module: MaintenanceModule,
            global: true,
            imports: options.imports ?? [],
            controllers: [
                MaintenanceStatusController,
                ...(withAdmin ? [buildMaintenanceAdminController(options.controller.guards)] : []),
            ],
            providers,
            exports: [
                MaintenanceService,
                MaintenanceGuard,
                MAINTENANCE_WINDOW_PORT_TOKEN,
                MAINTENANCE_NOTIFICATION_PORT_TOKEN,
            ],
        };
    }
}
