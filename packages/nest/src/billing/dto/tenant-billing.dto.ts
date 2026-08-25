import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

// DTOs for tenant self-service mutations. Plan and cycle IDs are validated as
// strings (no hard enum), because the allowed values come from the consumer's
// PlanCatalog — the platform service checks admissibility against the catalog
// and blocks unknown plans/kinds there, server-side.

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class PreviewPlanChangeDto {
    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan must be SCREAMING_SNAKE_CASE' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle must be SCREAMING_SNAKE_CASE (e.g. MONTHLY, YEARLY)',
    })
    billingCycle!: string;
}

export class ChangePlanDto extends PreviewPlanChangeDto {
    /** Immediate change (true) vs. change at period end (false/undefined). */
    @IsOptional()
    @IsBoolean()
    effectiveImmediately?: boolean;
}

/**
 * A cancellation carries nothing.
 *
 * It used to carry `immediately`, and honouring it let a tenant end a term they
 * were still inside — the one thing this route may not do. A cancellation is a
 * declaration; when it lands is decided from the minimum term and the notice
 * period, not asked for. Ending a contract on the spot is an operator's act and
 * goes through the operator's own path.
 *
 * Kept as an empty class rather than deleted so `whitelist` still strips a body
 * from a client that has not been updated, instead of the field reaching a
 * handler that would ignore it silently.
 */
export class CancelSubscriptionDto {}
