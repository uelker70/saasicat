import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

// DTOs für Tenant-Self-Service-Mutationen. Plan- und Cycle-IDs werden als
// String validiert (kein hartes Enum), weil die erlaubten Werte aus dem
// Konsumenten-PlanCatalog stammen — der Plattform-Service prüft Zulässigkeit
// gegen den Catalog und blockt unbekannte Plans/Kinds dort serverseitig.

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
    /** Sofort-Wechsel (true) vs. Wechsel zum Periodenende (false/undefined). */
    @IsOptional()
    @IsBoolean()
    effectiveImmediately?: boolean;
}

export class CancelSubscriptionDto {
    /** true = sofort kündigen (Status CANCELED). false/undefined = zum Periodenende. */
    @IsOptional()
    @IsBoolean()
    immediately?: boolean;
}
