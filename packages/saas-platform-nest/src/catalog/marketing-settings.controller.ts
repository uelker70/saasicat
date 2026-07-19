// MarketingSettingsController — `/admin/catalog/marketing-settings`
// (SPEC_V2 §6.5). Wie BundlesController zur Boot-Zeit gebaut.

import {
    Body,
    type CanActivate,
    Controller,
    Get,
    Inject,
    Put,
    Query,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { MarketingSettingsService } from './marketing-settings.service.js';
import {
    ListMarketingSettingsQueryDto,
    UpdateMarketingSettingsDto,
} from './dto/marketing-settings.dto.js';

export function buildMarketingSettingsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/marketing-settings')
    @UseGuards(...guards)
    class GeneratedMarketingSettingsController {
        constructor(
            @Inject(MarketingSettingsService)
            private readonly service: MarketingSettingsService,
        ) {}

        /** Liefert die gespeicherte Konfig oder `null` (voller Pool aktiv). */
        @Get()
        get(@Query() query: ListMarketingSettingsQueryDto) {
            return this.service.get(query.projectKey);
        }

        @Put()
        update(@Body() dto: UpdateMarketingSettingsDto) {
            return this.service.upsert(dto.projectKey, {
                activeLocales: dto.activeLocales,
            });
        }
    }

    return GeneratedMarketingSettingsController;
}
