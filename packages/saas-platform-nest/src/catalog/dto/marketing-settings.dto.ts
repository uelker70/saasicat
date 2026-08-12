// DTOs for the MarketingSettings controller.

import { ArrayUnique, IsArray, IsString, Matches } from 'class-validator';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export class ListMarketingSettingsQueryDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey must be kebab-case' })
    projectKey!: string;
}

/** Body of `PUT /admin/catalog/marketing-settings`. */
export class UpdateMarketingSettingsDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey must be kebab-case' })
    projectKey!: string;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    @Matches(LOCALE_PATTERN, { each: true, message: 'Locale must be ISO-639-1' })
    activeLocales!: string[];
}
