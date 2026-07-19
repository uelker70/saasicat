// DTOs für den CheckoutOffer-Controller (METAMODELL §17a).

import {
    IsArray,
    IsDateString,
    IsDefined,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';
import type {
    CheckoutOfferLineItem,
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
} from '@saasicat/types';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const CYCLES = ['monthly', 'yearly'] as const;

export class CreateCheckoutOfferDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey muss kebab-case sein' })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @MaxLength(64)
    planKey!: string;

    @IsOptional()
    @IsString()
    planVersionId?: string | null;

    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle!: 'monthly' | 'yearly';

    @IsOptional()
    @IsString()
    promotionId?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    promoCode?: string | null;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    bundles?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    bundleVersionIds?: string[];


    @IsDefined()
    @IsObject()
    priceBreakdown!: CheckoutOfferPriceBreakdown;

    @IsOptional()
    @IsArray()
    lineItems?: CheckoutOfferLineItem[];

    @IsOptional()
    @IsArray()
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];

    @IsOptional()
    @IsObject()
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;

    @IsOptional()
    @IsString()
    @MaxLength(8)
    locale?: string;

    @IsOptional()
    @IsDateString()
    validUntil?: string | null;
}

export class UpdateCheckoutOfferDto {
    @IsOptional()
    @IsString()
    @IsIn(CYCLES as unknown as string[])
    billingCycle?: 'monthly' | 'yearly';

    @IsOptional()
    @IsString()
    promotionId?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    promoCode?: string | null;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    bundles?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    bundleVersionIds?: string[];


    @IsOptional()
    @IsObject()
    priceBreakdown?: CheckoutOfferPriceBreakdown;

    @IsOptional()
    @IsArray()
    lineItems?: CheckoutOfferLineItem[];

    @IsOptional()
    @IsArray()
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];

    @IsOptional()
    @IsObject()
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;

    @IsOptional()
    @IsString()
    @MaxLength(8)
    locale?: string;

    @IsOptional()
    @IsDateString()
    validUntil?: string | null;
}
