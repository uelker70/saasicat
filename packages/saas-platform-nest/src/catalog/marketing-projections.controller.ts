// MarketingProjectionsController — REST endpoints for `marketing_projections`.
//
// Path: `/admin/catalog/marketing-projections`. Pattern analogous to BundlesController.

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

import { MarketingProjectionsService } from './marketing-projections.service.js';
import {
    CreateMarketingProjectionDto,
    ListMarketingProjectionsQueryDto,
    UpdateMarketingProjectionDto,
} from './dto/marketing-projections.dto.js';

export function buildMarketingProjectionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/marketing-projections')
    @UseGuards(...guards)
    class GeneratedMarketingProjectionsController {
        constructor(
            @Inject(MarketingProjectionsService)
            private readonly service: MarketingProjectionsService,
        ) {}

        @Get()
        list(@Query() query: ListMarketingProjectionsQueryDto) {
            return this.service.list({
                projectKey: query.projectKey,
                targetType: query.targetType,
                targetVersionId: query.targetVersionId,
                locale: query.locale,
            });
        }

        @Get(':id')
        getById(@Param('id', new ParseUUIDPipe()) id: string) {
            return this.service.getById(id);
        }

        @Post()
        create(@Body() dto: CreateMarketingProjectionDto) {
            return this.service.create(dto);
        }

        @Patch(':id')
        update(
            @Param('id', new ParseUUIDPipe()) id: string,
            @Body() dto: UpdateMarketingProjectionDto,
        ) {
            return this.service.update(id, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async delete(@Param('id', new ParseUUIDPipe()) id: string) {
            await this.service.delete(id);
        }
    }

    return GeneratedMarketingProjectionsController;
}
