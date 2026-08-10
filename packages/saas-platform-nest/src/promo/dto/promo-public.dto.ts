import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// DTOs for `PromoCodePublicController`. The code pattern matches the
// internal `CODE_PATTERN` in `service.ts`; plan/cycle pattern as in
// `tenant-billing.dto.ts` (SCREAMING_SNAKE_CASE — catalog lookup in the service).

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/i;

export class PreviewPromoCodeDto {
    @IsString()
    @Matches(CODE_PATTERN, {
        message: 'code must consist of A–Z, 0–9, "-" and "_" (4–32 characters)',
    })
    code!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan must be SCREAMING_SNAKE_CASE' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle must be SCREAMING_SNAKE_CASE (e.g. MONTHLY, YEARLY)',
    })
    billingCycle!: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(254)
    email?: string;
}
