import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateBusinessTypeDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, {
        message: 'projectKey muss kebab-case sein (z. B. "my-app")',
    })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @Matches(KEY_PATTERN, {
        message: 'businessTypeKey muss SCREAMING_SNAKE_CASE sein',
    })
    @MaxLength(64)
    businessTypeKey!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    label!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    icon?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}

export class UpdateBusinessTypeDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    label?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    icon?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}

export class BusinessTypeBundleInputDto {
    @IsUUID()
    bundleVersionId!: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}

export class CreateBusinessTypeVersionDraftDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'mindestens ein Bundle muss referenziert werden' })
    @ValidateNested({ each: true })
    @Type(() => BusinessTypeBundleInputDto)
    bundles!: BusinessTypeBundleInputDto[];

    @IsOptional()
    @IsObject()
    quotaOverrides?: Record<string, number>;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN, { message: 'monthlyNet muss Decimal mit max. 2 NK sein' })
    monthlyNet?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN)
    yearlyNet?: string | null;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;

    @IsOptional()
    @IsUUID()
    baseVersionId?: string | null;
}

export class UpdateBusinessTypeVersionDraftDto {
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => BusinessTypeBundleInputDto)
    bundles?: BusinessTypeBundleInputDto[];

    @IsOptional()
    @IsObject()
    quotaOverrides?: Record<string, number>;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN)
    monthlyNet?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN)
    yearlyNet?: string | null;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;
}

export class PublishBusinessTypeVersionDto {
    @IsOptional()
    @IsBoolean()
    forceRegressive?: boolean;
}
