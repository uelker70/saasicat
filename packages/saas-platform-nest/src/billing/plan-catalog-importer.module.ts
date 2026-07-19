// PlanCatalogImporterModule — DI-Wrapper um den Importer-Service.
// SPEC_V2 §11.1 M6 Pack 2c.
//
// Konsumenten reichen ihren App-spezifischen `PlanCatalogImportSink`
// durch und bekommen den Service plus optional einen Admin-Endpoint
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
     * Class-Level-Guards für `/admin/billing/plan-catalog/import`. Pflicht
     * wenn `controller` gesetzt — übergebe `[]` explizit für auth-frei
     * (nur in Tests sinnvoll).
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
