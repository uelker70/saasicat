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

import { IsStorableAmount } from './storable-amount.validator.js';

const VALUE_TYPES = ['PERCENT', 'ABSOLUTE'] as const;
const DURATION_TYPES = ['ONCE', 'MONTHS', 'BILLING_CYCLES'] as const;
const STATUSES = ['ACTIVE', 'PAUSED'] as const;
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;

/**
 * What the canonical columns hold for a discount and a minimum amount:
 * `numeric(8,2)` and `numeric(10,2)`. An amount with more places, or larger, is
 * refused here rather than rounded or overflowing on its way into the table.
 */
const DISCOUNT_COLUMN = { places: 2, max: 999_999.99 } as const;
const MINIMUM_COLUMN = { places: 2, max: 99_999_999.99 } as const;

export class CreatePromoCodeDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    code!: string;

    @IsIn(VALUE_TYPES)
    valueType!: (typeof VALUE_TYPES)[number];

    @IsNumber()
    @IsStorableAmount(DISCOUNT_COLUMN)
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
    @IsStorableAmount(MINIMUM_COLUMN)
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
    @IsStorableAmount(DISCOUNT_COLUMN)
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
    @IsStorableAmount(MINIMUM_COLUMN)
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
