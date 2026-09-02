// PlanCatalogModule — NestJS module that provides the `PlanCatalog` as a
// DI provider (consumers inject `PLAN_CATALOG_TOKEN`).
//
// (hard replace): the catalog is reconstructed
// from the DB (instead of from YAML). Apps pass through a
// `PlanCatalogReadSink` + their static app-identity settings
// (app identity, `currency`, `vatRate`).
//
// `forRootWithCatalog(catalog)` remains for tests / in-memory setup.
// The old `forRoot({ path: 'saas.yaml' })` has been dropped — apps
// import their saas.yaml once via PlanCatalogImporterModule and run the
// catalog from the DB from then on.

import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { PlanCatalog, PlanCatalogReadSink } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { buildPlanCatalogFromSnapshot } from './plan-catalog-from-snapshot.js';

// `Symbol.for` (not a local `Symbol`): these tokens cross subpath-bundle
// boundaries — a consumer may wire `EntitlementModule` (from
// `@saasicat/nest/entitlement`) against the `PLAN_CATALOG_TOKEN` that
// `PlanCatalogModule` (reached via `@saasicat/nest/platform`) provides. The CJS
// builds do not share module instances, so a local `Symbol()` would be two
// different tokens and Nest DI would fail to resolve `PLAN_CATALOG`.
export const PLAN_CATALOG_TOKEN = Symbol.for('saasicat/nest/PLAN_CATALOG');
export const PLAN_CATALOG_READ_SINK_TOKEN = Symbol.for('saasicat/nest/PLAN_CATALOG_READ_SINK');

export interface PlanCatalogModuleOptions {
    /**
     * App-identity block (branding + version) from `config/saas.yaml#app` —
     * the one place the application is named. Flows into
     * `PLAN_CATALOG_TOKEN.app` and from there into the AdminPublicBoot
     * endpoint + the AdminManifestConfig.
     */
    app: PlanCatalog['app'];
    currency: string;
    vatRate: number;
    /**
     * Commercial self-service settings from `config/saas.yaml#tenantBilling`.
     * The read sink loads plans and features; settings are never in the
     * database, so they can only come from the file.
     */
    tenantBilling: PlanCatalog['tenantBilling'];
    /**
     * App-wide marketing configuration — including the
     * `availableLocales` pool. Flows into `PLAN_CATALOG_TOKEN.marketing`
     * and from there into the admin manifest (`project.availableLocales`).
     */
    marketing?: PlanCatalog['marketing'];
    /** Who is told when the settings change — `config/saas.yaml#notifications`. */
    notifications?: PlanCatalog['notifications'];
    /** App-specific adapter for DB reads. */
    sink: ProviderSpec<PlanCatalogReadSink>;
    /** Modules that must be visible in the DI scope (analogous to CatalogModule). */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    /** Defaults to `true`. */
    global?: boolean;
}

@Module({})
export class PlanCatalogModule {
    static forRoot(options: PlanCatalogModuleOptions): DynamicModule {
        return {
            module: PlanCatalogModule,
            global: options.global ?? true,
            imports: options.imports ?? [],
            providers: [
                ...(options.extraProviders ?? []),
                asProvider(PLAN_CATALOG_READ_SINK_TOKEN, options.sink),
                {
                    provide: PLAN_CATALOG_TOKEN,
                    useFactory: async (sink: PlanCatalogReadSink) => {
                        const snapshot = await sink.loadSnapshot();
                        return buildPlanCatalogFromSnapshot(
                            {
                                app: options.app,
                                currency: options.currency,
                                vatRate: options.vatRate,
                                tenantBilling: options.tenantBilling,
                                marketing: options.marketing,
                                notifications: options.notifications,
                            },
                            snapshot,
                        );
                    },
                    inject: [PLAN_CATALOG_READ_SINK_TOKEN],
                },
            ],
            exports: [PLAN_CATALOG_TOKEN, PLAN_CATALOG_READ_SINK_TOKEN],
        };
    }

    /**
     * Tests / in-memory setup: takes the catalog object directly, without a
     * sink/DB lookup. For unit tests + test bootstraps.
     */
    static forRootWithCatalog(
        catalog: PlanCatalog,
        opts: { global?: boolean } = {},
    ): DynamicModule {
        return {
            module: PlanCatalogModule,
            providers: [
                {
                    provide: PLAN_CATALOG_TOKEN,
                    useValue: catalog,
                },
            ],
            exports: [PLAN_CATALOG_TOKEN],
            global: opts.global ?? true,
        };
    }
}
