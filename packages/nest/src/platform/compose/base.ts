// The five modules every configuration gets, and the app identity they need.
//
// Not conditional on anything, which is why they are not among the feature
// composers: a platform without a plan catalogue, discovery, the admin core,
// the manifest and the record of its own configuration is not a configuration
// anyone asked for.

import type { DynamicModule } from '@nestjs/common';
import type {
    AppliedSettingsPort,
    AuditPort,
    EmailPort,
    MfaPort,
    PlanCatalog,
    PlanCatalogReadSink,
    RlsBypassPort,
} from '@saasicat/core';

import { AdminManifestModule } from '../../admin/admin-manifest.module.js';
import { AdminModule } from '../../admin/admin.module.js';
import { catalogSource, loadPlanCatalogFromFile } from '../../billing/plan-catalog-loader.js';
import { PlanCatalogModule } from '../../billing/plan-catalog.module.js';
import type { ProviderSpec } from '../../core/di.js';
import { DiscoveryModule } from '../../discovery/discovery.module.js';
import type { DiscoveryAppInfo } from '../../discovery/discovery.scanner.js';
import { SettingsModule } from '../../settings/settings.module.js';
import {
    DB_CATALOG_MEMBERS,
    type DbCatalogOptions,
    type SaaSiCatModuleOptions,
} from '../module-options.js';

import { buildMinimalManifestConfig } from './manifest.js';

/** Where the discovery snapshot goes unless the app names another path. */
const DEFAULT_SNAPSHOT_PATH = 'var/discovery-snapshot.json';

/**
 * What the settings record says about where the values came from when the
 * platform cannot name a file: `planCatalog` took an object — built in code,
 * or the loaded object copied so that the loader's memory of its path does
 * not follow it. The database path never needs the sentence, because
 * `dbCatalog` is a path and the platform read the file itself.
 */
export const SOURCE_IN_CODE = 'the object passed to SaaSiCatModule.forRoot({ planCatalog })';

/** Whether `dbCatalog` names a file at all: a non-blank `path`. Half of its shape. */
export function dbCatalogNamesAPath(
    dbCatalog: SaaSiCatModuleOptions['dbCatalog'],
): dbCatalog is DbCatalogOptions {
    return typeof dbCatalog?.path === 'string' && dbCatalog.path.trim() !== '';
}

/**
 * The members of a `dbCatalog` that are not what the option takes.
 *
 * The settings an upgrade left beside the path, most likely — `vatRate`,
 * `tenantBilling` — or a misspelt member. Either way a value that would be
 * ignored while looking like the one that runs, which is the one outcome the
 * refusal exists to prevent. `undefined` is not a member: a spread that
 * leaves a key behind with nothing in it has passed nothing, the same reading
 * `TenantBillingModule` takes of its moved options.
 */
export function dbCatalogLeftovers(dbCatalog: object): string[] {
    const taken = new Set<string>(DB_CATALOG_MEMBERS);
    return Object.entries(dbCatalog)
        .filter(([key, value]) => !taken.has(key) && value !== undefined)
        .map(([key]) => key);
}

/** Whether `dbCatalog` has the shape it takes: the path to the file, and nothing that is not. */
export function dbCatalogNamesAFile(
    dbCatalog: SaaSiCatModuleOptions['dbCatalog'],
): dbCatalog is DbCatalogOptions {
    return dbCatalogNamesAPath(dbCatalog) && dbCatalogLeftovers(dbCatalog).length === 0;
}

/**
 * The catalogue the configuration runs on, as far as it is known before the
 * database is asked.
 *
 * On the quickstart path it is the object given. On the database path it is
 * the file `dbCatalog` names, loaded here: its settings are what runs, and its
 * `plans` and `features` are not read, because the sink is their source.
 * Undefined where neither is usable — no catalogue at all, or a `dbCatalog`
 * that still carries the values — which the rules report by name, rather than
 * this throwing a TypeError at the first member read.
 *
 * A file that does not load throws the loader's own error, naming the file
 * and the field: the same error the quickstart path raises, where the
 * consumer calls the loader before `forRoot()` sees anything.
 */
export function resolveCatalog(options: SaaSiCatModuleOptions): PlanCatalog | undefined {
    if (options.planCatalog) return options.planCatalog;
    if (dbCatalogNamesAFile(options.dbCatalog)) return loadPlanCatalogFromFile(options.dbCatalog);
    return undefined;
}

/** Where the running settings came from, for the record. */
export function resolveSettingsSource(catalog: PlanCatalog): string {
    return catalogSource(catalog) ?? SOURCE_IN_CODE;
}

/**
 * Who this application is, for discovery and the public catalogue.
 *
 * `app.name` is the only place an installation names itself, and both
 * catalogue paths require it — so there is nothing to fall back to and no
 * placeholder that would collide with every other installation's.
 */
export function resolveAppInfo(
    options: SaaSiCatModuleOptions,
    catalog: PlanCatalog,
): DiscoveryAppInfo {
    if (options.app) return options.app;
    // Deliberately not `?? ''`: `catalog.app-is-named` has already refused a
    // catalogue whose application has no name, and an empty key reaching the
    // discovery snapshot and the manifest with nothing saying the identity was
    // missing is the failure mode the old `'app'` placeholder existed to avoid.
    return { key: catalog.app.name, version: catalog.app.version ?? '0.0.0' };
}

/**
 * The plan catalogue, from the YAML or from the database.
 *
 * Global, because the catalogue is read by nearly every other module and an
 * app should not have to import it into each of them.
 */
export function composePlanCatalog(
    options: SaaSiCatModuleOptions,
    catalog: PlanCatalog,
    sink: ProviderSpec<PlanCatalogReadSink> | undefined,
): DynamicModule {
    if (options.planCatalog) {
        return PlanCatalogModule.forRootWithCatalog(options.planCatalog, { global: true });
    }
    // The settings come from the file `dbCatalog` named, which is `catalog`
    // here; the plans and the features come from the sink, which
    // `catalog.identity-or-sink` has already refused a configuration without.
    return PlanCatalogModule.forRoot({
        app: catalog.app,
        currency: catalog.currency,
        vatRate: catalog.vatRate,
        tenantBilling: catalog.tenantBilling,
        marketing: catalog.marketing,
        notifications: catalog.notifications,
        sink: sink as ProviderSpec<PlanCatalogReadSink>,
        imports: options.imports,
    });
}

export interface CorePorts {
    readonly mfaPort: ProviderSpec<MfaPort>;
    readonly auditPort: ProviderSpec<AuditPort>;
    readonly rlsBypassPort: ProviderSpec<RlsBypassPort>;
    /** Optional: without it the platform runs unrecorded, and says so once. */
    readonly appliedSettingsPort?: ProviderSpec<AppliedSettingsPort>;
    /** Optional: without it the addresses in the file reach nobody, and the boot log says so once. */
    readonly emailPort?: ProviderSpec<EmailPort>;
}

/** Discovery, the admin core, the manifest and the settings record — in that order. */
export function composeBaseModules(
    options: SaaSiCatModuleOptions,
    catalog: PlanCatalog,
    appInfo: DiscoveryAppInfo,
    ports: CorePorts,
): DynamicModule[] {
    const { appliedSettingsPort, emailPort, ...adminPorts } = ports;
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
        AdminModule.forRoot({ ...adminPorts, imports: options.imports, global: true }),
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
        SettingsModule.forRoot({
            port: appliedSettingsPort,
            email: emailPort,
            source: resolveSettingsSource(catalog),
            controller: { guards: options.controller.guards },
            includeController: options.includeSettingsController,
            imports: options.imports,
        }),
    ];
}
