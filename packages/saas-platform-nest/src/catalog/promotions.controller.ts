// PromotionsController — REST-Endpunkte für `promotions` (SPEC_V2 §9a).
// Pfad: `/admin/catalog/promotions`. Wie BundlesController zur Boot-Zeit
// gebaut, damit der Konsument die Guards bestimmt.

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

import { PromotionsService } from './promotions.service.js';
import {
    CreatePromotionDto,
    ListPromotionsQueryDto,
    UpdatePromotionDto,
} from './dto/promotions.dto.js';

export function buildPromotionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/promotions')
    @UseGuards(...guards)
    class GeneratedPromotionsController {
        constructor(
            @Inject(PromotionsService)
            private readonly service: PromotionsService,
        ) {}

        @Get()
        list(@Query() query: ListPromotionsQueryDto) {
            return this.service.list(query.projectKey);
        }

        @Get(':id')
        getById(@Param('id', new ParseUUIDPipe()) id: string) {
            return this.service.getById(id);
        }

        @Post()
        create(@Body() dto: CreatePromotionDto) {
            return this.service.create(dto);
        }

        @Patch(':id')
        update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdatePromotionDto) {
            return this.service.update(id, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async remove(@Param('id', new ParseUUIDPipe()) id: string) {
            await this.service.delete(id);
        }
    }

    return GeneratedPromotionsController;
}
