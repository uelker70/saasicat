// DTOs for the CheckoutOffer controller.
//
// A caller chooses and the server prices, so these bodies carry no amount at
// all. With the consumer's `ValidationPipe` whitelisting, a price, a line item
// or a discount snapshot in a request is stripped before it reaches the
// service; without it, the service still reads only the fields below.

import {
    ArrayMaxSize,
    IsArray,
    IsDateString,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import type { CheckoutOfferSelection, CheckoutOfferSelectionUpdate } from '@saasicat/core';

const CYCLES = ['monthly', 'yearly'] as const;

/** More add-ons than any catalogue offers; a bound, not a business rule. */
const MAX_BUNDLE_VERSIONS = 50;

export class CreateCheckoutOfferDto implements CheckoutOfferSelection {
    @IsString()
    @MaxLength(64)
    planKey!: string;

    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle!: 'monthly' | 'yearly';

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_BUNDLE_VERSIONS)
    @IsString({ each: true })
    bundleVersionIds?: string[];

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsString()
    @MaxLength(64)
    promoCode?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(8)
    locale?: string;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsDateString()
    validUntil?: string | null;
}

export class UpdateCheckoutOfferDto implements CheckoutOfferSelectionUpdate {
    @IsOptional()
    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle?: 'monthly' | 'yearly';

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_BUNDLE_VERSIONS)
    @IsString({ each: true })
    bundleVersionIds?: string[];

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsString()
    @MaxLength(64)
    promoCode?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(8)
    locale?: string;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsDateString()
    validUntil?: string | null;
}
