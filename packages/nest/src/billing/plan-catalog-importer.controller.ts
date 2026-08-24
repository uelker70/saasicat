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

import {
    PLAN_CATALOG_UNREADABLE_ERROR,
    PlanCatalogValidationError,
} from './plan-catalog-loader.js';
import { CATALOG_ERROR_CODES } from '@saasicat/core';

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
 * Decided by name, not by message. Two things can fail here without the
 * platform being at fault — the YAML parser, and the loader's own check that
 * the document is an object at all — and neither is a class this package owns.
 * A message prefix looked like it covered both and did not: a `yamlContent` of
 * `"hello"` parses cleanly, is not a catalog, and answered 500.
 *
 * Anything this cannot place is rethrown and answers 500, which is the honest
 * status for a failure that is not the caller's.
 */
const UNREADABLE_ERROR_NAMES = new Set([
    'YAMLException',
    'YAMLParseError',
    PLAN_CATALOG_UNREADABLE_ERROR,
]);

function isUnreadableDocument(error: unknown): boolean {
    return error instanceof Error && UNREADABLE_ERROR_NAMES.has(error.name);
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
                        code: CATALOG_ERROR_CODES.PLAN_CATALOG_INVALID,
                        message: error.message,
                        params: { message: error.message, errors: error.errors },
                    });
                }
                if (isUnreadableDocument(error)) {
                    throw new BadRequestException({
                        code: CATALOG_ERROR_CODES.PLAN_CATALOG_UNREADABLE,
                        message: (error as Error).message,
                    });
                }
                throw error;
            }
        }
    }

    return GeneratedPlanCatalogImporterController;
}
