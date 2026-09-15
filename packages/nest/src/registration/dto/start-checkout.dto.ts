import { Type } from 'class-transformer';
import {
    IsNotEmptyObject,
    IsOptional,
    IsString,
    IsUrl,
    Matches,
    MaxLength,
    MinLength,
    ValidateNested,
} from 'class-validator';

/** The billing address and tax identifiers step 4 asks for, which the subscriber is created with. */
export class RegistrationBillingDetailsDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    addressLine1!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    addressLine2?: string | null;

    @IsString()
    @MinLength(1)
    @MaxLength(20)
    postalCode!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    city!: string;

    /** ISO 3166-1 alpha-2, e.g. `DE`. */
    @Matches(/^[A-Z]{2}$/)
    country!: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    vatId?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    taxNumber?: string | null;
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
}
