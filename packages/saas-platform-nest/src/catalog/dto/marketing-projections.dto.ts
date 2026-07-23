import {
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const TARGET_TYPES = ['PLAN', 'BUNDLE'] as const;

export class MarketingTopFeatureDto {
    /** Optional feature/quota key reference (auto-translation of the label). */
    @IsOptional()
    @IsString()
    @MaxLength(120)
    key?: string;

    /** Free text or override; empty + `key` set = auto label. */
    @IsString()
    @MaxLength(120)
    label!: string;

    /** Optional bold addendum — may be empty. */
    @IsString()
    @MaxLength(80)
    strong!: string;
}

export class CreateMarketingProjectionDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, {
        message: 'projectKey muss kebab-case sein',
    })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @IsIn(TARGET_TYPES as unknown as string[])
    targetType!: 'PLAN' | 'BUNDLE';

    @IsUUID()
    targetVersionId!: string;

    @IsOptional()
    @IsString()
    @Matches(LOCALE_PATTERN, {
        message: 'locale muss ISO-639-1 sein (z. B. "de", "en", "de-AT")',
    })
    locale?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayLabel!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    description!: string;

    @IsOptional()
    @IsBoolean()
    visible?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    badge?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MarketingTopFeatureDto)
    topFeatures?: MarketingTopFeatureDto[];

    @IsOptional()
    @IsBoolean()
    trialEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(365)
    trialDays?: number;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    priceTag?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    ctaLabel?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    priority?: number;

    @IsOptional()
    @IsBoolean()
    highlight?: boolean;
}

export class UpdateMarketingProjectionDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayLabel?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsBoolean()
    visible?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    badge?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MarketingTopFeatureDto)
    topFeatures?: MarketingTopFeatureDto[];

    @IsOptional()
    @IsBoolean()
    trialEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(365)
    trialDays?: number;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    priceTag?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    ctaLabel?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    priority?: number;

    @IsOptional()
    @IsBoolean()
    highlight?: boolean;
}

export class ListMarketingProjectionsQueryDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN)
    projectKey!: string;

    @IsOptional()
    @IsString()
    @IsIn(TARGET_TYPES as unknown as string[])
    targetType?: 'PLAN' | 'BUNDLE';

    @IsOptional()
    @IsUUID()
    targetVersionId?: string;

    @IsOptional()
    @IsString()
    @Matches(LOCALE_PATTERN)
    locale?: string;
}
