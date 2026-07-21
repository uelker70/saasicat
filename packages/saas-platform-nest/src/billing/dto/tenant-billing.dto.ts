import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

// DTOs for tenant self-service mutations. Plan and cycle IDs are validated as
// strings (no hard enum), because the allowed values come from the consumer's
// PlanCatalog — the platform service checks admissibility against the catalog
// and blocks unknown plans/kinds there, server-side.

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class PreviewPlanChangeDto {
    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan muss SCREAMING_SNAKE_CASE sein' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle muss SCREAMING_SNAKE_CASE sein (z. B. MONTHLY, YEARLY)',
    })
    billingCycle!: string;
}

export class ChangePlanDto extends PreviewPlanChangeDto {
    /** Immediate change (true) vs. change at period end (false/undefined). */
    @IsOptional()
    @IsBoolean()
    effectiveImmediately?: boolean;
}

export class CancelSubscriptionDto {
    /** true = cancel immediately (status CANCELED). false/undefined = at period end. */
    @IsOptional()
    @IsBoolean()
    immediately?: boolean;
}
