import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

// CompleteOnboardingSubscriptionDto — selection from the onboarding
// configurator that the tenant submits when completing the step-3 configuration.
//
// Plan and cycle IDs are validated as strings (not a hard enum), because
// the platform service checks against the consumer PlanCatalog. The promo code
// is optional; when set, the service attempts an atomic redemption
// after the plan change.

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/i;

export class CompleteOnboardingSubscriptionDto {
    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan muss SCREAMING_SNAKE_CASE sein' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle muss SCREAMING_SNAKE_CASE sein (z. B. MONTHLY, YEARLY)',
    })
    billingCycle!: string;

    @IsOptional()
    @IsString()
    @Matches(PROMO_CODE_PATTERN, {
        message: 'promoCode muss aus A–Z, 0–9, "-", "_" bestehen (4–32 Zeichen)',
    })
    promoCode?: string;

    /**
     * Optional — UUIDs of the BundleVersions that should be booked
     * together with the plan (P11.7.3). Per bundle, the platform
     * default minimum term (12 months) is set. Bundles are added
     * best-effort **after** the plan change — an error on an individual
     * bundle (e.g. incompatible with the chosen plan) lands as a
     * warning in the response, without rolling back the plan change.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsUUID('all', { each: true })
    bundleVersionIds?: string[];
}
