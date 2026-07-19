import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Eingabe fuer Schritt 3 (Paketauswahl) — `POST /auth/register/select-plan`.
 * Das Frontend uebergibt die PendingRegistration-ID (aus verify-otp-Response
 * oder Login-Onboarding-Antwort) und den gewaehlten PlanId.
 */
export class SelectRegistrationPlanDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(40)
    planId!: string;
}
