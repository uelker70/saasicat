import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
} from 'class-validator';
import type { BillingCycle } from '@saasicat/core';

import { BILLING_CYCLES } from './billing-cycles.js';

// CompleteOnboardingSubscriptionDto — selection from the onboarding
// configurator that the tenant submits when completing the step-3 configuration.
//
// Plan IDs are validated as strings (not a hard enum), because the platform
// service checks against the consumer PlanCatalog; the rhythm is one of the two
// a plan is sold in. The promo code is optional; when set, the service attempts
// an atomic redemption after the plan change.

const PLAN_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/i;

export class CompleteOnboardingSubscriptionDto {
    @IsString()
    @Matches(PLAN_PATTERN, { message: 'plan must be SCREAMING_SNAKE_CASE' })
    plan!: string;

    @IsIn(BILLING_CYCLES)
    billingCycle!: BillingCycle;

    @IsOptional()
    @IsString()
    @Matches(PROMO_CODE_PATTERN, {
        message: 'promoCode must consist of A–Z, 0–9, "-", "_" (4–32 characters)',
    })
    promoCode?: string;

    /**
     * Optional — UUIDs of the BundleVersions that should be booked
     * together with the plan (P11.7.3). Per bundle, the platform
     * default minimum term (none) is set. Bundles are added
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
