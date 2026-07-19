// DTOs für den MarketingSettings-Controller (SPEC_V2 §6.5).

import { ArrayUnique, IsArray, IsString, Matches } from 'class-validator';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export class ListMarketingSettingsQueryDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey muss kebab-case sein' })
    projectKey!: string;
}

/** Body von `PUT /admin/catalog/marketing-settings`. */
export class UpdateMarketingSettingsDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey muss kebab-case sein' })
    projectKey!: string;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    @Matches(LOCALE_PATTERN, { each: true, message: 'Locale muss ISO-639-1 sein' })
    activeLocales!: string[];
}
