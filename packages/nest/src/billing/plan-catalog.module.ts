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
import type { PlanCatalog, PlanCatalogReadSink, PlanCatalogSettings } from '@saasicat/core';

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

/**
 * Every settings block of `config/saas.yaml` — app identity, currency, VAT rate,
 * tenant billing and the rest — beside the read sink the plans and features
 * come from. The settings are handed on whole, so a block the schema gains
 * reaches `PLAN_CATALOG_TOKEN` without this module learning its name.
 */
export interface PlanCatalogModuleOptions extends PlanCatalogSettings {
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
        const { sink: sinkSpec, imports, extraProviders, global, ...settings } = options;
        return {
            module: PlanCatalogModule,
            global: global ?? true,
            imports: imports ?? [],
            providers: [
                ...(extraProviders ?? []),
                asProvider(PLAN_CATALOG_READ_SINK_TOKEN, sinkSpec),
                {
                    provide: PLAN_CATALOG_TOKEN,
                    useFactory: async (sink: PlanCatalogReadSink) => {
                        const snapshot = await sink.loadSnapshot();
                        return buildPlanCatalogFromSnapshot(settings, snapshot);
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
