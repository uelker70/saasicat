import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';
import {
    BillingCycle,
    PromoCodeDurationType,
    PromoCodeStatus,
    PromoCodeValueType,
} from '@prisma/client';

/**
 * Validated request bodies for the app-owned SuperAdmin pages. The DTO types
 * reuse the Prisma enums directly, so the service passes the validated values
 * into `prisma.*` without a cast (the string-literal-union pages
 * `PromoCodesPage`/`TenantsPage` send exactly these member names).
 */

export class SuspendTenantDto {
    // The confirm dialog collects a reason; MFA is not modeled in this demo, so
    // the `X-Mfa-Code` header the platform flow sends is accepted and ignored.
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

export class CreatePromoCodeDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    code!: string;

    @IsEnum(PromoCodeValueType)
    valueType!: PromoCodeValueType;

    @IsNumber()
    @Min(0)
    value!: number;

    @IsEnum(PromoCodeDurationType)
    durationType!: PromoCodeDurationType;

    @IsOptional()
    @IsInt()
    @Min(1)
    durationValue?: number | null;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxRedemptions?: number | null;

    @IsOptional()
    @IsString()
    validFrom?: string | null;

    @IsOptional()
    @IsString()
    validUntil?: string | null;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ArrayUnique()
    appliesToPlans?: string[];

    @IsOptional()
    @IsEnum(BillingCycle)
    appliesToBilling?: BillingCycle | null;

    @IsOptional()
    @IsBoolean()
    firstTimeCustomersOnly?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(0)
    minimumPlanAmountGross?: number | null;

    @IsOptional()
    @IsBoolean()
    allowZeroInvoice?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    revenueDeductionAccount?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    campaignTag?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;
}

export class UpdatePromoCodeDto {
    @IsOptional()
    @IsEnum(PromoCodeStatus)
    status?: PromoCodeStatus;

    @IsOptional()
    @IsEnum(PromoCodeValueType)
    valueType?: PromoCodeValueType;

    @IsOptional()
    @IsNumber()
    @Min(0)
    value?: number;

    @IsOptional()
    @IsEnum(PromoCodeDurationType)
    durationType?: PromoCodeDurationType;

    @IsOptional()
    @IsInt()
    @Min(1)
    durationValue?: number | null;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxRedemptions?: number | null;

    @IsOptional()
    @IsString()
    validFrom?: string | null;

    @IsOptional()
    @IsString()
    validUntil?: string | null;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ArrayUnique()
    appliesToPlans?: string[];

    @IsOptional()
    @IsEnum(BillingCycle)
    appliesToBilling?: BillingCycle | null;

    @IsOptional()
    @IsBoolean()
    firstTimeCustomersOnly?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(0)
    minimumPlanAmountGross?: number | null;

    @IsOptional()
    @IsBoolean()
    allowZeroInvoice?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    revenueDeductionAccount?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    campaignTag?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;
}
