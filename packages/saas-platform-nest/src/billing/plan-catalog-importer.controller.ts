// PlanCatalogImporterController — REST endpoint for the one-shot import.
//
// Path: `POST /admin/billing/plan-catalog/import`. Body: `{ yamlContent }`.
// Response: `PlanCatalogImportReport` (created/skipped counters + warnings).

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
