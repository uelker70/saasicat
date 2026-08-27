// DTOs for the CheckoutOffer controller.

import {
    IsArray,
    IsDateString,
    IsDefined,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import type {
    CheckoutOfferLineItem,
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
} from '@saasicat/core';

const CYCLES = ['monthly', 'yearly'] as const;

export class CreateCheckoutOfferDto {
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
