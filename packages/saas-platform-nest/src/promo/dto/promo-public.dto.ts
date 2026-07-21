import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// DTOs for `PromoCodePublicController`. The code pattern matches the
// internal `CODE_PATTERN` in `service.ts`; plan/cycle pattern as in
// `tenant-billing.dto.ts` (SCREAMING_SNAKE_CASE — catalog lookup in the service).

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/i;

export class PreviewPromoCodeDto {
    @IsString()
    @Matches(CODE_PATTERN, {
        message: 'code muss aus A–Z, 0–9, "-" und "_" bestehen (4–32 Zeichen)',
    })
    code!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan muss SCREAMING_SNAKE_CASE sein' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle muss SCREAMING_SNAKE_CASE sein (z. B. MONTHLY, YEARLY)',
    })
    billingCycle!: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(254)
    email?: string;
}
