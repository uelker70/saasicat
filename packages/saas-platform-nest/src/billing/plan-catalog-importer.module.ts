// PlanCatalogImporterModule — DI wrapper around the importer service.
// SPEC_V2 §11.1 M6 Pack 2c.
//
// Consumers pass their app-specific `PlanCatalogImportSink` through and
// get the service plus optionally an admin endpoint
// (`POST /admin/billing/plan-catalog/import`).

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { PlanCatalogImportSink } from '@saasicat/types';

import {
    PLAN_CATALOG_IMPORT_SINK_TOKEN,
    PlanCatalogImporterService,
} from './plan-catalog-importer.service.js';
import { buildPlanCatalogImporterController } from './plan-catalog-importer.controller.js';
import { asProvider, type ProviderSpec } from '../core/di.js';

export interface PlanCatalogImporterControllerConfig {
    /**
     * Class-level guards for `/admin/billing/plan-catalog/import`. Required
     * when `controller` is set — pass `[]` explicitly for auth-free
     * (only sensible in tests).
     */
    guards: Array<Type<CanActivate>>;
}

export interface PlanCatalogImporterModuleOptions {
    sink: ProviderSpec<PlanCatalogImportSink>;
    controller?: PlanCatalogImporterControllerConfig;
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class PlanCatalogImporterModule {
    static forRoot(options: PlanCatalogImporterModuleOptions): DynamicModule {
        const providers: Provider[] = [
            ...(options.extraProviders ?? []),
            asProvider(PLAN_CATALOG_IMPORT_SINK_TOKEN, options.sink),
            PlanCatalogImporterService,
        ];
        const controllers: Type[] = [];
        if (options.controller) {
            controllers.push(buildPlanCatalogImporterController(options.controller.guards));
        }
        return {
            module: PlanCatalogImporterModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports: [PlanCatalogImporterService],
        };
    }
}
