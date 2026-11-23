import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsNotEmptyObject,
    IsOptional,
    IsString,
    IsUrl,
    MaxLength,
    MinLength,
    ValidateNested,
} from 'class-validator';

/**
 * The billing address and tax identifiers step 4 asks for, which the subscriber
 * is created with. No detail declares a length or a form here: the platform
 * measures each where it settles the details — a line of the address
 * (`SUBSCRIBER_ADDRESS_MAX_LENGTHS`), a tax identifier
 * (`SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH`) — and upper-cases the country to its
 * code, the one rule every way a detail arrives is held to.
 */
export class RegistrationBillingDetailsDto {
    @IsString()
    @MinLength(1)
    addressLine1!: string;

    @IsOptional()
    @IsString()
    addressLine2?: string | null;

    @IsString()
    @MinLength(1)
    postalCode!: string;

    @IsString()
    @MinLength(1)
    city!: string;

    /** ISO 3166-1 alpha-2, e.g. `DE`; `de` is taken as `DE`. */
    @IsString()
    country!: string;

    @IsOptional()
    @IsString()
    vatId?: string | null;

    @IsOptional()
    @IsString()
    taxNumber?: string | null;

    /** Whether the sign-up is a business, which a tax adapter decides from. */
    @IsOptional()
    @IsBoolean()
    business?: boolean | null;
}

/**
 * Input for step 4 — `POST /auth/register/start-checkout`: the billing details,
 * and where the payment gateway's form sends the person once the payment method
 * is set up, or when they leave it.
 */
export class StartRegistrationCheckoutDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @IsNotEmptyObject()
    @ValidateNested()
    @Type(() => RegistrationBillingDetailsDto)
    billingDetails!: RegistrationBillingDetailsDto;

    @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https', 'http'] })
    @MaxLength(500)
    successUrl!: string;

    @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https', 'http'] })
    @MaxLength(500)
    cancelUrl!: string;

    /**
     * The checkout offer the sign-up concludes; its promo code is held until a
     * confirmation of the payment form can no longer arrive.
     */
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    checkoutOfferId?: string | null;
}
