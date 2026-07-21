import {
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Configurator selection payload for `POST /auth/register/save-config`.
 *
 * Intentionally kept flat — model validation happens in the service against
 * the Catalog. The DTO only checks structural types.
 */
export class SaveRegistrationConfigSelectionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(40)
    modelId!: string;

    @IsIn(['MONTHLY', 'YEARLY'])
    billingCycle!: 'MONTHLY' | 'YEARLY';

    @IsOptional()
    @IsString()
    @MaxLength(60)
    appliedPromoCode?: string | null;

    /**
     * SPEC_V2 §11.1 M5.3 — optional business-type choice. UUID of a
     * **published** BusinessTypeVersion. The service validates existence +
     * live status against `RegistrationBusinessTypeLookup`. `null` = no
     * choice (legacy Plan-only path).
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    businessTypeVersionId?: string | null;

    /**
     * METAMODELL §17a — Bundle consistency. ID of the `CheckoutOffer` that was
     * created on the pricing page (`<app>/register?offer=<id>`). Passed
     * through unchanged in `configJson`; the ActivationOrchestrator freezes it
     * as `packageSnapshot` when the subscription is created and sets the offer
     * to `consumed`. `null` = direct registration without a website offer.
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    offerId?: string | null;
}

export class SaveRegistrationConfigDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @ValidateNested()
    @Type(() => SaveRegistrationConfigSelectionDto)
    selection!: SaveRegistrationConfigSelectionDto;
}
