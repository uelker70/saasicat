// DTOs for `PromotionsController` (SPEC_V2 §9a).

import {
    IsArray,
    IsBoolean,
    IsDefined,
    IsIn,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';
import type {
    PromotionBillingCycle,
    PromotionI18n,
    PromotionTargetType,
    PromotionType,
    PromotionValue,
} from '@saasicat/types';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
const TYPES = ['percent', 'amount', 'intro', 'freeMonths'] as const;
const CYCLES = ['monthly', 'yearly', 'both'] as const;
const TARGET_TYPES = ['PLAN', 'BUNDLE', 'OFFER'] as const;

export class ListPromotionsQueryDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey muss kebab-case sein' })
    projectKey!: string;
}

export class CreatePromotionDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN)
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @MaxLength(120)
    internalLabel!: string;

    @IsString()
    @IsIn(TYPES as unknown as string[])
    type!: PromotionType;

    /** Type-dependent: number | { price, months }. */
    @IsDefined()
    value!: PromotionValue;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    appliesTo?: string[];

    @IsOptional()
    @IsString()
    @IsIn(TARGET_TYPES as unknown as string[])
    targetType?: PromotionTargetType;

    @IsOptional()
    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle?: PromotionBillingCycle;

    @IsString()
    @Matches(ISO_DATE_PATTERN, { message: 'validFrom muss ISO-Datum sein' })
    validFrom!: string;

    @IsString()
    @Matches(ISO_DATE_PATTERN, { message: 'validTo muss ISO-Datum sein' })
    validTo!: string;

    @IsOptional()
    @IsInt()
    priority?: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    onlyLocales?: string[] | null;

    @IsOptional()
    @IsBoolean()
    requiresCoupon?: boolean;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    codes?: string[];

    @IsOptional()
    @IsString()
    @MaxLength(16)
    color?: string;

    @IsOptional()
    @IsObject()
    i18n?: PromotionI18n;
}

export class UpdatePromotionDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    internalLabel?: string;

    @IsOptional()
    @IsString()
    @IsIn(TYPES as unknown as string[])
    type?: PromotionType;

    @IsOptional()
    value?: PromotionValue;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    appliesTo?: string[];

    @IsOptional()
    @IsString()
    @IsIn(TARGET_TYPES as unknown as string[])
    targetType?: PromotionTargetType;

    @IsOptional()
    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle?: PromotionBillingCycle;

    @IsOptional()
    @IsString()
    @Matches(ISO_DATE_PATTERN)
    validFrom?: string;

    @IsOptional()
    @IsString()
    @Matches(ISO_DATE_PATTERN)
    validTo?: string;

    @IsOptional()
    @IsInt()
    priority?: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    onlyLocales?: string[] | null;

    @IsOptional()
    @IsBoolean()
    requiresCoupon?: boolean;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    codes?: string[];

    @IsOptional()
    @IsString()
    @MaxLength(16)
    color?: string;

    @IsOptional()
    @IsObject()
    i18n?: PromotionI18n;
}
