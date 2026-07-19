// PlanCatalogImporterController — REST-Endpoint fuer den One-Shot-Import.
// SPEC_V2 §11.1 M6 Pack 2c.
//
// Pfad: `POST /admin/billing/plan-catalog/import`. Body: `{ yamlContent }`.
// Antwort: `PlanCatalogImportReport` (created/skipped-Counter + warnings).

import {
    Body,
    type CanActivate,
    Controller,
    Inject,
    Post,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

import { PlanCatalogImporterService } from './plan-catalog-importer.service.js';

export class PlanCatalogImportDto {
    @IsString()
    @MinLength(1)
    yamlContent!: string;

    @IsOptional()
    @IsBoolean()
    crossFieldChecks?: boolean;
}

export function buildPlanCatalogImporterController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/billing/plan-catalog')
    @UseGuards(...guards)
    class GeneratedPlanCatalogImporterController {
        constructor(
            @Inject(PlanCatalogImporterService)
            private readonly service: PlanCatalogImporterService,
        ) {}

        @Post('import')
        async import(@Body() dto: PlanCatalogImportDto) {
            return this.service.importFromYaml(dto.yamlContent, {
                crossFieldChecks: dto.crossFieldChecks,
            });
        }
    }

    return GeneratedPlanCatalogImporterController;
}
