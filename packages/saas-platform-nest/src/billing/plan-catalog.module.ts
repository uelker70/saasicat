// PlanCatalogModule — NestJS module that provides the `PlanCatalog` as a
// DI provider (consumers inject `PLAN_CATALOG_TOKEN`).
//
// SPEC_V2 §11.1 M6 Pack 2c (hard replace): the catalog is reconstructed
// from the DB (instead of from YAML). Apps pass through a
// `PlanCatalogReadSink` + their static app-identity settings
// (`projectKey`, `currency`, `vatRate`).
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
import type { PlanCatalog, PlanCatalogReadSink } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { buildPlanCatalogFromSnapshot } from './plan-catalog-from-snapshot.js';

export const PLAN_CATALOG_TOKEN = Symbol('PLAN_CATALOG');
export const PLAN_CATALOG_READ_SINK_TOKEN = Symbol('PLAN_CATALOG_READ_SINK');

export interface PlanCatalogModuleOptions {
    /** Build-time identity of the app. */
    projectKey: string;
    /**
     * App-identity block (branding + version) from `config/saas.yaml#app`.
     * Flows into `PLAN_CATALOG_TOKEN.app` and from there into the
     * AdminPublicBoot endpoint + the AdminManifestConfig.
     */
    app?: PlanCatalog['app'];
    currency: string;
    vatRate: number;
    /**
     * App-wide marketing configuration (SPEC_V2 §6.5) — including the
     * `availableLocales` pool. Flows into `PLAN_CATALOG_TOKEN.marketing`
     * and from there into the admin manifest (`project.availableLocales`).
     */
    marketing?: PlanCatalog['marketing'];
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
                        const snapshot = await sink.loadSnapshot(options.projectKey);
                        return buildPlanCatalogFromSnapshot(
                            {
                                projectKey: options.projectKey,
                                app: options.app,
                                currency: options.currency,
                                vatRate: options.vatRate,
                                marketing: options.marketing,
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
