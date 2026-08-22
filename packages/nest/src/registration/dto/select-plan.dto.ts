import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Input for step 3 (plan selection) — `POST /auth/register/select-plan`.
 * The frontend passes the PendingRegistration ID (from the verify-otp response
 * or the login onboarding response) and the chosen PlanId.
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
