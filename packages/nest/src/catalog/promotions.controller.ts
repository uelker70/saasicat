// PromotionsController — REST endpoints for `promotions`.
// Path: `/admin/catalog/promotions`. Built at boot time like BundlesController
// so that the consumer determines the guards.

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
    type Type,
    UseGuards,
} from '@nestjs/common';

import { PromotionsService } from './promotions.service.js';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto.js';

export function buildPromotionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/promotions')
    @UseGuards(...guards)
    class GeneratedPromotionsController {
        constructor(
            @Inject(PromotionsService)
            private readonly service: PromotionsService,
        ) {}

        @Get()
        list() {
            return this.service.list();
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
