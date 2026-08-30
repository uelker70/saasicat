// The four modules every configuration gets, and the app identity they need.
//
// Not conditional on anything, which is why they are not among the feature
// composers: a platform without a plan catalogue, discovery, the admin core
// and the manifest is not a configuration anyone asked for.

import type { DynamicModule } from '@nestjs/common';
import type {
    AuditPort,
    MfaPort,
    PlanCatalog,
    PlanCatalogReadSink,
    RlsBypassPort,
} from '@saasicat/core';

import { AdminManifestModule } from '../../admin/admin-manifest.module.js';
import { AdminModule } from '../../admin/admin.module.js';
import { PlanCatalogModule } from '../../billing/plan-catalog.module.js';
import type { ProviderSpec } from '../../core/di.js';
import { DiscoveryModule } from '../../discovery/discovery.module.js';
import type { DiscoveryAppInfo } from '../../discovery/discovery.scanner.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { buildMinimalManifestConfig } from './manifest.js';

/** Where the discovery snapshot goes unless the app names another path. */
const DEFAULT_SNAPSHOT_PATH = 'var/discovery-snapshot.json';

/**
 * Who this application is, for discovery and the public catalogue.
 *
 * `app.name` is the only place an installation names itself, and both
 * catalogue paths require it — so there is nothing to fall back to and no
 * placeholder that would collide with every other installation's.
 */
export function resolveAppInfo(options: SaaSiCatModuleOptions): DiscoveryAppInfo {
    if (options.app) return options.app;
    // Non-null here: `assertConfiguration` runs before this, and two of its
    // rules together guarantee it — `catalog.identity-or-sink` refuses a
    // configuration with neither catalogue, `catalog.app-is-named` refuses one
    // whose catalogue names no application. Deliberately not `?? ''`: an empty
    // key would reach the discovery snapshot and the manifest with nothing
    // saying the identity was missing, which is the failure mode the old
    // `'app'` placeholder existed to avoid.
    const app = (options.planCatalog?.app ?? options.dbCatalog?.app) as PlanCatalog['app'];
    return { key: app.name, version: app.version ?? '0.0.0' };
}

/**
 * The plan catalogue, from the YAML or from the database.
 *
 * Global, because the catalogue is read by nearly every other module and an
 * app should not have to import it into each of them.
 */
export function composePlanCatalog(
    options: SaaSiCatModuleOptions,
    sink: ProviderSpec<PlanCatalogReadSink> | undefined,
): DynamicModule {
    if (options.planCatalog) {
        return PlanCatalogModule.forRootWithCatalog(options.planCatalog, { global: true });
    }
    // Non-null on this branch: `catalog.identity-or-sink` has already refused a
    // configuration that reaches here without it.
    const dbCatalog = options.dbCatalog as NonNullable<SaaSiCatModuleOptions['dbCatalog']>;
    return PlanCatalogModule.forRoot({
        app: dbCatalog.app,
        currency: dbCatalog.currency,
        vatRate: dbCatalog.vatRate,
        tenantBilling: dbCatalog.tenantBilling,
        marketing: dbCatalog.marketing,
        sink: sink as ProviderSpec<PlanCatalogReadSink>,
        imports: options.imports,
    });
}

export interface CorePorts {
    readonly mfaPort: ProviderSpec<MfaPort>;
    readonly auditPort: ProviderSpec<AuditPort>;
    readonly rlsBypassPort: ProviderSpec<RlsBypassPort>;
}

/** Discovery, the admin core and the manifest — in that order. */
export function composeBaseModules(
    options: SaaSiCatModuleOptions,
    appInfo: DiscoveryAppInfo,
    ports: CorePorts,
): DynamicModule[] {
    return [
        DiscoveryModule.forRoot({
            app: appInfo,
            controller: { guards: options.controller.guards },
            imports: options.imports,
            snapshotPath:
                options.discoverySnapshotPath === undefined
                    ? DEFAULT_SNAPSHOT_PATH
                    : options.discoverySnapshotPath,
        }),
        AdminModule.forRoot({ ...ports, imports: options.imports, global: true }),
        AdminManifestModule.forRoot({
            config: options.adminManifestConfig ?? buildMinimalManifestConfig(),
            extraProviders: options.adminManifestExtraProviders,
            includeManifestController: options.includeManifestController,
            guards: options.controller.guards,
            reloadGuards: options.reloadGuards,
            imports: options.imports,
            // Global like AdminModule above: apps register their manifest
            // contribution by injecting AdminManifestService into one of their
            // own modules (docs/guides/wire-the-backend.md, "Manifest
            // Contributions"). Re-exporting the module from here
            // does not make that injection resolvable.
            global: true,
        }),
    ];
}
