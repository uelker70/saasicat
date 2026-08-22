import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';

const VALUE_TYPES = ['PERCENT', 'ABSOLUTE'] as const;
const DURATION_TYPES = ['ONCE', 'MONTHS', 'BILLING_CYCLES'] as const;
const STATUSES = ['ACTIVE', 'PAUSED'] as const;
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;

export class CreatePromoCodeDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    code!: string;

    @IsIn(VALUE_TYPES)
    valueType!: (typeof VALUE_TYPES)[number];

    @IsNumber()
    @Min(0)
    value!: number;

    @IsIn(DURATION_TYPES)
    durationType!: (typeof DURATION_TYPES)[number];

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
    @IsIn(BILLING_CYCLES)
    appliesToBilling?: (typeof BILLING_CYCLES)[number] | null;

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
    @IsIn(STATUSES)
    status?: (typeof STATUSES)[number];

    @IsOptional()
    @IsIn(VALUE_TYPES)
    valueType?: (typeof VALUE_TYPES)[number];

    @IsOptional()
    @IsNumber()
    @Min(0)
    value?: number;

    @IsOptional()
    @IsIn(DURATION_TYPES)
    durationType?: (typeof DURATION_TYPES)[number];

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
    @IsIn(BILLING_CYCLES)
    appliesToBilling?: (typeof BILLING_CYCLES)[number] | null;

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
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    campaignTag?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    revenueDeductionAccount?: string | null;
}
