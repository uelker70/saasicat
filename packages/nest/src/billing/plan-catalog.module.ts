// PlanCatalogModule — NestJS module that provides the plan catalogue: the
// settings of `config/saas.yaml` under `PLAN_CATALOG_SETTINGS_TOKEN`, and the
// plans and features as they stand under `PLAN_CATALOG_SOURCE_TOKEN`.
//
// `forRoot` reads the plans and features from the database through a
// `PlanCatalogReadSink`, at the moment an operation asks for them; the settings
// come from the file. `forRootWithCatalog(catalog)` takes a fixed catalogue,
// for tests and in-memory setups.

import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import {
    planCatalogSettingsOf,
    type PlanCatalog,
    type PlanCatalogReadSink,
    type PlanCatalogSettings,
} from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { databasePlanCatalogSource, givenPlanCatalogSource } from './plan-catalog-source.js';

// `Symbol.for` (not a local `Symbol`): these tokens cross subpath-bundle
// boundaries — a consumer may wire `EntitlementModule` (from
// `@saasicat/nest/entitlement`) against the source that `PlanCatalogModule`
// (reached via `@saasicat/nest/platform`) provides. The CJS builds do not share
// module instances, so a local `Symbol()` would be two different tokens and
// Nest DI would fail to resolve them.
//
// Two tokens rather than one catalogue, because the two halves move
// differently. The settings are fixed for the life of the process; the plans
// and features change whenever an operator publishes, and a value read at
// start would go on selling what was published before it.

/** The settings of `config/saas.yaml` — a `PlanCatalogSettings`, fixed while the process runs. */
export const PLAN_CATALOG_SETTINGS_TOKEN = Symbol.for('saasicat/nest/PlanCatalogSettings');
/** A `PlanCatalogSource`: the plans and features as they stand when an operation asks. */
export const PLAN_CATALOG_SOURCE_TOKEN = Symbol.for('saasicat/nest/PlanCatalogSource');
export const PLAN_CATALOG_READ_SINK_TOKEN = Symbol.for('saasicat/nest/PLAN_CATALOG_READ_SINK');

/**
 * Every settings block of `config/saas.yaml` — app identity, currency, VAT rate,
 * tenant billing and the rest — beside the read sink the plans and features
 * come from. The settings are handed on whole, so a block the schema gains
 * reaches `PLAN_CATALOG_SETTINGS_TOKEN` without this module learning its name.
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
                { provide: PLAN_CATALOG_SETTINGS_TOKEN, useValue: settings },
                {
                    provide: PLAN_CATALOG_SOURCE_TOKEN,
                    useFactory: async (sink: PlanCatalogReadSink) => {
                        const source = databasePlanCatalogSource(settings, sink);
                        // One read at start, and its result is not kept: a sink
                        // that cannot read the tables stops the boot here,
                        // rather than at the first customer who asks for a
                        // price.
                        await source.current();
                        return source;
                    },
                    inject: [PLAN_CATALOG_READ_SINK_TOKEN],
                },
            ],
            exports: [
                PLAN_CATALOG_SETTINGS_TOKEN,
                PLAN_CATALOG_SOURCE_TOKEN,
                PLAN_CATALOG_READ_SINK_TOKEN,
            ],
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
                { provide: PLAN_CATALOG_SETTINGS_TOKEN, useValue: planCatalogSettingsOf(catalog) },
                { provide: PLAN_CATALOG_SOURCE_TOKEN, useValue: givenPlanCatalogSource(catalog) },
            ],
            exports: [PLAN_CATALOG_SETTINGS_TOKEN, PLAN_CATALOG_SOURCE_TOKEN],
            global: opts.global ?? true,
        };
    }
}
