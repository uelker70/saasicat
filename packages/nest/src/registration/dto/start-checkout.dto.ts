import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * Input for step 4 (start checkout) — `POST /auth/register/start-checkout`.
 * The frontend passes the PendingRegistration ID and the redirect URLs
 * (success / cancel) that the payment provider redirects to after the payment
 * action.
 */
export class StartRegistrationCheckoutDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @IsUrl({ require_tld: false })
    @MaxLength(500)
    successUrl!: string;

    @IsUrl({ require_tld: false })
    @MaxLength(500)
    cancelUrl!: string;
}
