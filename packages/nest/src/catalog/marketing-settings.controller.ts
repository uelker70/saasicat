// MarketingSettingsController — `/admin/catalog/marketing-settings`
//. Built at boot time, like BundlesController.

import {
    Body,
    type CanActivate,
    Controller,
    Get,
    Inject,
    Put,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { MarketingSettingsService } from './marketing-settings.service.js';
import { UpdateMarketingSettingsDto } from './dto/marketing-settings.dto.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';

export function buildMarketingSettingsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/marketing-settings')
    @AllowDuringMaintenance()
    @UseGuards(...guards)
    class GeneratedMarketingSettingsController {
        constructor(
            @Inject(MarketingSettingsService)
            private readonly service: MarketingSettingsService,
        ) {}

        /** Returns the stored config or `null` (full pool active). */
        @Get()
        get() {
            return this.service.get();
        }

        @Put()
        update(@Body() dto: UpdateMarketingSettingsDto) {
            return this.service.upsert({ activeLocales: dto.activeLocales });
        }
    }

    return GeneratedMarketingSettingsController;
}
