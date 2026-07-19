import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * Eingabe fuer Schritt 4 (Checkout starten) — `POST /auth/register/start-checkout`.
 * Das Frontend uebergibt die PendingRegistration-ID und die Redirect-URLs
 * (success / cancel), an die der Payment-Provider nach der Bezahl-Aktion
 * zurueckleitet.
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
