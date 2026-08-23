// PlanCatalogImporterController — REST endpoint for the one-shot import.
//
// Path: `POST /admin/billing/plan-catalog/import`. Body: `{ yamlContent }`.
// Response: `PlanCatalogImportReport` (created/skipped counters + warnings).

import {
    BadRequestException,
    Body,
    type CanActivate,
    Controller,
    Inject,
    Post,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

import { PlanCatalogValidationError } from './plan-catalog-loader.js';
import { PlanCatalogImporterService } from './plan-catalog-importer.service.js';

export class PlanCatalogImportDto {
    @IsString()
    @MinLength(1)
    yamlContent!: string;

    @IsOptional()
    @IsBoolean()
    crossFieldChecks?: boolean;
}

/**
 * Whether a failure came from reading the document rather than from the platform.
 *
 * The YAML parser and the loader both throw plain `Error`s, so the class cannot
 * decide it. What can: those two say what they could not read, and a failure
 * from further in — a repository, a transaction — does not. Anything this
 * cannot place is rethrown and answers 500, which is the honest status for it.
 */
function isParseFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.name === 'YAMLException' ||
        error.name === 'YAMLParseError' ||
        error.message.startsWith('Plan catalog')
    );
}

export function buildPlanCatalogImporterController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/billing/plan-catalog')
    @UseGuards(...guards)
    class GeneratedPlanCatalogImporterController {
        constructor(
            @Inject(PlanCatalogImporterService)
            private readonly service: PlanCatalogImporterService,
        ) {}

        /**
         * A body that does not parse or does not validate is the caller's
         * mistake, so it answers 400.
         *
         * Without this it answered 500: the loader throws a plain `Error` for
         * unparseable YAML and a `PlanCatalogValidationError` for a schema or
         * cross-field violation, and neither is an HTTP exception. A caller
         * cannot tell a bad upload from a broken server that way, and the one
         * they can fix is the one that looked unfixable.
         */
        @Post('import')
        async import(@Body() dto: PlanCatalogImportDto) {
            try {
                return await this.service.importFromYaml(dto.yamlContent, {
                    crossFieldChecks: dto.crossFieldChecks,
                });
            } catch (error) {
                if (error instanceof PlanCatalogValidationError) {
                    throw new BadRequestException({
                        code: 'PLAN_CATALOG_INVALID',
                        message: error.message,
                        params: { errors: error.errors },
                    });
                }
                if (isParseFailure(error)) {
                    throw new BadRequestException({
                        code: 'PLAN_CATALOG_UNREADABLE',
                        message: (error as Error).message,
                    });
                }
                throw error;
            }
        }
    }

    return GeneratedPlanCatalogImporterController;
}
