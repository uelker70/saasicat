// BusinessTypesController — REST-Endpunkte für `business_types` +
// `business_type_versions`. Pattern analog zu BundlesController.

import {
    Body,
    type CanActivate,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { BusinessTypesService } from './business-types.service.js';
import {
    CreateBusinessTypeDto,
    CreateBusinessTypeVersionDraftDto,
    PublishBusinessTypeVersionDto,
    UpdateBusinessTypeDto,
    UpdateBusinessTypeVersionDraftDto,
} from './dto/business-types.dto.js';

export function buildBusinessTypesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/business-types')
    @UseGuards(...guards)
    class GeneratedBusinessTypesController {
        constructor(
            @Inject(BusinessTypesService)
            private readonly service: BusinessTypesService,
        ) {}

        @Get()
        listBusinessTypes(@Query('projectKey') projectKey: string) {
            return this.service.listBusinessTypes(projectKey);
        }

        @Get(':id')
        getBusinessType(@Param('id', new ParseUUIDPipe()) businessTypeId: string) {
            return this.service.getBusinessType(businessTypeId);
        }

        @Post()
        createBusinessType(@Body() dto: CreateBusinessTypeDto) {
            return this.service.createBusinessType(dto);
        }

        @Patch(':id')
        updateBusinessType(
            @Param('id', new ParseUUIDPipe()) businessTypeId: string,
            @Body() dto: UpdateBusinessTypeDto,
        ) {
            return this.service.updateBusinessType(businessTypeId, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async softDeleteBusinessType(@Param('id', new ParseUUIDPipe()) businessTypeId: string) {
            await this.service.softDeleteBusinessType(businessTypeId);
        }

        @Get(':id/versions')
        listVersions(@Param('id', new ParseUUIDPipe()) businessTypeId: string) {
            return this.service.listBusinessTypeVersions(businessTypeId);
        }

        @Post(':id/versions')
        createDraft(
            @Param('id', new ParseUUIDPipe()) businessTypeId: string,
            @Body() dto: CreateBusinessTypeVersionDraftDto,
        ) {
            return this.service.createBusinessTypeDraft({
                businessTypeId,
                bundles: dto.bundles,
                quotaOverrides: dto.quotaOverrides,
                monthlyNet: dto.monthlyNet,
                yearlyNet: dto.yearlyNet,
                marketed: dto.marketed,
                changeNote: dto.changeNote,
                baseVersionId: dto.baseVersionId,
            });
        }
    }

    return GeneratedBusinessTypesController;
}

export function buildBusinessTypeVersionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/business-type-versions')
    @UseGuards(...guards)
    class GeneratedBusinessTypeVersionsController {
        constructor(
            @Inject(BusinessTypesService)
            private readonly service: BusinessTypesService,
        ) {}

        @Get(':id')
        getVersion(@Param('id', new ParseUUIDPipe()) versionId: string) {
            return this.service.getBusinessTypeVersion(versionId);
        }

        @Patch(':id')
        updateDraft(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: UpdateBusinessTypeVersionDraftDto,
        ) {
            return this.service.updateBusinessTypeDraft(versionId, dto);
        }

        @Post(':id/publish')
        publish(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: PublishBusinessTypeVersionDto,
        ) {
            return this.service.publishBusinessTypeVersion(versionId, {
                publishedByUserId: null,
                forceRegressive: dto.forceRegressive,
            });
        }
    }

    return GeneratedBusinessTypeVersionsController;
}
