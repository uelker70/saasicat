// DTOs for the MarketingSettings controller.

import { ArrayUnique, IsArray, IsString, Matches } from 'class-validator';

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Body of `PUT /admin/catalog/marketing-settings`. */
export class UpdateMarketingSettingsDto {
    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    @Matches(LOCALE_PATTERN, { each: true, message: 'Locale must be ISO-639-1' })
    activeLocales!: string[];
}
