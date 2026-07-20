// PlanCatalogModule — NestJS-Modul, das den `PlanCatalog` als
// DI-Provider bereitstellt (Konsumenten injizieren `PLAN_CATALOG_TOKEN`).
//
// SPEC_V2 §11.1 M6 Pack 2c (Hard-Replace): Der Catalog wird aus DB
// rekonstruiert (statt aus YAML). Apps reichen einen
// `PlanCatalogReadSink` durch + ihre statischen App-Identity-Settings
// (`projectKey`, `currency`, `vatRate`).
//
// `forRootWithCatalog(catalog)` bleibt für Tests / In-Memory-Setup.
// Die alte `forRoot({ path: 'saas.yaml' })` ist entfallen — Apps
// importieren ihre saas.yaml einmalig via PlanCatalogImporterModule
// und betreiben den Catalog ab dann aus der DB.

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
    /** Build-Time-Identity der App. */
    projectKey: string;
    /**
     * App-Identity-Block (Branding + Version) aus `config/saas.yaml#app`.
     * Fließt in `PLAN_CATALOG_TOKEN.app` und von dort in den AdminPublicBoot-
     * Endpoint + die AdminManifestConfig.
     */
    app?: PlanCatalog['app'];
    currency: string;
    vatRate: number;
    /**
     * App-weite Marketing-Konfiguration (SPEC_V2 §6.5) — u. a. der
     * `availableLocales`-Pool. Fließt in `PLAN_CATALOG_TOKEN.marketing`
     * und von dort ins Admin-Manifest (`project.availableLocales`).
     */
    marketing?: PlanCatalog['marketing'];
    /** App-spezifischer Adapter für DB-Reads. */
    sink: ProviderSpec<PlanCatalogReadSink>;
    /** Module, die im DI-Scope sichtbar sein müssen (analog CatalogModule). */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    /** Default `true`. */
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
     * Tests / In-Memory-Setup: nimmt das Catalog-Objekt direkt entgegen,
     * ohne Sink/DB-Lookup. Für Unit-Tests + Test-Bootstraps.
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
